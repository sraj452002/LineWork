/* Missions (agent.js): a goal Nemo works through by itself, and what Nemo and the agents remember. */
import { api } from './backend.js';

export const listMissions = () => api('/missions').then(r => r.missions || []);
export const getMission = id => api(`/missions/${encodeURIComponent(id)}`).then(r => r.mission);
export const startMission = m => api('/missions', { method: 'POST', body: m }).then(r => r.mission);
export const answerMission = (id, body) => api(`/missions/${encodeURIComponent(id)}/answer`, { method: 'POST', body }).then(r => r.mission);
export const stopMission = id => api(`/missions/${encodeURIComponent(id)}/stop`, { method: 'POST' }).then(r => r.mission);
export const rerunMission = id => api(`/missions/${encodeURIComponent(id)}/run`, { method: 'POST' }).then(r => r.mission);
export const updateMission = (id, body) => api(`/missions/${encodeURIComponent(id)}`, { method: 'PUT', body }).then(r => r.mission);
export const deleteMission = id => api(`/missions/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const listMemory = () => api('/memory').then(r => r.memory || []);
export const addMemory = text => api('/memory', { method: 'POST', body: { text } });
export const deleteMemory = id => api(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const APPROVE = [['risky', 'Ask me before it sends, runs or changes something'], ['all', 'Ask me before every step'], ['never', 'Don’t ask: do it all by itself']];
export const SCHEDULE = [['', 'Once'], ['hour', 'Every hour'], ['day', 'Every day'], ['week', 'Every week']];
export const STATUS = { running: 'Working', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' };
