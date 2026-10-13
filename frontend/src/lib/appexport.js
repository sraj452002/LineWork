import { appDoc } from './apphost.js';

/* Export a custom app (the App view → Export): as a web page, an Android project or a desktop (Electron)
   project. Each holds the app's page; it runs its workflows through the app's published link
   (WORKLINE_BASE), so the app has to be published. A browser can't build an .apk or .exe itself, so the
   projects come with a GitHub Actions workflow that builds them in the cloud, and a README. */

export const slugOf = (title, fallback = 'app') => String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
const pkgPart = s => (slugOf(s).replace(/-/g, '').replace(/^\d+/, '') || 'app').slice(0, 30);
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// The app's page, standalone: it calls its workflows at `base` (https://…/api/ui/<token>).
export const pageFor = (ui, { title, workflows, base }) => appDoc(ui.html, { workflows, title, base });

const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

export function exportHtml(ui, opts) {
  download(new Blob([pageFor(ui, opts)], { type: 'text/html' }), `${slugOf(opts.title)}.html`);
}

/* ---- Android: a plain Gradle project, a WebView showing the page (no other libraries) ---- */
export function androidFiles(ui, opts) {
  const name = opts.title || 'App', id = `app.workline.${pkgPart(opts.title)}`, path = id.replace(/\./g, '/');
  return {
    'settings.gradle': `pluginManagement {\n  repositories { google(); mavenCentral(); gradlePluginPortal() }\n}\ndependencyResolutionManagement {\n  repositories { google(); mavenCentral() }\n}\nrootProject.name = ${JSON.stringify(name)}\ninclude ':app'\n`,
    'build.gradle': `plugins {\n  id 'com.android.application' version '8.5.2' apply false\n}\n`,
    'gradle.properties': 'org.gradle.jvmargs=-Xmx2048m\nandroid.useAndroidX=false\n',
    'app/build.gradle': `plugins { id 'com.android.application' }

android {
  namespace '${id}'
  compileSdk 34
  defaultConfig {
    applicationId '${id}'
    minSdk 24
    targetSdk 34
    versionCode 1
    versionName '1.0'
  }
  buildTypes {
    release { minifyEnabled false }
  }
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
}
`,
    'app/src/main/AndroidManifest.xml': `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:label="@string/app_name" android:icon="@android:drawable/sym_def_app_icon" android:theme="@android:style/Theme.DeviceDefault.Light.NoActionBar" android:hardwareAccelerated="true">
    <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize|keyboardHidden">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`,
    'app/src/main/res/values/strings.xml': `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="app_name">${xml(name)}</string>\n</resources>\n`,
    [`app/src/main/java/${path}/MainActivity.java`]: `package ${id};

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// The app: its page (assets/index.html) in a full-screen WebView. It runs its workflows on Workline.
public class MainActivity extends Activity {
  private WebView web;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient() {
      // Links to other sites open in the browser.
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        Uri u = req.getUrl();
        if ("file".equals(u.getScheme())) return false;
        startActivity(new Intent(Intent.ACTION_VIEW, u));
        return true;
      }
    });
    setContentView(web);
    if (state != null) web.restoreState(state);
    else web.loadUrl("file:///android_asset/index.html");
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }

  @Override
  public void onBackPressed() {
    if (web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }
}
`,
    'app/src/main/assets/index.html': pageFor(ui, opts),
    '.github/workflows/build-android.yml': `# Builds the app on GitHub: push this folder to a repository, then open Actions → Build Android app →
# the latest run → Artifacts → ${slugOf(name)}-apk.
name: Build Android app
on:
  push:
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '8.7'
      - run: gradle assembleDebug --no-daemon
      - uses: actions/upload-artifact@v4
        with:
          name: ${slugOf(name)}-apk
          path: app/build/outputs/apk/debug/*.apk
`,
    '.gitignore': '.gradle/\nbuild/\napp/build/\nlocal.properties\n*.iml\n.idea/\n',
    'README.md': `# ${name} for Android

Made with Workline. The app is \`app/src/main/assets/index.html\` in a WebView; it runs its workflows on
Workline through the app's published link, so keep the app **published** in Workline.

## Get the APK without installing anything

1. Make a new repository on GitHub and upload everything in this folder (or \`git push\` it).
2. Open **Actions → Build Android app**. It runs on every push (or press **Run workflow**).
3. When it's done, open the run and download **${slugOf(name)}-apk** under **Artifacts**.
4. Copy the \`.apk\` to your phone and open it (allow "Install unknown apps" when asked).

## Or build it on your computer

Open this folder in **Android Studio** and press **Run**, or with Gradle 8.7 and JDK 17: \`gradle assembleDebug\`.
The APK is in \`app/build/outputs/apk/debug/\`.

## To publish on Google Play

Play needs a signed release build (\`.aab\`): in Android Studio, **Build → Generate Signed App Bundle**.
Change \`applicationId\` in \`app/build.gradle\` to your own (e.g. \`com.yourcompany.${pkgPart(name)}\`) first.

## Changing the app

Change it in Workline: workflow changes apply at once. For changes to the page, export again and replace
\`app/src/main/assets/index.html\`.
`,
  };
}

