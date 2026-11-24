import http from 'node:http';
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from './backend/store.js';
import { memoryBackend } from './backend/storage.js';
import { createApp } from './backend/app.js';
const nv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(401, {'content-type':'application/json'}); res.end('{"detail":"Unauthorized access"}'); }); }).listen(0);
const app = createApp(await openStore(memoryBackend()), { noAccounts: true, nvidiaKey: 'nvapi-x', nvidiaBase: 'http://localhost:'+nv.address().port+'/v1' });
const srv = app.listen(0);
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--port','5264','--strictPort'], { cwd:'frontend', stdio:'ignore', env:{...process.env, LINEWORK_API:'http://localhost:'+srv.address().port} });
const url='http://localhost:5264';
const now=Date.now();
const flow = { edges: [{ id: 'e', from: 's', to: 'r', fromPort: 'main', toPort: 'main' },{ id: 'e2', from: 'r', to: 'p', fromPort: 'main', toPort: 'main' }], nodes: [
  { id: 's', type: 'trigger.manual', name: 'Start', x: 0, y: 0, params: {} },
  { id: 'r', type: 'ai.rewrite', name: 'Convert', x: 300, y: 0, params: { text: 'function add(a,b){return a+b}', style: 'custom', instructions: 'To Python' } },
  { id: 'p', type: 'text.case', name: 'Python Code', x: 600, y: 0, params: {} }] };
const files=[{ id:'fcc1', title:'code converter', created:now, updated:now, doc:'', diagrams:[{id:'d1',type:'architecture',name:'Diagram 1',code:''}], active:0, view:'flow', flow }];
try {
for (let i=0;i<60;i++){ try{ if((await fetch(url)).ok) break; }catch(e){} await new Promise(r=>setTimeout(r,500)); }
const b = await chromium.launch({channel:'msedge'});
const p = await b.newPage({ viewport:{width:390,height:844}, colorScheme:'dark', deviceScaleFactor:2, hasTouch:true, isMobile:true });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.addInitScript(list=>{ localStorage.setItem('linework:ai-open','0'); if(!sessionStorage.getItem('s')){sessionStorage.setItem('s','1');localStorage.setItem('linework:files:v2', JSON.stringify(list));} }, files);
await p.goto(url); await p.waitForTimeout(1500);
await p.keyboard.press('w'); await p.waitForTimeout(1500);
await p.screenshot({ path: 'C:/Users/shubham/AppData/Local/Temp/claude/510ba8aca5177316/c3f06a04-45ed-469c-a6f0-fa94e35eaec9/scratchpad/mob-1.png' });
await p.getByRole('button', { name: /^Run code converter/ }).click(); await p.waitForTimeout(5000);
await p.screenshot({ path: 'C:/Users/shubham/AppData/Local/Temp/claude/510ba8aca5177316/c3f06a04-45ed-469c-a6f0-fa94e35eaec9/scratchpad/mob-2.png', fullPage: true });
console.log('errors', errs);
await b.close();
} finally { spawnSync('taskkill',['/pid',String(vite.pid),'/T','/F']); srv.close(); nv.close(); app.flows?.close(); process.exit(0); }
