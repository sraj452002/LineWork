import { useLayoutEffect, useRef, useState } from 'react';
import { interpolate, srcOf } from '../lib/course.js';

/* Drawing course slides and objects (the Course view, its slide list and Course Studio's cards). */

// How an object looks (the same as the player draws it).
export function lookOf(o, st = 'normal') { return { ...o.style, ...(st !== 'normal' ? o.states?.[st] || {} : {}) }; }
export function boxStyle(o, s) {
  return {
    left: o.x, top: o.y, width: o.w, height: o.h, background: s.fill && s.fill !== 'transparent' ? s.fill : 'transparent', color: s.color, fontSize: s.size || 18,
    fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? 'italic' : undefined, textAlign: s.align || 'left', borderRadius: s.shape === 'ellipse' ? '50%' : (s.radius || 0),
    border: s.borderW ? `${s.borderW}px solid ${s.border || 'transparent'}` : 0, opacity: s.opacity ?? undefined, boxShadow: s.shadow ? '0 10px 30px rgba(20,24,60,.18)' : undefined,
    justifyContent: s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start',
  };
}
export function ObjArt({ o, st = 'normal', vars = {}, assets }) {
  const s = lookOf(o, st);
  const text = s.text != null ? s.text : o.text;
  if (o.kind === 'image') { const src = srcOf({ assets }, s.src || o.src); return src ? <img src={src} alt="" style={{ objectFit: s.fit || 'cover' }} draggable={false} /> : <span className="cv-ph">Picture</span>; }
  if (o.kind === 'input') return <span className="cv-input">{o.var ? `${o.placeholder || ''}  → %${o.var}%` : o.placeholder}</span>;
  if (o.kind === 'video') return <span className="cv-ph dark">▶ Video{o.src ? '' : ' (add a link)'}</span>;
  if (o.kind === 'audio') return <span className="cv-ph">♪ Audio{o.src ? '' : ' (add a link)'}</span>;
  if (o.kind === 'hotspot') return <span className="cv-hot" />;
  if (o.kind === 'question') {
    const Q = o.q || {};
    return (
      <div className="cv-q">
        <b>{interpolate(Q.prompt, vars)}</b>
        {Q.type === 'fill' ? <span className="cv-qf">Type your answer</span> : (Q.choices || []).map((c, i) => <span key={c.id} className="cv-qo"><i className={Q.type === 'mr' ? 'sq' : Q.type === 'order' ? 'num' : ''}>{Q.type === 'order' ? i + 1 : ''}</i>{c.text}{c.correct && Q.type !== 'order' && <em>✓</em>}</span>)}
        <span className="cv-qs">Submit</span>
      </div>
    );
  }
  if (o.kind === 'result') return <div className="cv-r"><span className="cv-ring"><b>80%</b></span><b>{interpolate(text, { ...vars, 'Quiz.Percent': 80 })}</b><small>Score, pass or fail, and Retry</small></div>;
  return <div className="cv-t">{interpolate(text, vars)}</div>;
}
export const defaultsOf = c => Object.fromEntries((c.vars || []).map(v => [v.name, v.value === '' ? `%${v.name}%` : v.value]));

// A slide drawn small (the slide list).
export function Thumb({ slide, course }) {
  const vars = defaultsOf(course);
  const ref = useRef(null), [k, setK] = useState(0.17);
  useLayoutEffect(() => { const el = ref.current; if (!el) return undefined; const f = () => el.clientWidth && setK(el.clientWidth / course.size.w); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, [course.size.w]);
  return (
    <div className="cv-thumb" ref={ref} style={{ background: slide.bg, aspectRatio: `${course.size.w} / ${course.size.h}` }}>
      <div className="cv-thumb-in" style={{ width: course.size.w, height: course.size.h, transform: `scale(${k})` }}>
        {slide.layers[0].objects.filter(o => o.initial !== 'hidden').map(o => <div key={o.id} className={'cv-o k-' + o.kind} style={boxStyle(o, lookOf(o, o.initial || 'normal'))}><ObjArt o={o} st={o.initial || 'normal'} vars={vars} assets={course.assets} /></div>)}
      </div>
    </div>
  );
}

