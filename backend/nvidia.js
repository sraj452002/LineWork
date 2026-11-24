/* NVIDIA's models (an OpenAI-style chat API at integrate.api.nvidia.com): what each one needs in a request.
   Used by the AI chat (app.js) and Nemo and agents (agent.js). */

// The models that read pictures (sent as image_url parts): Kimi, and the other vision models.
export const nvidiaSeesImages = m => /kimi|vision|-vl\b|\bvl-/i.test(m);
// Each model's request settings, as NVIDIA suggests them. Kimi thinks a little (reasoning_effort) first.
export const nvidiaParams = m => (/nemotron/i.test(m)
  ? { temperature: 1, top_p: 0.95, max_tokens: 16384, reasoning_budget: 16384, chat_template_kwargs: { enable_thinking: true } }
  : /kimi/i.test(m) ? { max_tokens: 16384, seed: 0, reasoning_effort: 'low' }
  : { temperature: 0.5, top_p: 1, max_tokens: 8192 });
// The OpenAI-style message content: the text alone, or the pictures (as data URLs) and then the text.
export const nvidiaContent = (text, images = []) => (images.length
  ? [{ type: 'text', text }, ...images.map(im => ({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` } }))]
  : text);
