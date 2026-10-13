import { memo, useMemo } from 'react';
import { dashboardDoc } from '../lib/dashboard.js';

/* A dashboard block's live view: its HTML in a sandboxed frame (scripts run, but with no access to the
   app, its storage or cookies). The frame only reloads when the HTML, data or colours change. */
function DashFrame({ html, data, theme, title }) {
  const doc = useMemo(() => dashboardDoc(html, data, theme), [html, data, theme]);
  return <iframe title={title} sandbox="allow-scripts" srcDoc={doc} referrerPolicy="no-referrer" />;
}
export default memo(DashFrame);