/* ---- Desktop: an Electron project; electron-builder makes the .exe (and .dmg, .AppImage) ---- */
export function desktopFiles(ui, opts) {
  const name = opts.title || 'App', slug = slugOf(name);
  return {
    'package.json': JSON.stringify({
      name: slug, productName: name, version: '1.0.0', description: `${name}, made with Workline`, main: 'main.js', private: true,
      scripts: { start: 'electron .', dist: 'electron-builder --publish never' },
      devDependencies: { electron: '^31.7.7', 'electron-builder': '^24.13.3' },
      build: {
        appId: `app.workline.${pkgPart(name)}`, productName: name, files: ['main.js', 'app/**'],
        win: { target: ['nsis', 'portable'] }, mac: { target: 'dmg' }, linux: { target: 'AppImage' },
      },
    }, null, 2) + '\n',
    'main.js': `// The app: its page (app/index.html) in a window. It runs its workflows on Workline.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

function open() {
  const win = new BrowserWindow({ width: 1280, height: 860, autoHideMenuBar: true, title: ${JSON.stringify(name)}, webPreferences: { contextIsolation: true, sandbox: true } });
  // Links to other sites open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

app.whenReady().then(() => {
  open();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) open(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`,
    'app/index.html': pageFor(ui, opts),
    '.github/workflows/build-desktop.yml': `# Builds the app on GitHub for Windows (.exe), Mac (.dmg) and Linux (.AppImage): push this folder to a
# repository, then open Actions → Build desktop app → the latest run → Artifacts.
name: Build desktop app
on:
  push:
  workflow_dispatch:
jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run dist
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      - uses: actions/upload-artifact@v4
        with:
          name: ${slug}-\${{ matrix.os }}
          path: |
            dist/*.exe
            dist/*.dmg
            dist/*.AppImage
`,
    '.gitignore': 'node_modules/\ndist/\n',
    'README.md': `# ${name} for Windows, Mac and Linux

Made with Workline. The app is \`app/index.html\` in an Electron window; it runs its workflows on Workline
through the app's published link, so keep the app **published** in Workline.

## Get the .exe without installing anything

1. Make a new repository on GitHub and upload everything in this folder (or \`git push\` it).
2. Open **Actions → Build desktop app**. It runs on every push (or press **Run workflow**).
3. When it's done, open the run and download the file for your system under **Artifacts**:
   Windows: an installer (\`${name} Setup 1.0.0.exe\`) and a portable \`.exe\`; Mac: \`.dmg\`; Linux: \`.AppImage\`.

## Or build it on your computer

With Node.js 20: \`npm install\`, then \`npm start\` to try it, or \`npm run dist\` to make the installer in \`dist/\`.

Windows and Mac may warn that the app is from an unknown developer, as it isn't code-signed: choose
**More info → Run anyway** (Windows) or right-click → **Open** (Mac). Signing needs a certificate of your own.

## Changing the app

Change it in Workline: workflow changes apply at once. For changes to the page, export again and replace
\`app/index.html\`.
`,
  };
}

export async function exportZip(files, name) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip(), root = zip.folder(name);
  for (const [p, text] of Object.entries(files)) root.file(p, text);
  download(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${name}.zip`);
}
