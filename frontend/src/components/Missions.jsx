import { useEffect, useRef, useState } from 'react';
import { md } from '../lib/markdown.js';
import { ago } from '../lib/utils.js';
import { APPROVE, SCHEDULE, STATUS, addMemory, answerMission, deleteMemory, deleteMission, getMission, listMemory, listMissions, rerunMission, startMission, stopMission, updateMission } from '../lib/missions.js';

/* Missions: give Nemo a goal and it works through it by itself in the background: it writes a plan, does
   the steps with your workflows, nodes, files and agents (a team), ticks them off and ends with a summary.
   It stops for you where it matters (a yes before it sends or runs something, an answer when it needs one),
   and can repeat on a schedule. Memory: what Nemo and your agents remember for next time. */

const TOOL = { update_plan: 'Planned', finish_step: 'Ticked off a step', run_workflow: 'Ran a workflow', run_node: 'Ran a node', find_nodes: 'Looked for nodes', create_workflow: 'Made a workflow', create_doc: 'Wrote a doc', read_file: 'Read a file', list_files: 'Looked at your files', list_workflows: 'Looked at your workflows', ask_agent: 'Asked an agent', list_agents: 'Looked at your agents', remember: 'Remembered', recall: 'Recalled', forget: 'Forgot', ask_user: 'Asked you', list_credentials: 'Looked at your accounts' };
const say = t => TOOL[t] || t;
const Chip = ({ status }) => <span className={'ms-chip s-' + status}>{status === 'running' && <i className="ms-pulse" />}{STATUS[status] || status}</span>;

function NewMission({ agents, onStart, onCancel }) {
  const [goal, setGoal] = useState(''), [team, setTeam] = useState([]), [approve, setApprove] = useState('risky'), [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault(); if (!goal.trim()) return;
    setBusy(true); setErr('');
    try { onStart(await startMission({ goal, team, approve, schedule })); } catch (x) { setErr(x.message || 'It couldn’t start.'); setBusy(false); }
  };
  return (
    <form className="ms-new" onSubmit={go} aria-label="New mission">
      <h3>A new mission</h3>
      <label className="ms-f"><span>The goal</span><textarea value={goal} onChange={e => setGoal(e.target.value)} rows={4} autoFocus aria-label="The goal" placeholder="e.g. Find this week’s new leads in my Leads sheet, write each a short welcome email draft in a doc, and tell me how many there were." /></label>
      {agents.length > 0 && <fieldset className="ms-team"><legend>Team (agents it can hand parts to)</legend>
        {agents.map(a => <label key={a.id} className={team.includes(a.id) ? 'on' : ''}><input type="checkbox" checked={team.includes(a.id)} onChange={e => setTeam(t => (e.target.checked ? [...t, a.id] : t.filter(x => x !== a.id)))} aria-label={`Team: ${a.name}`} /><i aria-hidden="true">{a.icon}</i>{a.name}</label>)}
      </fieldset>}
      <div className="ms-row">
        <label className="ms-f"><span>Ask me first</span><select value={approve} onChange={e => setApprove(e.target.value)} aria-label="Ask me first">{APPROVE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="ms-f"><span>Repeat</span><select value={schedule} onChange={e => setSchedule(e.target.value)} aria-label="Repeat">{SCHEDULE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      {err && <p className="rev-err" role="alert">{err}</p>}
      <div className="ms-acts"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy || !goal.trim()}>{busy ? 'Starting…' : '🎯 Start the mission'}</button></div>
    </form>
  );
}

function Waiting({ m, onAnswer }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const p = m.pending;
  const go = async body => { setBusy(true); try { await onAnswer(body); } finally { setBusy(false); setNote(''); } };
  return (
    <section className="ms-wait" role="alert" aria-label="It needs you">
      {p.kind === 'question' ? (<>
        <b>❓ It asks: {p.question}</b>
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} aria-label="Your answer" placeholder="Your answer" />
        <div className="ms-acts"><button className="btn primary" disabled={busy || !note.trim()} onClick={() => go({ note })}>Send the answer</button></div>
      </>) : (<>
        <b>✋ It wants to: {say(p.name).toLowerCase()}</b>
        <pre className="ms-input">{JSON.stringify(p.input, null, 2)}</pre>
        <input value={note} onChange={e => setNote(e.target.value)} aria-label="A note (optional)" placeholder="A note for it (optional)" />
        <div className="ms-acts"><button className="btn" disabled={busy} onClick={() => go({ ok: false, note })}>No</button><button className="btn primary" disabled={busy} onClick={() => go({ ok: true, note })}>Yes, go ahead</button></div>
      </>)}
    </section>
  );
}

