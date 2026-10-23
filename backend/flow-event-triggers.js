import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { FlowError } from './flow-engine.js';
import { failIfBad, need, request } from './flow-util.js';

/* Triggers for chat and notification events of popular apps (see flow-triggers.js for how hooks and
   polls work). Each checks the app's own signature when its secret is filled in, and turns the event
   into one item per message or event.
   - Chat: Microsoft Teams, Google Chat, Facebook Messenger, Instagram, Twilio (SMS and WhatsApp), LINE,
     Intercom, Zendesk, and Discord channel messages (looked for with a bot).
   - Events: Zoom, Sentry, PagerDuty, Twitch, Notion, Trello, ClickUp, Mailchimp, Bitbucket, Vercel,
     Netlify, Tally, Cal.com, and ntfy notifications (looked for). */

const pass = { run: ({ items: list }) => ({ main: list }) };
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };
const hmac = (secret, data, enc = 'hex', algo = 'sha256') => createHmac(algo, secret).update(data).digest(enc);
const bad = message => ({ status: 401, error: 'bad_signature', message });
const ignored = why => ({ respond: { status: 200, body: { ok: true, ignored: why ?? null } } });
const raw = req => (req.raw ? req.raw.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''));
const wanted = (list, ...names) => {
  const want = String(list || '').split(/[\s,]+/).filter(Boolean).map(s => s.toLowerCase());
  return !want.length || names.filter(Boolean).map(n => String(n).toLowerCase()).some(n => want.includes(n) || want.includes(n.split(/[./:]/)[0]));
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = t => (t ? new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t).toISOString() : null);
// The addresses this request may have been sent to (some apps sign the URL too): as the app saw it, via
// the site's proxy, or straight to this server.
const urlsOf = req => {
  const path = req.originalUrl || req.url, proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const hosts = [req.headers['x-forwarded-host'], req.headers.host].filter(Boolean).map(h => String(h).split(',')[0].trim());
  return [...new Set(hosts.flatMap(h => [`${proto}://${h}${path}`, `https://${h}${path}`]))];
};
// Meta (Messenger, Instagram, WhatsApp): the URL check with the verify token, then signed events.
const metaCheck = (req, p) => {
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q['hub.mode'] === 'subscribe' && p.verifyToken && same(q['hub.verify_token'], p.verifyToken)) return { respond: { status: 200, type: 'text', body: String(q['hub.challenge'] ?? '') } };
    return { status: 403, error: 'bad_token', message: 'The verify token doesn’t match the one in the node.' };
  }
  if (p.secret && !same(req.headers['x-hub-signature-256'], `sha256=${hmac(p.secret, raw(req))}`)) return bad('The signature doesn’t match the app secret.');
  return null;
};

