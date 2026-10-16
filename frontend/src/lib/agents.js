/* The account's AI agents (backend/flows.js keeps them; agent.js runs them): list, save, delete. */
import { api } from './backend.js';

export const AGENT_TOOLS = [
  ['workflows', 'Run my workflows', 'List and run your workflows (or only the ones picked below)'],
  ['nodes', 'Run nodes', 'Any of the 650 nodes: text, dates, AI, apps with your saved accounts'],
  ['files', 'Read my files', 'Your docs, sheets, diagrams and workflows'],
  ['docs', 'Write docs', 'Save what it writes as a new doc'],
];
export const listAgents = () => api('/agents').then(r => r.agents || []);
export const saveAgent = agent => (agent.id
  ? api(`/agents/${encodeURIComponent(agent.id)}`, { method: 'PUT', body: agent })
  : api('/agents', { method: 'POST', body: agent })).then(r => r.agent);
export const deleteAgent = id => api(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
