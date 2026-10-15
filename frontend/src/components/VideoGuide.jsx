import { useEffect, useMemo, useState } from 'react';
import { NODES } from '../lib/flows.js';
import { nodeVideos, nodeVideoUrl } from '../lib/nodevideos.js';

/* The video guides: recorded videos of the real app (frontend/public/guides/*.mp4, with music), and a
   short video of every workflow node with an example (scripts/node-videos.mjs). */

export const VIDEO_GUIDES = [
  { id: 'workflow', title: 'Build a workflow in 60 seconds', blurb: 'Add nodes, connect them, run them, see the output and publish.' },
  { id: 'tour', title: 'A tour of WorkLine', blurb: 'Docs, diagrams, sheets, databases, workflows and apps, in one place.' },
];

// Every node, findable by name or group; the one picked plays above the list.
function NodeVideos() {
  const [index, setIndex] = useState(null), [q, setQ] = useState(''), [pick, setPick] = useState(null);
  useEffect(() => { nodeVideos().then(setIndex); }, []);
  const all = useMemo(() => Object.entries(NODES).filter(([t]) => index && index[t]), [index]);
  const needle = q.trim().toLowerCase();
  const shown = all.filter(([t, d]) => !needle || `${d.label} ${d.group} ${d.note || ''} ${t}`.toLowerCase().includes(needle));
  if (index && !all.length) return null;
  const d = pick && NODES[pick];
  return (
    <section className="vg-item">
      <header><div><h3>Every node, with an example</h3><p>{all.length || 'All the'} short videos: each node set up with an example, run, and its output.</p></div></header>
      {d && <video key={pick} className="vg-video" controls autoPlay playsInline src={nodeVideoUrl(pick)} aria-label={`Video: ${d.label}`} />}
      <div className="nv-find"><input type="search" placeholder="Find a node (Uppercase, Slack, IF…)" aria-label="Find a node video" value={q} onChange={e => setQ(e.target.value)} /></div>
      {!index ? <p className="muted">Loading…</p> : (
        <div className="nv-list" role="list">
          {shown.slice(0, 300).map(([t, nd]) => (
            <button key={t} role="listitem" aria-pressed={pick === t} onClick={() => setPick(t)} aria-label={`Watch ${nd.label}`}>
              <b>▶ {nd.label}</b><small>{nd.group} · {Math.round(index[t])}s</small>
            </button>
          ))}
          {!shown.length && <p className="muted">No node matches.</p>}
        </div>
      )}
    </section>
  );
}

export default function VideoGuides() {
  return (
    <div className="vgs">
      {VIDEO_GUIDES.map(g => (
        <section key={g.id} className="vg-item">
          <header><div><h3>{g.title}</h3><p>{g.blurb}</p></div></header>
          <video className="vg-video" controls playsInline preload="metadata" poster={`/guides/${g.id}.jpg`} src={`/guides/${g.id}.mp4`} aria-label={`Video: ${g.title}`} />
        </section>
      ))}
      <NodeVideos />
    </div>
  );
}