export const EVENT_TRIGGERS = {
  /* ================= chat ================= */
  // Teams: an outgoing webhook (a team's Apps → Create an outgoing webhook); @mentions of it come here.
  'trigger.teams': { ...pass, hook(req, p) {
    if (p.secret) {
      let key; try { key = Buffer.from(String(p.secret), 'base64'); } catch (e) { key = Buffer.from(''); }
      if (!same(req.headers.authorization, `HMAC ${hmac(key, req.raw || Buffer.from(raw(req)), 'base64')}`)) return bad('The Teams signature doesn’t match the security token.');
    }
    const b = req.body || {};
    const text = String(b.text || '').replace(/<at>[^<]*<\/at>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    return { items: [{ json: { text, from: b.from?.name || null, fromId: b.from?.aadObjectId || b.from?.id || null, conversationId: b.conversation?.id || null, channelId: b.channelData?.channel?.id || null, teamId: b.channelData?.team?.id || null, messageId: b.id || null, message: b } }],
      respond: { status: 200, body: { type: 'message', text: String(p.reply || 'Got it ✓') } } };
  } },
  // Google Chat: a Chat app with an HTTP endpoint; messages, and being added to a space.
  'trigger.googlechat': { ...pass, hook(req, p) {
    if (p.secret && !same(req.query?.key, p.secret)) return bad('Add ?key=<the secret> to the URL in the Chat app’s settings.');
    const b = req.body || {}, type = b.type || (b.chat?.messagePayload ? 'MESSAGE' : null);
    const m = b.message || b.chat?.messagePayload?.message || {};
    if (!wanted(p.events, type)) return ignored(type);
    return { items: [{ json: { type, text: m.argumentText?.trim() || m.text || null, from: m.sender?.displayName || b.user?.displayName || null, email: m.sender?.email || b.user?.email || null, space: b.space?.name || m.space?.name || null, thread: m.thread?.name || null, event: b } }],
      respond: { status: 200, body: type === 'ADDED_TO_SPACE' ? { text: String(p.welcome || 'Thanks for adding me!') } : { text: String(p.reply || 'Got it ✓') } } };
  } },
  'trigger.messenger': { ...pass, hook(req, p) {
    const stop = metaCheck(req, p); if (stop) return stop;
    const items = [];
    for (const e of (req.body || {}).entry || []) for (const m of e.messaging || []) {
      if (!m.message && !m.postback) continue;
      if (m.message?.is_echo) continue; // the page's own replies
      items.push({ json: { senderId: m.sender?.id, pageId: m.recipient?.id || e.id, text: m.message?.text ?? m.postback?.title ?? null, payload: m.postback?.payload ?? m.message?.quick_reply?.payload ?? null, attachments: (m.message?.attachments || []).map(a => ({ type: a.type, url: a.payload?.url })), messageId: m.message?.mid || null, timestamp: iso(m.timestamp) } });
    }
    return items.length ? { items } : ignored('no messages');
  } },
  'trigger.instagram': { ...pass, hook(req, p) {
    const stop = metaCheck(req, p); if (stop) return stop;
    const items = [];
    for (const e of (req.body || {}).entry || []) {
      for (const m of e.messaging || []) if (m.message && !m.message.is_echo) items.push({ json: { kind: 'message', senderId: m.sender?.id, accountId: m.recipient?.id || e.id, text: m.message.text ?? null, attachments: (m.message.attachments || []).map(a => ({ type: a.type, url: a.payload?.url })), messageId: m.message.mid, timestamp: iso(m.timestamp) } });
      for (const ch of e.changes || []) if (['comments', 'mentions', 'live_comments'].includes(ch.field)) items.push({ json: { kind: ch.field === 'mentions' ? 'mention' : 'comment', commentId: ch.value?.id || ch.value?.comment_id || null, text: ch.value?.text ?? null, from: ch.value?.from?.username || null, mediaId: ch.value?.media?.id || ch.value?.media_id || null, accountId: e.id } });
    }
    return items.length ? { items } : ignored('nothing new');
  } },
  // Twilio: an SMS or WhatsApp message to your number; answered with TwiML (a reply, or nothing).
  'trigger.twilio': { ...pass, hook(req, p) {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (p.secret) {
      const params = Object.keys(b).sort().map(k => `${k}${b[k]}`).join('');
      if (!urlsOf(req).some(u => same(req.headers['x-twilio-signature'], hmac(String(p.secret), u + params, 'base64', 'sha1')))) return bad('The Twilio signature doesn’t match the auth token (or the URL in Twilio isn’t this one).');
    }
    const whatsapp = String(b.From || '').startsWith('whatsapp:');
    const media = Array.from({ length: Number(b.NumMedia) || 0 }, (_, i) => ({ url: b[`MediaUrl${i}`], type: b[`MediaContentType${i}`] }));
    const twiml = p.reply ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(p.reply)}</Message></Response>` : '<?xml version="1.0" encoding="UTF-8"?><Response/>';
    return { items: [{ json: { from: String(b.From || '').replace(/^whatsapp:/, ''), to: String(b.To || '').replace(/^whatsapp:/, ''), text: b.Body ?? '', channel: whatsapp ? 'whatsapp' : 'sms', name: b.ProfileName || null, media, messageSid: b.MessageSid || b.SmsSid || null, city: b.FromCity || null, country: b.FromCountry || null } }],
      respond: { status: 200, type: 'xml', body: twiml } };
  } },
  'trigger.line': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-line-signature'], hmac(String(p.secret), raw(req), 'base64'))) return bad('The LINE signature doesn’t match the channel secret.');
    const items = ((req.body || {}).events || []).filter(e => wanted(p.events, e.type)).map(e => ({ json: { type: e.type, text: e.message?.text ?? null, messageType: e.message?.type || null, userId: e.source?.userId || null, groupId: e.source?.groupId || e.source?.roomId || null, replyToken: e.replyToken || null, timestamp: iso(e.timestamp), event: e } }));
    return items.length ? { items } : ignored('no events'); // LINE's “Verify” sends none
  } },
  'trigger.intercom': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-hub-signature'], `sha1=${hmac(String(p.secret), raw(req), 'hex', 'sha1')}`)) return bad('The Intercom signature doesn’t match the app’s client secret.');
    const b = req.body || {}, x = b.data?.item || {};
    if (b.topic === 'ping') return ignored('ping');
    if (!wanted(p.events, b.topic)) return ignored(b.topic);
    const part = x.conversation_parts?.conversation_parts?.slice(-1)[0];
    const text = String(part?.body ?? x.source?.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { items: [{ json: { topic: b.topic, conversationId: x.type === 'conversation' ? x.id : null, text: text || null, author: part?.author?.name || x.source?.author?.name || x.name || null, email: part?.author?.email || x.source?.author?.email || x.email || null, state: x.state || null, link: x.type === 'conversation' && x.id ? `https://app.intercom.com/a/inbox/_/inbox/conversation/${x.id}` : null, item: x } }] };
  } },
  // Zendesk: a webhook (Admin Center → Webhooks), sent by a trigger; its JSON body is whatever you write.
  'trigger.zendesk': { ...pass, hook(req, p) {
    if (p.secret) {
      const ts = req.headers['x-zendesk-webhook-signature-timestamp'];
      if (!ts || !same(req.headers['x-zendesk-webhook-signature'], hmac(String(p.secret), `${ts}${raw(req)}`, 'base64'))) return bad('The Zendesk signature doesn’t match the webhook’s signing secret.');
    }
    const b = req.body && typeof req.body === 'object' ? req.body : { body: req.body };
    const d = b.detail || {};
    return { items: [{ json: { type: b.type || null, ticketId: d.id ?? b.ticket_id ?? b.id ?? null, subject: d.subject ?? b.subject ?? null, status: d.status ?? b.status ?? null, requester: d.requester_id ?? b.requester ?? null, data: b } }] };
  } },
  // Discord: new messages in a channel, looked for with your bot (it needs the Message Content intent).
  'trigger.discordmsg': { ...pass, async poll({ params: p, node, state, ctx }) {
    if (!node.credential) throw new FlowError('Pick a Discord bot credential.', 'no_credential');
    const c = await ctx.cred(node.credential), ch = String(need(p.channelId, 'the channel id')).replace(/^.*\/channels\/\d+\//, '').replace(/\D/g, '');
    const headers = { authorization: `Bot ${need(c.botToken, 'the bot token')}`, 'user-agent': 'WorkLine (workflow trigger)' };
    if (!state.last) {
      const top = failIfBad(await request(`https://discord.com/api/v10/channels/${ch}/messages?limit=1`, { headers }, { allowPrivate: ctx.allowPrivate }), 'Discord');
      return { items: [], state: { last: top[0]?.id || '0' } };
    }
    const list = failIfBad(await request(`https://discord.com/api/v10/channels/${ch}/messages?after=${state.last}&limit=50`, { headers }, { allowPrivate: ctx.allowPrivate }), 'Discord');
    const fresh = list.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const items = fresh.filter(m => !m.author?.bot || p.bots === true || p.bots === 'true').map(m => ({ id: m.id, channelId: ch, text: m.content, author: m.author?.username, authorId: m.author?.id, bot: !!m.author?.bot, attachments: (m.attachments || []).map(a => ({ name: a.filename, url: a.url })), mentions: (m.mentions || []).map(u => u.username), timestamp: m.timestamp }));
    return { items, state: { last: fresh.length ? fresh[fresh.length - 1].id : state.last } };
  } },

  /* ================= events and notifications ================= */
  'trigger.zoom': { ...pass, hook(req, p) {
    const b = req.body || {};
    // Zoom checks the URL: it sends a token to sign with the secret token.
    if (b.event === 'endpoint.url_validation') {
      if (!p.secret) return { status: 400, error: 'no_secret', message: 'Paste the app’s Secret Token into the node first.' };
      const plain = String(b.payload?.plainToken || '');
      return { respond: { status: 200, body: { plainToken: plain, encryptedToken: hmac(String(p.secret), plain) } } };
    }
    if (p.secret) {
      const ts = req.headers['x-zm-request-timestamp'];
      if (!same(req.headers['x-zm-signature'], `v0=${hmac(String(p.secret), `v0:${ts}:${raw(req)}`)}`)) return bad('The Zoom signature doesn’t match the secret token.');
    }
    if (!wanted(p.events, b.event)) return ignored(b.event);
    const o = b.payload?.object || {};
    return { items: [{ json: { event: b.event, topic: o.topic || null, meetingId: o.id ?? null, host: o.host_email || null, participant: o.participant?.user_name || null, participantEmail: o.participant?.email || null, start: o.start_time || null, shareUrl: o.share_url || null, recordings: (o.recording_files || []).map(f => ({ type: f.file_type, url: f.download_url, play: f.play_url })), payload: b.payload } }] };
  } },
  'trigger.sentry': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['sentry-hook-signature'], hmac(String(p.secret), raw(req)))) return bad('The Sentry signature doesn’t match the client secret.');
    const resource = req.headers['sentry-hook-resource'] || null, b = req.body || {}, d = b.data || {};
    const issue = d.issue || d.event || d.error || {};
    if (resource === 'installation') return ignored('installation');
    if (!wanted(p.events, resource && b.action ? `${resource}.${b.action}` : resource, resource)) return ignored(resource);
    return { items: [{ json: { resource, action: b.action || null, title: issue.title || d.triggered_rule || null, level: issue.level || null, culprit: issue.culprit || null, project: issue.project?.slug || issue.project || null, url: issue.web_url || issue.permalink || issue.url || null, count: issue.count ?? null, data: d } }] };
  } },
  'trigger.pagerduty': { ...pass, hook(req, p) {
    if (p.secret) {
      const want = `v1=${hmac(String(p.secret), raw(req))}`;
      if (!String(req.headers['x-pagerduty-signature'] || '').split(',').map(s => s.trim()).some(s => same(s, want))) return bad('The PagerDuty signature doesn’t match the secret.');
    }
    const e = (req.body || {}).event || {}, d = e.data || {};
    if (!wanted(p.events, e.event_type)) return ignored(e.event_type);
    return { items: [{ json: { event: e.event_type || null, incidentId: d.id || null, title: d.title || null, status: d.status || null, urgency: d.urgency || null, priority: d.priority?.summary || null, service: d.service?.summary || null, url: d.html_url || null, agent: e.agent?.summary || null, occurredAt: e.occurred_at || null, data: d } }] };
  } },
  // Twitch EventSub: stream online/offline, follows, subscriptions, cheers… (the URL is checked first).
  'trigger.twitch': { ...pass, hook(req, p) {
    const h = req.headers, b = req.body || {};
    if (p.secret && !same(h['twitch-eventsub-message-signature'], `sha256=${hmac(String(p.secret), `${h['twitch-eventsub-message-id'] || ''}${h['twitch-eventsub-message-timestamp'] || ''}${raw(req)}`)}`)) return bad('The Twitch signature doesn’t match the secret.');
    const kind = h['twitch-eventsub-message-type'];
    if (kind === 'webhook_callback_verification') return { respond: { status: 200, type: 'text', body: String(b.challenge || '') } };
    if (kind === 'revocation') return ignored('revocation');
    const type = b.subscription?.type || null, e = b.event || {};
    if (!wanted(p.events, type)) return ignored(type);
    return { items: [{ json: { type, broadcaster: e.broadcaster_user_name || e.to_broadcaster_user_name || null, user: e.user_name || e.from_broadcaster_user_name || null, message: e.message?.text ?? e.message ?? null, amount: e.bits ?? e.viewers ?? null, startedAt: e.started_at || e.followed_at || null, event: e } }] };
  } },
  // Notion: when the subscription is made, Notion sends a verification token once: it starts a run, so
  // you can copy it from the run's output into the node (it's then the signing secret).
  'trigger.notion': { ...pass, hook(req, p) {
    const b = req.body || {};
    if (b.verification_token) return { items: [{ json: { verificationToken: b.verification_token, note: 'Paste this into the node’s Verification token, and into Notion’s Verify box.' } }], respond: { status: 200, body: { ok: true } } };
    if (p.secret && !same(req.headers['x-notion-signature'], `sha256=${hmac(String(p.secret), raw(req))}`)) return bad('The Notion signature doesn’t match the verification token.');
    if (!wanted(p.events, b.type)) return ignored(b.type);
    return { items: [{ json: { type: b.type || null, entityId: b.entity?.id || null, entityType: b.entity?.type || null, workspace: b.workspace_name || null, author: b.authors?.[0]?.id || null, timestamp: b.timestamp || null, data: b.data || null } }] };
  } },
  'trigger.trello': { ...pass, hook(req, p) {
    if (req.method === 'HEAD' || req.method === 'GET') return { respond: { status: 200, type: 'text', body: 'ok' } }; // Trello checks the URL
    if (p.secret && !urlsOf(req).some(u => same(req.headers['x-trello-webhook'], hmac(String(p.secret), raw(req) + u, 'base64', 'sha1')))) return bad('The Trello signature doesn’t match the app secret (or the callback URL isn’t this one).');
    const a = (req.body || {}).action || {}, d = a.data || {};
    if (!wanted(p.events, a.type)) return ignored(a.type);
    return { items: [{ json: { type: a.type || null, card: d.card?.name || null, cardId: d.card?.id || null, list: d.list?.name || d.listAfter?.name || null, fromList: d.listBefore?.name || null, board: d.board?.name || null, text: d.text ?? null, member: a.memberCreator?.fullName || null, link: d.card?.shortLink ? `https://trello.com/c/${d.card.shortLink}` : null, date: a.date || null, data: d } }] };
  } },
  'trigger.clickup': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-signature'], hmac(String(p.secret), raw(req)))) return bad('The ClickUp signature doesn’t match the webhook secret.');
    const b = req.body || {}, last = (b.history_items || []).slice(-1)[0] || {};
    if (!wanted(p.events, b.event)) return ignored(b.event);
    return { items: [{ json: { event: b.event || null, taskId: b.task_id || null, field: last.field || null, before: last.before?.status ?? last.before ?? null, after: last.after?.status ?? last.after ?? null, user: last.user?.username || null, comment: last.comment?.text_content || null, data: b } }] };
  } },
  // Mailchimp: subscribes, unsubscribes, profile and email changes, cleaned addresses, campaigns sent.
  'trigger.mailchimp': { ...pass, hook(req, p) {
    if (req.method === 'GET') return { respond: { status: 200, type: 'text', body: 'ok' } }; // Mailchimp checks the URL
    if (p.secret && !same(req.query?.key, p.secret)) return bad('Add ?key=<the secret> to the URL in Mailchimp.');
    const b = req.body || {}, d = b.data || {};
    const pick = k => d[k] ?? b[`data[${k}]`];
    const type = b.type || null;
    if (!wanted(p.events, type)) return ignored(type);
    const merges = d.merges || Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith('data[merges][')).map(([k, v]) => [k.slice(13, -1), v]));
    return { items: [{ json: { type, email: pick('email') ?? pick('new_email') ?? null, oldEmail: pick('old_email') ?? null, listId: pick('list_id') ?? null, reason: pick('reason') ?? null, firstName: merges.FNAME || null, lastName: merges.LNAME || null, firedAt: b.fired_at || null, merges } }] };
  } },
  'trigger.bitbucket': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-hub-signature'], `sha256=${hmac(String(p.secret), raw(req))}`)) return bad('The Bitbucket signature doesn’t match the secret.');
    const event = req.headers['x-event-key'] || null, b = req.body || {};
    if (event === 'diagnostics:ping') return ignored('ping');
    if (!wanted(p.events, event)) return ignored(event);
    const pr = b.pullrequest, change = b.push?.changes?.[0];
    return { items: [{ json: { event, repository: b.repository?.full_name || null, actor: b.actor?.display_name || null, title: pr?.title || b.issue?.title || null, branch: change?.new?.name || pr?.source?.branch?.name || null, commits: (change?.commits || []).map(c => ({ hash: c.hash, message: c.message })), url: pr?.links?.html?.href || b.repository?.links?.html?.href || null, payload: b } }] };
  } },
  'trigger.vercel': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-vercel-signature'], hmac(String(p.secret), raw(req), 'hex', 'sha1'))) return bad('The Vercel signature doesn’t match the secret.');
    const b = req.body || {}, x = b.payload || {};
    if (!wanted(p.events, b.type)) return ignored(b.type);
    return { items: [{ json: { type: b.type || null, project: x.project?.name || x.name || null, url: x.deployment?.url ? `https://${x.deployment.url}` : x.url || null, target: x.target || x.deployment?.target || null, state: String(b.type || '').split('.').pop(), inspector: x.links?.deployment || null, user: x.user?.username || null, createdAt: iso(b.createdAt), payload: x } }] };
  } },
  // Netlify: deploy notifications (Site → Notifications → Deploy notifications → HTTP POST request),
  // signed with a JWT whose sha256 is the body's.
  'trigger.netlify': { ...pass, hook(req, p) {
    if (p.secret) {
      const [h, pl, sig] = String(req.headers['x-webhook-signature'] || '').split('.');
      let claims = {};
      try { claims = JSON.parse(Buffer.from(pl || '', 'base64url').toString()); } catch (e) { claims = {}; }
      if (!h || !sig || !same(sig, hmac(String(p.secret), `${h}.${pl}`, 'base64url')) || claims.sha256 !== createHash('sha256').update(req.raw || raw(req)).digest('hex')) return bad('The Netlify signature doesn’t match the JWS secret token.');
    }
    const b = req.body || {};
    const state = b.state || null;
    if (!wanted(p.events, state)) return ignored(state);
    return { items: [{ json: { state, site: b.name || null, url: b.ssl_url || b.url || null, deployUrl: b.deploy_ssl_url || null, branch: b.branch || null, commit: b.commit_ref || null, title: b.title || null, error: b.error_message || null, context: b.context || null, adminUrl: b.admin_url || null } }] };
  } },
  'trigger.tally': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['tally-signature'], hmac(String(p.secret), raw(req), 'base64'))) return bad('The Tally signature doesn’t match the signing secret.');
    const b = req.body || {}, d = b.data || {};
    const answers = Object.fromEntries((d.fields || []).map(f => [f.label || f.key, Array.isArray(f.value) && f.options ? f.value.map(v => f.options.find(o => o.id === v)?.text ?? v) : f.value]));
    return { items: [{ json: { formName: d.formName || null, formId: d.formId || null, responseId: d.responseId || null, submittedAt: d.createdAt || b.createdAt || null, answers } }] };
  } },
  'trigger.calcom': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-cal-signature-256'], hmac(String(p.secret), raw(req)))) return bad('The Cal.com signature doesn’t match the secret.');
    const b = req.body || {}, x = b.payload || {};
    if (b.triggerEvent === 'PING') return ignored('ping');
    if (!wanted(p.events, b.triggerEvent)) return ignored(b.triggerEvent);
    const who = x.attendees?.[0] || {};
    return { items: [{ json: { event: b.triggerEvent || null, title: x.title || null, start: x.startTime || null, end: x.endTime || null, name: who.name || null, email: who.email || null, timeZone: who.timeZone || null, location: x.location || x.metadata?.videoCallUrl || null, bookingId: x.bookingId ?? x.uid ?? null, answers: x.responses || null, payload: x } }] };
  } },
  // ntfy: notifications posted to a topic (by your server, scripts, phone…), looked for every few minutes.
  'trigger.ntfy': { ...pass, async poll({ params: p, node, state, ctx }) {
    const c = node.credential ? await ctx.cred(node.credential) : {};
    const server = String(c.server || 'https://ntfy.sh').replace(/\/+$/, ''), topic = String(need(p.topic, 'the topic')).trim();
    if (!/^[\w-]{1,64}$/.test(topic)) throw new FlowError('A topic is letters, numbers, - and _ only.', 'bad_param');
    const r = await request(`${server}/${topic}/json?poll=1&since=${state.since || 'latest'}`, { headers: c.token ? { authorization: `Bearer ${c.token}` } : {} }, { allowPrivate: ctx.allowPrivate });
    if (!r.ok) failIfBad(r, 'ntfy');
    const list = String(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)).split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(m => m && m.event === 'message');
    if (!state.since) return { items: [], state: { since: list.length ? list[list.length - 1].id : String(Math.floor(Date.now() / 1000)) } };
    const items = list.map(m => ({ id: m.id, title: m.title || null, message: m.message || '', tags: m.tags || [], priority: m.priority || 3, click: m.click || null, time: iso(m.time) }));
    return { items, state: { since: list.length ? list[list.length - 1].id : state.since } };
  } },
};
