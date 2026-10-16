/* The AI assistant's client: its chats (kept in this browser, per account) and one streamed answer
   from POST /api/ai/chat (backend/agent.js), which may use the account's tools on the way. */
import { aiProvider } from './ai.js';

const KEY = uid => `linework:assistant:${uid || 'me'}`;
const MAX_CHATS = 40;
export const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export function loadChats(uid) {
  try { const v = JSON.parse(localStorage.getItem(KEY(uid)) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
// Pictures aren't kept (they're large); a note of them is.
export function saveChats(uid, chats) {
  const slim = chats.filter(c => c.msgs.length).slice(0, MAX_CHATS).map(c => ({ ...c, msgs: c.msgs.map(m => (m.images ? { ...m, images: undefined, pictures: m.images.length } : m)) }));
  try { localStorage.setItem(KEY(uid), JSON.stringify(slim)); } catch (e) { /* full: keep going without saving */ }
}
export const titleOf = text => { const t = String(text).replace(/\s+/g, ' ').trim(); return t.length > 48 ? `${t.slice(0, 46)}…` : t || 'New chat'; };

// What the model sees of a past answer: its text, and a line about the tools it used.
const textOf = m => {
  if (m.role === 'user') return m.text;
  const parts = m.parts || [];
  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('');
  const tools = parts.filter(p => p.type === 'tool').map(p => `${p.name}(${JSON.stringify(p.input || {})}) → ${p.ok ? 'ok' : 'failed'}`);
  return (text + (tools.length ? `\n\n[Tools used: ${tools.join('; ')}]` : '')).trim() || '(no answer)';
};

/* Asks for the next answer. onEvent gets each event: {type:'text'|'thinking', delta}, {type:'tool', id,
   name, input}, {type:'tool_done', id, ok, result}, {type:'error', message}. Resolves when it's done. */
export async function ask(msgs, { images, agentId, signal, onEvent }) {
  let res;
  try {
    res = await fetch('/api/ai/chat', {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: aiProvider()?.id, ...(agentId ? { agentId } : {}), messages: msgs.map(m => ({ role: m.role, text: textOf(m) })), ...(images && images.length ? { images: images.map(({ media_type, data }) => ({ media_type, data })) } : {}) }),
    });
  } catch (e) { throw { code: e && e.name === 'AbortError' ? 'cancelled' : 'unavailable' }; }
  // A server from before the assistant (no /api/ai/chat yet): the plain AI, without tools.
  if (res.status === 404 && !agentId) return askPlain(msgs, { signal, onEvent });
  if (res.status === 404) throw { code: 'no_agent' };
  if (res.status === 401) throw { code: 'signed_out' };
  if (res.status === 429) throw { code: 'daily_limit' };
  if (res.status === 503) throw { code: 'not_configured' };
  if (res.status === 400) { const j = await res.json().catch(() => ({})); throw { code: j.error === 'bad_image' ? 'image_unsupported' : 'unavailable', message: j.message }; }
  if (!res.ok || !res.body) throw { code: 'unavailable' };
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        onEvent(ev);
      }
    }
  } catch (e) { throw { code: signal && signal.aborted ? 'cancelled' : 'unavailable' }; }
}

// The plain AI (POST /api/ai): one prompt with the conversation, its answer streamed in Anthropic's events.
async function askPlain(msgs, { signal, onEvent }) {
  const prompt = `You are Nemo, the AI built into WorkLine. Answer warmly, clearly and briefly, in the language the user writes in, using Markdown when it helps. When the user greets you, start like: “Hi, I am Nemo! How can I help you?”.\n\n${msgs.slice(-12).map(m => `${m.role === 'user' ? 'User' : 'Nemo'}: ${textOf(m)}`).join('\n\n')}\n\nNemo:`;
  let res;
  try { res = await fetch('/api/ai', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, provider: aiProvider()?.id }) }); }
  catch (e) { throw { code: e && e.name === 'AbortError' ? 'cancelled' : 'unavailable' }; }
  if (res.status === 401) throw { code: 'signed_out' };
  if (res.status === 429) throw { code: 'daily_limit' };
  if (res.status === 503) throw { code: 'not_configured' };
  if (!res.ok || !res.body) throw { code: 'unavailable' };
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') onEvent({ type: 'text', delta: ev.delta.text });
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') onEvent({ type: 'thinking', delta: ev.delta.thinking });
        else if (ev.type === 'error') onEvent({ type: 'error', message: 'The AI didn’t answer. Try again.' });
      }
    }
  } catch (e) { throw { code: signal && signal.aborted ? 'cancelled' : 'unavailable' }; }
}

export const errorText = e => ({
  signed_out: 'Your session ended. Sign in again to use AI.',
  daily_limit: 'Today’s AI requests are used up. They reset at midnight UTC.',
  not_configured: 'AI isn’t set up on this server yet (NVIDIA_API_KEY or ANTHROPIC_API_KEY on the backend).',
  no_agent: 'That agent was deleted. Start a new chat.',
  image_unsupported: 'This model doesn’t read pictures. Pick Claude in the model menu, or send text.',
})[e && e.code] || (e && e.message) || 'The AI didn’t answer. Try again.';

// How a tool use reads in the chat.
export function toolLabel(p) {
  const i = p.input || {};
  switch (p.name) {
    case 'list_workflows': return 'Looked at your workflows';
    case 'run_workflow': return `Ran a workflow${i.input && Object.keys(i.input).length ? ` with ${Object.keys(i.input).join(', ')}` : ''}`;
    case 'find_nodes': return `Searched the nodes for “${i.query || ''}”`;
    case 'run_node': return `Ran the node ${i.type || ''}`;
    case 'list_credentials': return 'Looked at your connected accounts';
    case 'list_files': return i.query ? `Looked for files about “${i.query}”` : 'Looked at your files';
    case 'read_file': return 'Read a file';
    case 'create_doc': return `Wrote the doc “${i.title || 'Untitled'}”`;
    case 'create_agent': return `Made the agent “${i.name || 'Untitled'}”`;
    default: return p.name;
  }
}
