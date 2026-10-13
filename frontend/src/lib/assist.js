import { sampleP } from './ai.js';

/* The AI assistant in each section (Sheet, Database, Code, Workflow, App). A section describes itself:
     {section, intro, chips: [{label, prompt}], context(): text the AI sees, rules: the changes it may
      propose (as JSON), apply(change) → a short confirmation, applyLabel(change) → the button's text}
   The AI answers {reply, apply}: words for the person, and at most one change, which is made only when
   they press its button. */

const MAX_CONTEXT = 60_000;

export function assistPrompt(cfg, request, history = []) {
  const ctx = String(cfg.context ? cfg.context() : '').slice(0, MAX_CONTEXT);
  const talk = history.slice(-6).map(m => (m.who === 'u' ? 'User: ' : 'You: ') + m.text).join('\n').slice(-4000);
  return `You are the AI assistant in the ${cfg.section} of Workline, a workspace for diagrams, docs, sheets, databases, code, workflows and apps. Help with exactly what the user asks, using what they're looking at.

What the user is looking at:
<<<
${ctx || '(nothing yet)'}
>>>
${talk ? `\nEarlier in this conversation:\n${talk}\n` : ''}
Request:
<<<
${request}
>>>

Reply with only a JSON object, no markdown fence:
{"reply": "your answer for the user: short and plain, at most about 12 lines; say what the change does if you propose one", "apply": null or ONE change below}

Changes you may propose (only when the user wants something made or changed, not for questions):
${cfg.rules}`;
}

// Ask; returns {reply, apply}.
export async function askAssist(cfg, request, history, { signal } = {}) {
  const sample = await sampleP;
  if (!sample) throw { code: 'off' };
  const out = await sample.json(assistPrompt(cfg, request, history), { signal, cache: false });
  return { reply: String(out.reply || '').trim() || 'Done.', apply: out.apply && typeof out.apply === 'object' ? out.apply : null };
}
