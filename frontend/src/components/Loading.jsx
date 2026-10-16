// Something is on its way: a turning ring, centred where it's shown (inline: beside text).
export default function Loading({ label = 'Loading', inline = false, className = '' }) {
  return <span className={`lw-loading${inline ? ' inline' : ''}${className ? ` ${className}` : ''}`} role="status" aria-label={label} title={label}><i aria-hidden="true" /></span>;
}