function Detail({ id, agents, onBack, onGone }) {
  const [m, setM] = useState(null), [err, setErr] = useState('');
  const timer = useRef(0);
  const load = () => getMission(id).then(setM, e => setErr(e.message || 'It’s gone.'));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // While it works, check every second and a half.
  useEffect(() => { clearTimeout(timer.current); if (m && m.status === 'running') timer.current = setTimeout(load, 1500); return () => clearTimeout(timer.current); }, [m]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="ms-pane"><button className="link" onClick={onBack}>‹ Missions</button><p className="muted">{err}</p></div>;
  if (!m) return <div className="ms-pane"><p className="muted">Loading…</p></div>;
  const done = (m.plan || []).filter(s => s.status === 'done' || s.status === 'skipped').length, total = (m.plan || []).length;
  const team = (m.team || []).map(t => agents.find(a => a.id === t)).filter(Boolean);
  return (
    <div className="ms-pane" aria-label={`Mission: ${m.title}`}>
      <button className="link ms-back" onClick={onBack}>‹ Missions</button>
      <header className="ms-head">
        <div><h2>{m.title}</h2><p className="muted">{m.goal}</p></div>
        <Chip status={m.status} />
      </header>
      <div className="ms-meta">
        {team.length > 0 && <span>Team: {team.map(a => `${a.icon} ${a.name}`).join(', ')}</span>}
        <label>Repeat <select value={m.schedule || ''} onChange={async e => setM(await updateMission(m.id, { schedule: e.target.value || null }))} aria-label="Repeat">{SCHEDULE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {m.schedule && m.nextAt && <span>Next run {new Date(m.nextAt).toLocaleString()}</span>}
        <span className="grow" />
        {(m.status === 'running' || m.status === 'waiting') && <button className="btn" onClick={async () => setM(await stopMission(m.id))}>■ Stop</button>}
        {(m.status === 'done' || m.status === 'failed' || m.status === 'stopped') && <button className="btn" onClick={async () => setM(await rerunMission(m.id))}>{m.status === 'done' ? '↻ Run again' : '▶ Carry on'}</button>}
        <button className="btn" onClick={async () => { await deleteMission(m.id); onGone(); }}>Delete</button>
      </div>
      {m.status === 'waiting' && m.pending && <Waiting m={m} onAnswer={async body => setM(await answerMission(m.id, body))} />}
      <div className="ms-cols">
        <section className="ms-plan" aria-label="The plan">
          <h3>Plan {total > 0 && <small>{done} of {total}</small>}</h3>
          {total ? <ol>{m.plan.map((s, i) => <li key={i} className={'st-' + s.status}><i aria-hidden="true">{s.status === 'done' ? '✓' : s.status === 'skipped' ? '–' : s.status === 'doing' ? '' : i + 1}</i><div><b>{s.title}</b>{s.agent && agents.find(a => a.id === s.agent) && <small> · {agents.find(a => a.id === s.agent).icon} {agents.find(a => a.id === s.agent).name}</small>}{s.result && <p>{s.result}</p>}</div></li>)}</ol>
            : <p className="muted">{m.status === 'running' ? 'Making a plan…' : 'No plan yet.'}</p>}
          {(m.result || m.error) && <div className={'ms-result' + (m.error && !m.result ? ' bad' : '')}><h3>{m.result ? 'Result' : 'What happened'}</h3><div className="md" dangerouslySetInnerHTML={{ __html: md(m.result || m.error) }} /></div>}
        </section>
        <section className="ms-log" aria-label="What it did">
          <h3>Activity</h3>
          <ol>{[...(m.log || [])].reverse().map((e, i) => (
            <li key={i} className={'ev-' + e.type}>
              <time>{new Date(e.t).toLocaleTimeString()}</time>
              <span>{e.type === 'text' ? e.text.slice(0, 400) : e.type === 'tool' ? `→ ${say(e.tool)}` : e.type === 'tool_done' ? `${e.ok ? '✓' : '✗'} ${say(e.tool)}` : e.type === 'wait' ? (e.kind === 'question' ? 'Waiting for your answer' : `Waiting for your yes: ${say(e.tool).toLowerCase()}`) : e.type === 'yes' ? 'You said yes' : e.type === 'no' ? `You said no${e.text ? `: ${e.text}` : ''}` : e.type === 'answer' ? `You answered: ${e.text}` : e.type === 'plan' ? `Plan: ${e.steps} steps` : e.type === 'step' ? `${e.status === 'done' ? '✓' : '–'} Step ${e.step}: ${e.title}` : e.type === 'start' ? 'Started' : e.type === 'resume' ? 'Carried on' : e.type === 'done' ? 'Finished' : e.text || e.type}</span>
            </li>
          ))}</ol>
        </section>
      </div>
    </div>
  );
}

export function Missions({ agents }) {
  const [list, setList] = useState(null), [open, setOpen] = useState(null), [making, setMaking] = useState(false);
  const load = () => listMissions().then(setList, () => setList([]));
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  if (open) return <Detail id={open} agents={agents} onBack={() => { setOpen(null); load(); }} onGone={() => { setOpen(null); load(); }} />;
  return (
    <div className="ms-pane" aria-label="Missions">
      <header className="ms-top">
        <div><h2>🎯 Missions</h2><p className="muted">Give Nemo a goal: it plans, does the steps with your workflows, files and agents, asks you where it matters, and reports back. It works in the background, and can repeat on a schedule.</p></div>
        {!making && <button className="btn primary" onClick={() => setMaking(true)}>＋ New mission</button>}
      </header>
      {making && <NewMission agents={agents} onCancel={() => setMaking(false)} onStart={m => { setMaking(false); setOpen(m.id); }} />}
      {list === null ? <p className="muted">Loading…</p> : list.length ? (
        <ul className="ms-list">
          {list.map(m => {
            const done = (m.plan || []).filter(s => s.status === 'done' || s.status === 'skipped').length, total = (m.plan || []).length;
            return (
              <li key={m.id}><button onClick={() => setOpen(m.id)} aria-label={`Open the mission ${m.title}`}>
                <div className="ms-l1"><b>{m.title}</b><Chip status={m.status} /></div>
                {total > 0 && <div className="ms-bar" aria-hidden="true"><i style={{ width: `${(done / total) * 100}%` }} /></div>}
                <small>{total ? `${done} of ${total} steps` : 'Planning'}{m.schedule ? ` · repeats every ${m.schedule}` : ''} · {ago(m.updated)}</small>
              </button></li>
            );
          })}
        </ul>
      ) : !making && <p className="ms-empty">No missions yet. Start one: Nemo works through it while you do other things.</p>}
    </div>
  );
}

export function Memory() {
  const [list, setList] = useState(null), [text, setText] = useState('');
  const load = () => listMemory().then(setList, () => setList([]));
  useEffect(() => { load(); }, []);
  return (
    <div className="ms-pane" aria-label="Memory">
      <header className="ms-top"><div><h2>🧠 Memory</h2><p className="muted">What Nemo and your agents remember between chats and missions: your preferences, decisions, where things are. Remove anything that’s wrong.</p></div></header>
      <form className="ms-addmem" onSubmit={async e => { e.preventDefault(); if (!text.trim()) return; await addMemory(text).catch(() => {}); setText(''); load(); }}>
        <input value={text} onChange={e => setText(e.target.value)} aria-label="Something to remember" placeholder="Something Nemo should remember, e.g. “My reports go to the #ops channel”" />
        <button className="btn primary" disabled={!text.trim()}>Remember</button>
      </form>
      {list === null ? <p className="muted">Loading…</p> : list.length ? (
        <ul className="ms-mem">{list.map(x => <li key={x.id}><span>{x.text}</span><small>{x.agentName ? `${x.agentName} · ` : ''}{ago(x.at)}</small><button className="as-del" aria-label={`Forget: ${x.text}`} title="Forget" onClick={async () => { await deleteMemory(x.id).catch(() => {}); load(); }}>×</button></li>)}</ul>
      ) : <p className="ms-empty">Nothing yet. Nemo remembers things as you work together, or add them here.</p>}
    </div>
  );
}
