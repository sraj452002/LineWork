import { useRef, useState } from 'react';
import { APP_ICONS, iconImage, isImageIcon } from '../lib/apps.js';

/* An app's or page's icon: an emoji, or a picture of your own (a small PNG kept as a data: URL). */
export function AppIcon({ icon, fallback = '✨', className, alt = '' }) {
  if (isImageIcon(icon)) return <img className={'app-img-icon' + (className ? ' ' + className : '')} src={icon} alt={alt} draggable="false" />;
  return <>{icon || fallback}</>;
}

/* Choosing it: one of the ready emoji, any emoji you type, or a picture you upload (made square and
   small, size × size pixels). Wherever something is published or built as an app. */
export function IconPicker({ value, onChange, size = 256, label = 'Icon' }) {
  const file = useRef(null);
  const [err, setErr] = useState('');
  const custom = value && !APP_ICONS.includes(value) && !isImageIcon(value) ? value : '';
  const upload = async f => {
    setErr('');
    if (!f) return;
    try { onChange(await iconImage(f, size)); } catch (e) { setErr(e.message || 'That picture couldn’t be used.'); }
  };
  return (
    <div className="fv-f icon-pick"><span>{label}</span>
      <div className="fv-pub-icons">
        {APP_ICONS.map(ic => <button key={ic} type="button" aria-pressed={value === ic} onClick={() => onChange(ic)}>{ic}</button>)}
        {isImageIcon(value) && <button type="button" aria-pressed="true" title="Your picture" aria-label="Your picture"><AppIcon icon={value} /></button>}
      </div>
      <div className="icon-own">
        <input aria-label="Your own emoji" placeholder="Or type any emoji: 🦄" value={custom} maxLength={8}
          onChange={e => { const v = e.target.value.trim(); if (v) onChange(v); }} />
        <button type="button" className="btn" onClick={() => file.current?.click()}>⬆ Upload a picture</button>
        {isImageIcon(value) && <button type="button" className="btn" onClick={() => onChange(APP_ICONS[0])}>Remove picture</button>}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden aria-label="Icon picture"
          onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} />
      </div>
      {err && <small className="err">{err}</small>}
    </div>
  );
}
