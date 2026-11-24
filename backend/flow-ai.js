import { FlowError } from './flow-engine.js';
import { failIfBad, request } from './flow-util.js';
import { nvidiaParams, nvidiaSeesImages } from './nvidia.js';

/* The server's AI, for workflow steps (Rewrite, Summarize, Extract, Classify, Translate, Read an image,
   Decide, Score, Ask Claude). Claude when ANTHROPIC_API_KEY is set; otherwise NVIDIA's models
   (NVIDIA_API_KEY): the fast text model for words, a model that reads pictures (Kimi) for images.
   content: a string, or Anthropic-style parts ({type:'text'} and {type:'image', source:{base64}}).
   Returns the answer's text. */

const FAST = ['z-ai/glm-5.3-flash', 'minimaxai/minimax-m3.1-flash', 'deepseek-ai/deepseek-v4.1-flash'];
const partsOf = content => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }]);

export async function askAI(args, { system, content, maxTokens = 1024 }) {
  const ai = args.ctx.ai || {};
  const models = ai.nvidiaKey ? (ai.nvidiaModels || []) : [];
  if (!ai.key && !models.length) throw new FlowError('AI is off on this server: set NVIDIA_API_KEY or ANTHROPIC_API_KEY.', 'ai_off');
  // The step's own pick (its “AI model” setting): claude, nvidia (Nemotron) or nvidia:<model>; blank is Automatic.
  // Blank: the AI chat's model (when this server has it), else the fastest one.
  const own = String(args.node?.params?.model || '').trim(), chat = String(ai.chatModel?.() || '');
  const has = id => (id === 'claude' ? !!ai.key : id === 'nvidia' ? models.some(m => /nemotron/i.test(m)) : id.startsWith('nvidia:') && models.includes(id.slice(7)));
  const want = own || (chat && has(chat) ? chat : '');
  const picked = want === 'nvidia' ? models.find(m => /nemotron/i.test(m)) : want.startsWith('nvidia:') ? want.slice(7) : '';
  if (want === 'claude' && !ai.key) throw new FlowError('This step is set to Claude, but the server has no ANTHROPIC_API_KEY. Pick another AI model in the step.', 'ai_off');
  if (want && want !== 'claude' && (!ai.nvidiaKey || !picked || (want.startsWith('nvidia:') && !models.includes(picked)))) throw new FlowError(`This step’s AI model (${want}) isn’t on this server. Pick another in the step.`, 'ai_off');
  if (!ai.allow()) throw new FlowError('Today’s AI allowance is used up.', 'ai_limit');
  if (ai.key && (want === 'claude' || !want)) {
    const r = await request(`${ai.base}/v1/messages`, {
      method: 'POST', headers: { 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content }] }),
    }, { allowPrivate: true, timeout: 90_000 });
    const body = failIfBad(r, 'Claude');
    return (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  }
  // NVIDIA: an OpenAI-style chat completion (not streamed).
  const parts = partsOf(content), images = parts.filter(p => p.type === 'image');
  const model = picked || (images.length
    ? models.find(nvidiaSeesImages)
    : FAST.find(m => models.includes(m)) || models.find(m => !/nemotron/i.test(m)) || models[0]);
  if (!model) throw new FlowError('None of this server’s AI models reads pictures: add moonshotai/kimi-k3.1-pro to NVIDIA_MODEL, or set ANTHROPIC_API_KEY.', 'ai_off');
  const user = images.length
    ? parts.map(p => (p.type === 'image' ? { type: 'image_url', image_url: { url: `data:${p.source.media_type};base64,${p.source.data}` } } : { type: 'text', text: String(p.text ?? '') }))
    : parts.map(p => String(p.text ?? '')).join('\n\n');
  const params = nvidiaParams(model);
  const r = await request(`${String(ai.nvidiaBase || '').replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${ai.nvidiaKey}`, 'content-type': 'application/json', accept: 'application/json' },
    // Thinking models count their reasoning in max_tokens, so they keep their own (larger) allowance.
    body: JSON.stringify({ model, stream: false, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }], ...params, max_tokens: Math.max(params.max_tokens || 0, maxTokens) }),
  }, { allowPrivate: true, timeout: 120_000 });
  const body = failIfBad(r, 'NVIDIA AI');
  const msg = body?.choices?.[0]?.message || {};
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('') : '';
  // Some models put their reasoning in the answer, between <think> tags: keep only the answer.
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
