// Puts the guides' music on the recorded videos (frontend/public/guides/*.mp4): renders the same music
// the animated guides play (frontend/src/lib/guideAudio.js) in a headless browser, then adds it with ffmpeg.
// Run: node scripts/guide-audio.mjs   (needs ffmpeg and Playwright's Chromium). Running it again replaces the music.
import { readFileSync, writeFileSync, renameSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const dir = 'frontend/public/guides';
const lib = readFileSync('frontend/src/lib/guideAudio.js', 'utf8').replace(/^export /gm, '');
const tmp = mkdtempSync(join(tmpdir(), 'guide-audio-'));
// CHROMIUM=/path/to/chrome to use a browser of your own.
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
for (const name of ['workflow', 'tour']) {
  const video = `${dir}/${name}.mp4`;
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }));
  // Render the music offline, with a fade in and a fade out, and return it as a 16-bit WAV.
  const wav = await page.evaluate(async ({ lib, seconds }) => {
    const mod = new Function(`${lib}; return { scheduleBar, barSeconds };`)();
    const rate = 44100, ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const out = ctx.createGain(), warm = ctx.createBiquadFilter(), comp = ctx.createDynamicsCompressor();
    warm.type = 'lowpass'; warm.frequency.value = 3800;
    out.connect(warm); warm.connect(comp); comp.connect(ctx.destination);
    out.gain.setValueAtTime(0, 0); out.gain.linearRampToValueAtTime(1.6, 1.5);
    out.gain.setValueAtTime(1.6, Math.max(1.5, seconds - 2.5)); out.gain.linearRampToValueAtTime(0, seconds);
    for (let t = 0.05, bar = 0; t < seconds; t += mod.barSeconds(), bar++) mod.scheduleBar(ctx, out, t, bar);
    const buf = await ctx.startRendering();
    const n = buf.length, data = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => [...s].forEach((c, k) => data.setUint8(o + k, c.charCodeAt(0)));
    str(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); data.setUint32(16, 16, true);
    data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, rate, true); data.setUint32(28, rate * 4, true);
    data.setUint16(32, 4, true); data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, n * 4, true);
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    for (let k = 0; k < n; k++) for (const [c, ch] of [[0, l], [1, r]]) data.setInt16(44 + k * 4 + c * 2, Math.max(-1, Math.min(1, ch[k])) * 32767, true);
    let bin = ''; const bytes = new Uint8Array(data.buffer);
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(bin);
  }, { lib, seconds });
  const wavPath = join(tmp, `${name}.wav`), outPath = join(tmp, `${name}.mp4`);
  writeFileSync(wavPath, Buffer.from(wav, 'base64'));
  // The picture as it is; the music as AAC. Any older soundtrack is dropped.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-i', wavPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', outPath]);
  renameSync(outPath, video);
  console.log(`${video}: ${seconds.toFixed(1)}s with music`);
}
await browser.close();
