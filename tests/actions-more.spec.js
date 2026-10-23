import { test, expect } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { ACTION_NODES } from '../backend/flow-actions.js';

// The newer app nodes (Razorpay, WooCommerce, Google Drive, YouTube, Reddit, Discord's command reply),
// each against a stand-in for its service: what they send, and what they give back.
test('Razorpay, WooCommerce, Google Drive, YouTube, Reddit and the Discord reply call their services right', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const google = JSON.stringify({ client_email: 'bot@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const creds = { rz: { keyId: 'rzp_test_1', keySecret: 'sec' }, wc: { url: 'shop.example.com', consumerKey: 'ck_1', consumerSecret: 'cs_1' }, g: { serviceAccountJson: google }, yt: { apiKey: 'AIzaKEY' } };
  const calls = [];
  const real = globalThis.fetch;
  // No real names are looked up (this may run offline): every host is a public address.
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const dnsp = createRequire(import.meta.url)('node:dns/promises'), realLookup = dnsp.lookup;
  dnsp.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  syncBuiltinESMExports();
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u), body = init.body ? String(init.body) : '';
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.authorization, type: init.headers?.['content-type'], body });
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('api.razorpay.com/v1/payment_links')) return json({ id: 'plink_1', short_url: 'https://rzp.io/i/abc', amount: JSON.parse(body).amount, status: 'created' });
    if (url.includes('api.razorpay.com/v1/payments/pay_1/refund')) return json({ id: 'rfnd_1', payment_id: 'pay_1', amount: 10000, status: 'processed' });
    if (url.includes('/wp-json/wc/v3/orders/1001/notes')) return json({ id: 9 });
    if (url.includes('/wp-json/wc/v3/orders/1001')) return json({ id: 1001, number: '1001', status: JSON.parse(body || '{}').status || 'processing', total: '499.00', currency: 'INR', billing: { first_name: 'Ravi', last_name: 'K', email: 'r@k.in' }, line_items: [{ name: 'Shirt', quantity: 1, total: '499.00' }] });
    if (url.includes('oauth2.googleapis.com')) return json({ access_token: 'gtok', expires_in: 3600 });
    if (url.includes('/upload/drive/v3/files')) return json({ id: 'd9', name: 'report.csv', mimeType: 'text/csv', size: '12', webViewLink: 'https://drive.google.com/file/d/d9' });
    if (url.includes('/drive/v3/files/doc1/export')) return new Response('Hello from a Google Doc', { headers: { 'content-type': 'text/plain' } });
    if (url.includes('/drive/v3/files/doc1')) return json({ id: 'doc1', name: 'Notes', mimeType: 'application/vnd.google-apps.document' });
    if (url.includes('/drive/v3/files?')) return json({ files: [{ id: 'f1', name: 'a.pdf', mimeType: 'application/pdf', size: '100' }] });
    if (url.includes('youtube/v3/videos')) return json({ items: [{ id: 'dQw4w9WgXcQ', snippet: { title: 'A song', channelTitle: 'Rick' }, statistics: { viewCount: '1000', likeCount: '50', commentCount: '7' }, contentDetails: { duration: 'PT3M33S' } }] });
    if (url.includes('reddit.com/r/india/top.json')) return json({ data: { children: [{ data: { id: 'x1', title: 'Hello', author: 'u', subreddit: 'india', selftext: '', url: 'u', permalink: '/r/india/x1', score: 9, num_comments: 2, created_utc: 1760000000 } }] } });
    if (url.includes('discord.com/api/v10/webhooks/app1/tok1')) return json({ id: 'm1', channel_id: 'c1' });
    return json({ error: 'not stubbed' }, 404);
  };
  const run = async (type, params, credential, input = [{}]) => (await ACTION_NODES[type].run({ node: { params, credential }, items: input.map(json => ({ json })), params: () => params, ctx: { allowPrivate: false, cred: async id => creds[id] } })).main.map(i => i.json);
  const last = () => calls[calls.length - 1];
  try {
    // Razorpay: basic auth with the key; rupees in, paise sent.
    expect(await run('razorpay.paymentLink', { amount: '499', description: 'Order 1', email: 'a@b.in', notify: 'both' }, 'rz')).toEqual([{ id: 'plink_1', url: 'https://rzp.io/i/abc', amount: 499, status: 'created' }]);
    expect(last().auth).toBe(`Basic ${Buffer.from('rzp_test_1:sec').toString('base64')}`);
    expect(JSON.parse(last().body)).toMatchObject({ amount: 49900, currency: 'INR', notify: { sms: true, email: true } });
    expect(await run('razorpay.refund', { paymentId: 'pay_1', amount: '100' }, 'rz')).toEqual([{ id: 'rfnd_1', paymentId: 'pay_1', amount: 100, status: 'processed' }]);
    await expect(run('razorpay.paymentLink', { amount: '-5' }, 'rz')).rejects.toThrow(/above 0/);

    // WooCommerce: https added to the store address; the status changed, then the note added.
    const [o] = await run('woocommerce.updateOrder', { orderId: '1001', status: 'completed', note: 'Shipped!', toCustomer: 'true' }, 'wc');
    expect(o).toMatchObject({ id: 1001, status: 'completed', name: 'Ravi K', email: 'r@k.in', noted: true });
    expect(calls.slice(-2).map(c => `${c.method} ${c.url}`)).toEqual(['PUT https://shop.example.com/wp-json/wc/v3/orders/1001', 'POST https://shop.example.com/wp-json/wc/v3/orders/1001/notes']);
    expect(JSON.parse(last().body)).toEqual({ note: 'Shipped!', customer_note: true });

    // Google Drive: a folder link works as its id; a CSV saved as a Sheet; a Doc read as text.
    expect(await run('gdrive.list', { folderId: 'https://drive.google.com/drive/folders/1AbCdEf?usp=sharing' }, 'g')).toMatchObject([{ id: 'f1', name: 'a.pdf', size: 100 }]);
    expect(decodeURIComponent(last().url)).toContain("'1AbCdEf' in parents");
    expect(last().auth).toBe('Bearer gtok');
    expect(await run('gdrive.upload', { folderId: '1AbCdEf', name: 'report.csv', content: 'a,b\n1,2', as: 'sheet' }, 'g')).toMatchObject([{ id: 'd9', name: 'report.csv' }]);
    expect(last().type).toMatch(/^multipart\/related; boundary=/);
    expect(last().body).toContain('"mimeType":"application/vnd.google-apps.spreadsheet"');
    expect(last().body).toContain('"name":"report"');
    expect(last().body).toContain('a,b\n1,2');
    expect(await run('gdrive.read', { fileId: 'https://docs.google.com/document/d/doc1/edit' }, 'g')).toMatchObject([{ id: 'doc1', name: 'Notes', text: 'Hello from a Google Doc' }]);
    expect(last().url).toContain('/export?mimeType=text%2Fplain');

    // YouTube: any kind of link gives the id; numbers come back as numbers.
    expect(await run('youtube.video', { video: 'https://youtu.be/dQw4w9WgXcQ?t=5' }, 'yt')).toMatchObject([{ id: 'dQw4w9WgXcQ', title: 'A song', views: 1000, likes: 50, comments: 7, duration: 'PT3M33S', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]);
    expect(last().url).toContain('id=dQw4w9WgXcQ');
    expect(last().url).toContain('key=AIzaKEY');

    // Reddit (no credential) and Discord's reply (no credential).
    expect(await run('reddit.posts', { subreddit: 'r/india', sort: 'topweek', limit: 5 })).toMatchObject([{ id: 'x1', permalink: 'https://www.reddit.com/r/india/x1', comments: 2 }]);
    expect(last().url).toContain('/r/india/top.json?t=week&limit=5');
    expect(await run('discordbot.reply', { applicationId: 'app1', token: 'tok1', content: 'The answer is 42', private: 'true' })).toEqual([{ id: 'm1', channelId: 'c1', sent: true }]);
    expect(JSON.parse(last().body)).toEqual({ content: 'The answer is 42', flags: 64 });
  } finally { globalThis.fetch = real; dnsp.lookup = realLookup; syncBuiltinESMExports(); }
});
