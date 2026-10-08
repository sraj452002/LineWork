import { test, expect } from '@playwright/test';

// Google sign-in and Drive storage, against a stand-in for the /api/google endpoints and the
// Drive API (the real ones need a deployed site and a Google account).
function fakeGoogle() {
  const drive = new Map(); // drive id -> {name, mimeType, appProperties, parents, trashed, content}
  let n = 0, signedIn = false;
  const calls = { signout: 0 };
  const user = { id: 'g-123', email: 'ada@example.com', name: 'Ada Lovelace', picture: '' };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const matches = (f, q) => {
    if (f.trashed) return false;
    const tags = [...q.matchAll(/key='(\w+)' and value='([^']*)'/g)];
    return tags.every(([, k, v]) => (f.appProperties || {})[k] === v);
  };
  const parseMultipart = (body, type) => {
    const b = type.match(/boundary=(\S+)/)[1];
    const parts = body.split('--' + b).slice(1, 3).map(p => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
    return { meta: JSON.parse(parts[0]), content: parts[1] };
  };
  async function install(page) {
    await page.route('**/api/google/**', async route => {
      const req = route.request(), action = new URL(req.url()).pathname.split('/').pop();
      if (action === 'config') return json(route, { enabled: true });
      if (action === 'start') { signedIn = true; return route.fulfill({ status: 302, headers: { location: '/?google=signed_in' } }); }
      expect(req.headers()['x-requested-with']).toBe('XmlHttpRequest');
      if (action === 'token') return signedIn ? json(route, { accessToken: 'tok', expiresIn: 3600, user }) : json(route, { error: 'signed_out' }, 401);
      if (action === 'signout') { signedIn = false; calls.signout++; return json(route, { ok: true }); }
      return json(route, { error: 'not_found' }, 404);
    });
    await page.route('https://www.googleapis.com/**', async route => {
      const req = route.request(), url = new URL(req.url()), m = req.method();
      expect(req.headers().authorization).toBe('Bearer tok');
      const id = url.pathname.match(/\/files\/([^/]+)$/)?.[1];
      if (url.pathname.startsWith('/upload/')) {
        const { meta, content } = parseMultipart(req.postData(), req.headers()['content-type']);
        if (m === 'POST') { const nid = 'd' + ++n; drive.set(nid, { ...meta, content }); return json(route, { id: nid }); }
        const f = drive.get(id);
        if (!f) return json(route, { error: {} }, 404);
        Object.assign(f, meta, { content });
        return json(route, { id });
      }
      if (m === 'GET' && !id) {
        const q = url.searchParams.get('q');
        return json(route, { files: [...drive].filter(([, f]) => matches(f, q)).map(([fid, f]) => ({ id: fid, appProperties: f.appProperties })) });
      }
      if (m === 'GET') { const f = drive.get(id); return f ? route.fulfill({ status: 200, contentType: 'application/json', body: f.content || '{}' }) : json(route, { error: {} }, 404); }
      if (m === 'POST') { const nid = 'd' + ++n; drive.set(nid, JSON.parse(req.postData())); return json(route, { id: nid }); }
      if (m === 'PATCH') { Object.assign(drive.get(id), JSON.parse(req.postData())); return json(route, { id }); }
      return json(route, {}, 400);
    });
  }
  const files = () => [...drive.values()].filter(f => f.appProperties?.linework === 'file');
  return { install, files, drive, calls };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    sessionStorage.setItem('seeded', '1');
  });
});

test('sign in with Google, save files to Drive, load them back, delete and sign out', async ({ page }) => {
  const g = fakeGoogle();
  await g.install(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  await expect(page.getByText('Saved to Google Drive')).toBeVisible();
  await expect(page).toHaveURL(/\/$/); // ?google=signed_in is tidied away

  // A new file is uploaded to a Linework folder in Drive.
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await page.getByRole('textbox', { name: 'File name' }).fill('Payments design');
  await expect.poll(() => g.files().map(f => f.name)).toEqual(['Payments design.linework.json']);
  const folder = [...g.drive.values()].find(f => f.appProperties?.linework === 'root');
  expect(folder.mimeType).toBe('application/vnd.google-apps.folder');
  expect(g.files()[0].parents).toEqual([[...g.drive].find(([, f]) => f === folder)[0]]);
  expect(JSON.parse(g.files()[0].content).title).toBe('Payments design');

  // After clearing this browser's copy, the file comes back from Drive.
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.evaluate(() => { Object.keys(localStorage).filter(k => k.startsWith('linework:cloud:')).forEach(k => localStorage.removeItem(k)); });
  await page.reload();
  await expect(page.locator('.ftable tbody tr')).toHaveCount(1);
  await expect(page.locator('.ftable tbody tr').first()).toContainText('Payments design');

  // Deleting moves it to the Drive trash.
  const row = page.locator('.ftable tbody tr').first();
  await row.hover();
  await row.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => g.files().filter(f => f.trashed).length).toBe(1);

  // Signing out ends the Google session and returns to the sign-in screen.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(g.calls.signout).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('a cancelled Google sign-in says so', async ({ page }) => {
  const g = fakeGoogle();
  await g.install(page);
  await page.goto('/?google=cancelled');
  await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled.');
  await expect(page).toHaveURL(/\/$/);
});
