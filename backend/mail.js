/* Sending email: confirm-your-address and reset-your-password links.
   RESEND_API_KEY uses Resend's HTTP API; SMTP_URL (smtp[s]://user:pass@host:port) any SMTP service.
   With neither, nothing is sent: accounts don't need confirming, and passwords are reset with
   `npm run admin -- reset-password`. */

export function createMailer({ resendKey = '', smtpUrl = '', from = '' } = {}) {
  if (resendKey) {
    return {
      configured: true,
      async send({ to, subject, text, html }) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: from || 'Workline <onboarding@resend.dev>', to: [to], subject, text, html }),
        });
        if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text().catch(() => '')}`);
      },
    };
  }
  if (smtpUrl) {
    let transport;
    return {
      configured: true,
      async send({ to, subject, text, html }) {
        if (!transport) transport = (await import('nodemailer')).default.createTransport(smtpUrl);
        await transport.sendMail({ from: from || 'Workline <no-reply@localhost>', to, subject, text, html });
      },
    };
  }
  return { configured: false, async send() { throw new Error('Email isn’t set up on this server.'); } };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// One short message with one button.
export function linkEmail({ title, intro, button, url, outro }) {
  const text = `${intro}\n\n${button}: ${url}\n\n${outro}\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2320">
<div style="max-width:480px;margin:32px auto;background:#fff;border-radius:14px;padding:28px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
<p style="line-height:1.5;margin:0 0 20px">${esc(intro)}</p>
<p style="margin:0 0 20px"><a href="${esc(url)}" style="display:inline-block;background:#1d2320;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:600">${esc(button)}</a></p>
<p style="line-height:1.5;margin:0;color:#5c655f;font-size:13px">${esc(outro)}</p>
</div></body></html>`;
  return { subject: title, text, html };
}
