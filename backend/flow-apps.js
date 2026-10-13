import { createSign } from 'node:crypto';
import { FlowError } from './flow-engine.js';
import { api, cred, each, failIfBad, need, obj, request } from './flow-util.js';

/* Workflow nodes for other apps, each reached with a credential (an API key or token; Google with a
   service account the sheet or calendar is shared with). Every node has an `operation`; params are
   filled in per item. Results are the service's own JSON (lists become one item each). */

const ok = (r, service) => failIfBad(r, service);
const q = s => encodeURIComponent(String(s));
const op = (p, d) => p.operation || d;
const strip = s => String(s || '').replace(/\/+$/, '');

// Google: a service account's key → an access token for some scopes (an hour, cached).
const googleTokens = new Map();
export async function googleToken(args, c, scope) {
  let key;
  try { key = typeof c.serviceAccountJson === 'string' ? JSON.parse(c.serviceAccountJson) : c.serviceAccountJson; } catch (e) { throw new FlowError('The service account key is not valid JSON.', 'credential'); }
  if (!key || !key.client_email || !key.private_key) throw new FlowError('Paste the whole service account key (the JSON file).', 'credential');
  const k = `${key.client_email}|${scope}`, hit = googleTokens.get(k);
  if (hit && hit.until > Date.now()) return hit.token;
  const now = Math.floor(Date.now() / 1000), enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: key.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const r = await api(args, 'https://oauth2.googleapis.com/token', { method: 'POST', form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` } });
  const body = ok(r, 'Google');
  googleTokens.set(k, { token: body.access_token, until: Date.now() + 50 * 60_000 });
  return body.access_token;
}
// Rows (the first is the header) → objects.
const rowsToItems = values => {
  const [head = [], ...rows] = values || [];
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h || `column${i + 1}`, r[i] ?? ''])));
};
const valuesOf = v => { const x = typeof v === 'string' ? (v.trim().startsWith('[') ? JSON.parse(v) : v.split(',').map(s => s.trim())) : v; return Array.isArray(x) ? x : [x]; };

export const APP_NODES = {
  'google.sheets': { run: async args => {
    const c = await cred(args), token = await googleToken(args, c, 'https://www.googleapis.com/auth/spreadsheets');
    return each(args, async p => {
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${q(need(p.spreadsheetId, 'the spreadsheet id'))}/values/${q(p.range || 'Sheet1')}`;
      if (op(p, 'read') === 'append') {
        const body = ok(await api(args, `${base}:append?valueInputOption=USER_ENTERED`, { method: 'POST', bearer: token, body: { values: [valuesOf(need(p.values, 'the values'))] } }), 'Google Sheets');
        return { updatedRange: body.updates?.updatedRange, updatedRows: body.updates?.updatedRows };
      }
      return rowsToItems(ok(await api(args, base, { bearer: token }), 'Google Sheets').values);
    });
  } },
  'google.calendar': { run: async args => {
    const c = await cred(args), token = await googleToken(args, c, 'https://www.googleapis.com/auth/calendar');
    return each(args, async p => {
      const base = `https://www.googleapis.com/calendar/v3/calendars/${q(need(p.calendarId, 'the calendar id'))}/events`;
      if (op(p, 'list') === 'create') {
        const body = ok(await api(args, base, { method: 'POST', bearer: token, body: { summary: need(p.summary, 'the title'), description: p.description || undefined, start: { dateTime: new Date(need(p.start, 'the start')).toISOString() }, end: { dateTime: new Date(need(p.end, 'the end')).toISOString() } } }), 'Google Calendar');
        return { id: body.id, link: body.htmlLink };
      }
      return ok(await api(args, `${base}?singleEvents=true&orderBy=startTime&maxResults=${Math.min(250, Number(p.limit) || 20)}&timeMin=${q(new Date().toISOString())}`, { bearer: token }), 'Google Calendar').items || [];
    });
  } },
  airtable: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const base = `https://api.airtable.com/v0/${q(need(p.baseId, 'the base id'))}/${q(need(p.table, 'the table'))}`;
      const o = op(p, 'list');
      if (o === 'create') return (b => ({ id: b.id, ...b.fields }))(ok(await api(args, base, { method: 'POST', bearer: c.token, body: { fields: obj(p.fields, 'Fields') } }), 'Airtable'));
      if (o === 'update') return (b => ({ id: b.id, ...b.fields }))(ok(await api(args, `${base}/${q(need(p.recordId, 'the record id'))}`, { method: 'PATCH', bearer: c.token, body: { fields: obj(p.fields, 'Fields') } }), 'Airtable'));
      const qs = new URLSearchParams({ maxRecords: String(Math.min(1000, Number(p.limit) || 100)), ...(p.formula ? { filterByFormula: p.formula } : {}) });
      return (ok(await api(args, `${base}?${qs}`, { bearer: c.token }), 'Airtable').records || []).map(r => ({ id: r.id, ...r.fields }));
    });
  } },
  trello: { run: async args => {
    const c = await cred(args), auth = `key=${q(c.apiKey)}&token=${q(c.token)}`;
    return each(args, async p => {
      if (op(p, 'createCard') === 'listCards') return ok(await api(args, `https://api.trello.com/1/lists/${q(need(p.listId, 'the list id'))}/cards?${auth}`), 'Trello');
      const b = ok(await api(args, `https://api.trello.com/1/cards?${auth}&idList=${q(need(p.listId, 'the list id'))}&name=${q(need(p.name, 'the card name'))}&desc=${q(p.desc || '')}`, { method: 'POST' }), 'Trello');
      return { id: b.id, url: b.url, name: b.name };
    });
  } },
  jira: { run: async args => {
    const c = await cred(args), base = `https://${strip(c.site).replace(/^https?:\/\//, '')}/rest/api/2`, basic = `${c.email}:${c.apiToken}`;
    return each(args, async p => {
      const o = op(p, 'createIssue');
      if (o === 'getIssue') return ok(await api(args, `${base}/issue/${q(need(p.issueKey, 'the issue key'))}`, { basic }), 'Jira');
      if (o === 'search') return (ok(await api(args, `${base}/search?maxResults=50&jql=${q(need(p.jql, 'the JQL'))}`, { basic }), 'Jira').issues || []).map(i => ({ key: i.key, summary: i.fields?.summary, status: i.fields?.status?.name, assignee: i.fields?.assignee?.displayName || null }));
      const b = ok(await api(args, `${base}/issue`, { method: 'POST', basic, body: { fields: { project: { key: need(p.projectKey, 'the project key') }, summary: need(p.summary, 'the summary'), description: p.description || '', issuetype: { name: p.issueType || 'Task' } } } }), 'Jira');
      return { id: b.id, key: b.key, url: `https://${strip(c.site).replace(/^https?:\/\//, '')}/browse/${b.key}` };
    });
  } },
  linear: { run: async args => {
    const c = await cred(args);
    const gql = async (query, variables) => { const b = ok(await api(args, 'https://api.linear.app/graphql', { method: 'POST', headers: { authorization: c.apiKey }, body: { query, variables } }), 'Linear'); if (b.errors) throw new FlowError(`Linear: ${b.errors[0].message}`, 'service'); return b.data; };
    return each(args, async p => {
      if (op(p, 'createIssue') === 'listIssues') return (await gql('query { issues(first: 50) { nodes { id identifier title url state { name } } } }')).issues.nodes.map(i => ({ ...i, state: i.state?.name }));
      const d = await gql('mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }', { input: { teamId: need(p.teamId, 'the team id'), title: need(p.title, 'the title'), description: p.description || undefined } });
      return d.issueCreate.issue;
    });
  } },
  asana: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      if (op(p, 'createTask') === 'listTasks') return ok(await api(args, `https://app.asana.com/api/1.0/projects/${q(need(p.projectId, 'the project id'))}/tasks?opt_fields=name,completed,due_on,permalink_url`, { bearer: c.token }), 'Asana').data;
      return ok(await api(args, 'https://app.asana.com/api/1.0/tasks', { method: 'POST', bearer: c.token, body: { data: { name: need(p.name, 'the task name'), notes: p.notes || '', projects: [need(p.projectId, 'the project id')], ...(p.dueOn ? { due_on: p.dueOn } : {}) } } }), 'Asana').data;
    });
  } },
  clickup: { run: async args => {
    const c = await cred(args), headers = { authorization: c.token };
    return each(args, async p => {
      const base = `https://api.clickup.com/api/v2/list/${q(need(p.listId, 'the list id'))}/task`;
      if (op(p, 'createTask') === 'listTasks') return ok(await api(args, base, { headers }), 'ClickUp').tasks || [];
      const b = ok(await api(args, base, { method: 'POST', headers, body: { name: need(p.name, 'the task name'), description: p.description || '' } }), 'ClickUp');
      return { id: b.id, url: b.url, name: b.name };
    });
  } },
  todoist: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      if (op(p, 'createTask') === 'listTasks') return ok(await api(args, `https://api.todoist.com/rest/v2/tasks${p.filter ? `?filter=${q(p.filter)}` : ''}`, { bearer: c.token }), 'Todoist');
      return ok(await api(args, 'https://api.todoist.com/rest/v2/tasks', { method: 'POST', bearer: c.token, body: { content: need(p.content, 'the task'), ...(p.due ? { due_string: p.due } : {}), ...(p.description ? { description: p.description } : {}) } }), 'Todoist');
    });
  } },
  hubspot: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      if (op(p, 'createContact') === 'listContacts') return (ok(await api(args, 'https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=email,firstname,lastname,company', { bearer: c.token }), 'HubSpot').results || []).map(r => ({ id: r.id, ...r.properties }));
      const b = ok(await api(args, 'https://api.hubapi.com/crm/v3/objects/contacts', { method: 'POST', bearer: c.token, body: { properties: { email: need(p.email, 'the email'), firstname: p.firstName || undefined, lastname: p.lastName || undefined, company: p.company || undefined } } }), 'HubSpot');
      return { id: b.id, ...b.properties };
    });
  } },
  pipedrive: { run: async args => {
    const c = await cred(args), base = `https://${c.domain ? strip(c.domain).replace(/^https?:\/\//, '') : 'api.pipedrive.com'}/v1`, tok = `api_token=${q(c.apiToken)}`;
    return each(args, async p => {
      const o = op(p, 'createPerson');
      if (o === 'listDeals') return ok(await api(args, `${base}/deals?${tok}&limit=100`), 'Pipedrive').data || [];
      if (o === 'createDeal') return ok(await api(args, `${base}/deals?${tok}`, { method: 'POST', body: { title: need(p.title, 'the deal title'), ...(p.value ? { value: Number(p.value) } : {}) } }), 'Pipedrive').data;
      return ok(await api(args, `${base}/persons?${tok}`, { method: 'POST', body: { name: need(p.name, 'the name'), ...(p.email ? { email: [p.email] } : {}) } }), 'Pipedrive').data;
    });
  } },
  stripe: { run: async args => {
    const c = await cred(args), basic = `${c.secretKey}:`;
    return each(args, async p => {
      const o = op(p, 'listCustomers'), limit = Math.min(100, Number(p.limit) || 20);
      if (o === 'createCustomer') return ok(await api(args, 'https://api.stripe.com/v1/customers', { method: 'POST', basic, form: { email: need(p.email, 'the email'), ...(p.name ? { name: p.name } : {}) } }), 'Stripe');
      if (o === 'listPayments') return ok(await api(args, `https://api.stripe.com/v1/payment_intents?limit=${limit}`, { basic }), 'Stripe').data;
      if (o === 'balance') return ok(await api(args, 'https://api.stripe.com/v1/balance', { basic }), 'Stripe');
      return ok(await api(args, `https://api.stripe.com/v1/customers?limit=${limit}${p.email ? `&email=${q(p.email)}` : ''}`, { basic }), 'Stripe').data;
    });
  } },
  shopify: { run: async args => {
    const c = await cred(args), base = `https://${strip(c.shop).replace(/^https?:\/\//, '').replace(/\.myshopify\.com$/, '')}.myshopify.com/admin/api/2024-10`, headers = { 'x-shopify-access-token': c.token };
    return each(args, async p => {
      const limit = Math.min(250, Number(p.limit) || 50);
      if (op(p, 'listOrders') === 'listProducts') return ok(await api(args, `${base}/products.json?limit=${limit}`, { headers }), 'Shopify').products;
      return ok(await api(args, `${base}/orders.json?status=${q(p.status || 'any')}&limit=${limit}`, { headers }), 'Shopify').orders;
    });
  } },
  twilio: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const b = ok(await api(args, `https://api.twilio.com/2010-04-01/Accounts/${q(c.accountSid)}/Messages.json`, { method: 'POST', basic: `${c.accountSid}:${c.authToken}`, form: { To: need(p.to, 'the number to send to'), From: p.from || need(c.from, 'the sending number'), Body: need(p.body, 'the message') } }), 'Twilio');
      return { sid: b.sid, status: b.status, to: b.to };
    });
  } },
  sendgrid: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      ok(await api(args, 'https://api.sendgrid.com/v3/mail/send', { method: 'POST', bearer: c.apiKey, body: { personalizations: [{ to: [{ email: need(p.to, 'who it goes to') }] }], from: { email: p.from || need(c.from, 'the sender') }, subject: p.subject || '', content: [{ type: p.html ? 'text/html' : 'text/plain', value: String(p.html || p.text || ' ') }] } }), 'SendGrid');
      return { sent: true, to: p.to };
    });
  } },
  resend: { run: async args => {
    const c = await cred(args);
    return each(args, async p => ok(await api(args, 'https://api.resend.com/emails', { method: 'POST', bearer: c.apiKey, body: { from: p.from || need(c.from, 'the sender'), to: [need(p.to, 'who it goes to')], subject: p.subject || '', ...(p.html ? { html: p.html } : { text: p.text || '' }) } }), 'Resend'));
  } },
  mailchimp: { run: async args => {
    const c = await cred(args), dc = String(c.apiKey || '').split('-')[1];
    if (!dc) throw new FlowError('A Mailchimp API key ends in -us1 (or similar): paste the whole key.', 'credential');
    return each(args, async p => {
      const b = ok(await api(args, `https://${dc}.api.mailchimp.com/3.0/lists/${q(need(p.listId, 'the audience id'))}/members`, { method: 'POST', basic: `any:${c.apiKey}`, body: { email_address: need(p.email, 'the email'), status: p.status || 'subscribed', ...(p.firstName ? { merge_fields: { FNAME: p.firstName } } : {}) } }), 'Mailchimp');
      return { id: b.id, email: b.email_address, status: b.status };
    });
  } },
  openai: { run: async args => {
    const c = await cred(args), base = strip(c.baseUrl || 'https://api.openai.com/v1');
    return each(args, async p => {
      const b = ok(await api(args, `${base}/chat/completions`, { method: 'POST', bearer: c.apiKey, timeout: 90_000, body: { model: p.model || 'gpt-4o-mini', messages: [...(p.system ? [{ role: 'system', content: String(p.system) }] : []), { role: 'user', content: String(need(p.prompt, 'the prompt')) }] } }), 'OpenAI');
      return { text: b.choices?.[0]?.message?.content || '', model: b.model, usage: b.usage };
    });
  } },
  gemini: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const b = ok(await api(args, `https://generativelanguage.googleapis.com/v1beta/models/${q(p.model || 'gemini-2.0-flash')}:generateContent?key=${q(c.apiKey)}`, { method: 'POST', timeout: 90_000, body: { contents: [{ parts: [{ text: String(need(p.prompt, 'the prompt')) }] }], ...(p.system ? { systemInstruction: { parts: [{ text: String(p.system) }] } } : {}) } }), 'Gemini');
      return { text: (b.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('') };
    });
  } },
  supabase: { run: async args => {
    const c = await cred(args), base = `${strip(c.url)}/rest/v1`, headers = { apikey: c.serviceKey, authorization: `Bearer ${c.serviceKey}`, prefer: 'return=representation' };
    return each(args, async p => {
      const table = q(need(p.table, 'the table')), filter = p.filter ? `?${p.filter}` : '';
      const o = op(p, 'select');
      if (o === 'insert') return ok(await api(args, `${base}/${table}`, { method: 'POST', headers, body: obj(p.row, 'The row') }), 'Supabase');
      if (o === 'update') return ok(await api(args, `${base}/${table}${need(filter, 'a filter (e.g. id=eq.1)')}`, { method: 'PATCH', headers, body: obj(p.row, 'The row') }), 'Supabase');
      if (o === 'delete') return ok(await api(args, `${base}/${table}${need(filter, 'a filter (e.g. id=eq.1)')}`, { method: 'DELETE', headers }), 'Supabase');
      return ok(await api(args, `${base}/${table}${filter || '?'}${filter ? '&' : ''}limit=${Math.min(1000, Number(p.limit) || 100)}`, { headers }), 'Supabase');
    });
  } },
  dropbox: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      if (op(p, 'list') === 'upload') {
        const r = await request('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'dropbox-api-arg': JSON.stringify({ path: need(p.path, 'the path'), mode: 'overwrite' }), 'content-type': 'application/octet-stream' }, body: String(p.content ?? '') }, { allowPrivate: args.ctx.allowPrivate });
        return ok(r, 'Dropbox');
      }
      return ok(await api(args, 'https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', bearer: c.token, body: { path: p.path === '/' ? '' : p.path || '' } }), 'Dropbox').entries;
    });
  } },
  // Chat apps with incoming webhooks: Microsoft Teams, Google Chat, Mattermost.
  'chat.webhook': { run: async args => {
    const c = await cred(args);
    return each(args, async p => { ok(await api(args, need(c.webhookUrl, 'the webhook URL'), { method: 'POST', body: { text: String(need(p.text, 'the message')) } }), 'The chat app'); return { sent: true }; });
  } },
  whatsapp: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const b = ok(await api(args, `https://graph.facebook.com/v20.0/${q(need(c.phoneNumberId, 'the phone number id'))}/messages`, { method: 'POST', bearer: c.token, body: { messaging_product: 'whatsapp', to: String(need(p.to, 'the number to send to')).replace(/[^\d]/g, ''), type: 'text', text: { body: need(p.text, 'the message') } } }), 'WhatsApp');
      return { id: b.messages?.[0]?.id, to: p.to };
    });
  } },
  zendesk: { run: async args => {
    const c = await cred(args), base = `https://${strip(c.subdomain).replace(/^https?:\/\//, '').replace(/\.zendesk\.com$/, '')}.zendesk.com/api/v2`, basic = `${c.email}/token:${c.apiToken}`;
    return each(args, async p => {
      if (op(p, 'createTicket') === 'listTickets') return ok(await api(args, `${base}/tickets.json?per_page=100`, { basic }), 'Zendesk').tickets;
      return ok(await api(args, `${base}/tickets.json`, { method: 'POST', basic, body: { ticket: { subject: need(p.subject, 'the subject'), comment: { body: need(p.body, 'the message') }, ...(p.requesterEmail ? { requester: { email: p.requesterEmail, name: p.requesterName || p.requesterEmail } } : {}) } } }), 'Zendesk').ticket;
    });
  } },
  gitlab: { run: async args => {
    const c = await cred(args), base = `${strip(c.baseUrl || 'https://gitlab.com')}/api/v4`, headers = { 'private-token': c.token };
    return each(args, async p => {
      const project = q(need(p.projectId, 'the project (id or group/name)'));
      if (op(p, 'createIssue') === 'listIssues') return ok(await api(args, `${base}/projects/${project}/issues?state=${q(p.state || 'opened')}&per_page=50`, { headers }), 'GitLab');
      const b = ok(await api(args, `${base}/projects/${project}/issues`, { method: 'POST', headers, body: { title: need(p.title, 'the title'), description: p.description || '' } }), 'GitLab');
      return { iid: b.iid, url: b.web_url, title: b.title };
    });
  } },
  wordpress: { run: async args => {
    const c = await cred(args), base = `${strip(c.url)}/wp-json/wp/v2`, basic = `${c.username}:${c.appPassword}`;
    return each(args, async p => {
      if (op(p, 'createPost') === 'listPosts') return (ok(await api(args, `${base}/posts?per_page=${Math.min(100, Number(p.limit) || 10)}`, { basic }), 'WordPress')).map(x => ({ id: x.id, title: x.title?.rendered, link: x.link, date: x.date, status: x.status }));
      const b = ok(await api(args, `${base}/posts`, { method: 'POST', basic, body: { title: need(p.title, 'the title'), content: p.content || '', status: p.status || 'draft' } }), 'WordPress');
      return { id: b.id, link: b.link, status: b.status };
    });
  } },
  ntfy: { run: async args => {
    const c = args.node.credential ? await cred(args) : {};
    return each(args, async p => {
      const server = strip(c.server || 'https://ntfy.sh');
      ok(await api(args, server, { method: 'POST', ...(c.token ? { bearer: c.token } : {}), body: { topic: need(p.topic, 'the topic'), message: String(need(p.message, 'the message')), ...(p.title ? { title: p.title } : {}), ...(p.priority ? { priority: Number(p.priority) } : {}), ...(p.click ? { click: p.click } : {}) } }), 'ntfy');
      return { sent: true, topic: p.topic };
    });
  } },

  /* ---- more email, alerts and handy services ---- */
  mailgun: { run: async args => {
    const c = await cred(args), host = c.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
    return each(args, async p => {
      const b = ok(await api(args, `https://${host}/v3/${q(need(c.domain, 'the Mailgun domain'))}/messages`, { method: 'POST', basic: `api:${c.apiKey}`, form: { from: p.from || need(c.from, 'the sender'), to: need(p.to, 'who it goes to'), subject: p.subject || '', ...(p.html ? { html: p.html } : { text: p.text || '' }) } }), 'Mailgun');
      return { id: b.id, message: b.message };
    });
  } },
  postmark: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const b = ok(await api(args, 'https://api.postmarkapp.com/email', { method: 'POST', headers: { 'x-postmark-server-token': c.serverToken }, body: { From: p.from || need(c.from, 'the sender'), To: need(p.to, 'who it goes to'), Subject: p.subject || '', ...(p.html ? { HtmlBody: p.html } : { TextBody: p.text || '' }) } }), 'Postmark');
      return { id: b.MessageID, to: b.To, submittedAt: b.SubmittedAt };
    });
  } },
  brevo: { run: async args => {
    const c = await cred(args);
    const person = v => { const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(v)); return m ? { name: m[1] || undefined, email: m[2] } : { email: String(v).trim() }; };
    return each(args, async p => {
      const b = ok(await api(args, 'https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': c.apiKey }, body: { sender: person(p.from || need(c.from, 'the sender')), to: String(need(p.to, 'who it goes to')).split(',').map(person), subject: p.subject || '(no subject)', ...(p.html ? { htmlContent: p.html } : { textContent: p.text || ' ' }) } }), 'Brevo');
      return { id: b.messageId };
    });
  } },
  pushover: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const b = ok(await api(args, 'https://api.pushover.net/1/messages.json', { method: 'POST', form: { token: c.appToken, user: c.userKey, message: String(need(p.message, 'the message')), ...(p.title ? { title: p.title } : {}), ...(p.url ? { url: p.url } : {}), ...(p.priority ? { priority: String(p.priority) } : {}) } }), 'Pushover');
      return { sent: true, request: b.request };
    });
  } },
  pagerduty: { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const b = ok(await api(args, 'https://events.pagerduty.com/v2/enqueue', { method: 'POST', body: { routing_key: c.routingKey, event_action: p.action || 'trigger', ...(p.dedupKey ? { dedup_key: p.dedupKey } : {}), ...(p.action === 'resolve' || p.action === 'acknowledge' ? {} : { payload: { summary: String(need(p.summary, 'the summary')), source: p.source || 'Workline', severity: p.severity || 'error' } }) } }), 'PagerDuty');
      return { status: b.status, dedupKey: b.dedup_key };
    });
  } },
  deepl: { run: async args => {
    const c = await cred(args), host = String(c.apiKey || '').endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    return each(args, async (p, item) => {
      const b = ok(await api(args, `https://${host}/v2/translate`, { method: 'POST', headers: { authorization: `DeepL-Auth-Key ${c.apiKey}` }, body: { text: [String(need(p.text, 'the text'))], target_lang: String(p.target || 'EN-US').toUpperCase(), ...(p.source ? { source_lang: String(p.source).toUpperCase() } : {}) } }), 'DeepL');
      const t = b.translations?.[0] || {};
      return { ...item.json, [p.output || 'translation']: t.text, detectedLanguage: t.detected_source_language };
    });
  } },
  bitly: { run: async args => {
    const c = await cred(args);
    return each(args, async (p, item) => {
      const b = ok(await api(args, 'https://api-ssl.bitly.com/v4/shorten', { method: 'POST', bearer: c.token, body: { long_url: need(p.url, 'the link to shorten'), ...(p.domain ? { domain: p.domain } : {}) } }), 'Bitly');
      return { ...item.json, [p.output || 'shortUrl']: b.link };
    });
  } },
  'util.qrcode': { run: args => each(args, (p, item) => ({ ...item.json, [p.output || 'qrCode']: `https://api.qrserver.com/v1/create-qr-code/?size=${Math.min(1000, Math.max(100, Number(p.size) || 300))}x${Math.min(1000, Math.max(100, Number(p.size) || 300))}&data=${q(need(p.text, 'what the code holds'))}` })) },
  'data.currency': { run: args => each(args, async (p, item) => {
    const from = String(p.from || 'USD').toUpperCase(), to = String(p.to || 'INR').toUpperCase(), amount = Number(p.amount ?? 1) || 1;
    const b = ok(await api(args, `https://api.frankfurter.app/latest?from=${q(from)}&to=${q(to)}`), 'Frankfurter');
    const rate = b.rates?.[to];
    if (rate === undefined) throw new FlowError(`No rate from ${from} to ${to}.`, 'service');
    return { ...item.json, [p.output || 'converted']: Math.round(amount * rate * 100) / 100, rate, from, to, amount, date: b.date };
  }) },
};

// Microsoft Teams, Google Chat and Mattermost: each a chat app's incoming webhook.
for (const k of ['app.teams', 'app.googlechat', 'app.mattermost']) APP_NODES[k] = APP_NODES['chat.webhook'];
