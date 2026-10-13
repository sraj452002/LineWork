import { dg } from './engines.js';
import { rid } from './utils.js';
import { newSheet } from './sheet.js';
import { appDoc } from './apphost.js';
import { secretPath } from './flows.js';
import { COMPONENTS, THEMES, builderHtml } from './appbuilder.js';
import { OTT_CATALOGUE, ottSpec, OTT2_FIRST, OTT2_EPISODES, OTT2_ROW, OTT2_TOP10, OTT2_LIVE, OTT2_PLANS } from './ott.js';

/* Ready-made templates for every tool (Templates → Ready-made). Each make() gives a new file, opened in the
   view it's for. `tool` groups them: Diagrams, Docs, Sheets, Databases, Code, Workflows, Apps, Pages. */

const now = () => Date.now();
const file = (title, extra) => ({ id: rid('f'), title, created: now(), updated: now(), doc: '', diagrams: [dg('architecture', 'Diagram 1', '')], active: 0, view: 'canvas', ...extra });
const diagram = (title, type, code, extra = {}) => file(title, { diagrams: [{ ...dg(type, title, code), ...(type === 'flowchart' ? { dir: 'TB' } : {}) }], view: 'canvas', ...extra });
const docFile = (title, md) => file(title, { doc: md, view: 'doc' });
const head = cols => Object.fromEntries(cols.map(c => [c, { b: 1, bg: '#dbe9e1' }]));
const sheetFile = (title, sheets) => file(title, { view: 'sheet', sheets, activeSheet: sheets[0].id });
const codeFile = (title, files) => {
  const list = files.map(([path, text]) => ({ id: rid('cf'), path, text }));
  const first = list.find(f => !/\.md$/.test(f.path)) || list[0];
  return file(title, { view: 'code', code: { files: list, folders: [], open: [first.id], active: first.id } });
};
const node = (type, name, x, params = {}, y = 160) => ({ id: rid('n'), type, name, x, y, params });
const chain = nodes => nodes.slice(1).map((n, i) => ({ id: rid('e'), from: nodes[i].id, fromPort: 'main', to: n.id, toPort: 'main' }));
const flowFile = (title, nodes, edges = chain(nodes), extra = {}) => file(title, { view: 'flow', flow: { active: false, nodes, edges }, ...extra });

/* ---- Diagrams ---- */
const DIAGRAMS = [
  { k: 'd-micro', name: 'Microservices architecture', note: 'Gateway, services, queue and their databases', make: () => diagram('Shop platform', 'architecture', `title: Shop platform
user [Shopper] user
admin [Staff] user
group edge "Edge" {
  cdn [CDN] cloud
  gw [API gateway] lb
}
group services "Services" {
  catalog [Catalog service] api
  orders [Orders service] api
  payments [Payments service] api
  notify [Notifications] function
}
group data "Data" {
  catdb [Catalog DB | Postgres] database
  orderdb [Orders DB | Postgres] database
  bus [Events | Kafka] queue
  cache [Cache | Redis] cache
}
stripe [Stripe] external
user > cdn > gw
admin > gw
gw > catalog, orders
catalog > catdb, cache
orders > orderdb
orders > payments : charge
payments > stripe
orders > bus : order placed
bus > notify : email the shopper`) },
  { k: 'd-signup', name: 'Sign-up flow', note: 'A flowchart with decisions and a retry', make: () => diagram('Sign-up flow', 'flowchart', `title: Sign-up flow
start [Open sign-up] start
form [Enter email and password] io
valid [Details valid?] decision
exists [Email already used?] decision
create [Create account] step
mail [Send confirmation email] step
confirm [Clicked the link?] decision
done [Welcome screen] end
fix [Show what to fix] step
login [Offer to sign in] step
start > form > valid
valid > exists : yes
valid > fix : no
fix > form
exists > login : yes
exists > create : no
create > mail > confirm
confirm > done : yes
confirm > mail : resend`) },
  { k: 'd-checkout', name: 'Checkout sequence', note: 'Who calls whom when someone pays', make: () => diagram('Checkout', 'sequence', `title: Checkout
user [Shopper] user
web [Web app] client
api [Orders API] api
pay [Payment provider] external
db [Orders DB] database
user > web : Press Pay
web > api : Create order
api > db : Save order (pending)
api > pay : Charge card
pay --> api : Payment succeeded
api > db : Mark paid
api --> web : Order confirmed
web --> user : Thank-you page`) },
  { k: 'd-cicd', name: 'CI/CD pipeline', note: 'From a commit to production, with checks', make: () => diagram('CI/CD pipeline', 'flowchart', `title: CI/CD pipeline
push [Push to main] start
build [Build] step
test [Unit tests] step
pass [Tests pass?] decision
image [Build container image] step
stage [Deploy to staging] step
smoke [Smoke tests OK?] decision
prod [Deploy to production] step
alert [Tell the team] step
done [Live] end
push > build > test > pass
pass > image : yes
pass > alert : no
image > stage > smoke
smoke > prod : yes
smoke > alert : no
prod > done`) },
];

/* ---- Docs ---- */
const DOCS = [
  { k: 'doc-prd', name: 'Product requirements (PRD)', note: 'Problem, users, requirements, metrics, launch plan', make: () => docFile('Product requirements', `# Product requirements: Untitled feature

## Problem
Who has the problem, how often, and what it costs them today.

## Users and jobs to be done
- **Primary:** …
- **Secondary:** …

## Goals
- Measurable outcome 1
- Measurable outcome 2

## Non-goals
- …

## Requirements
| # | Requirement | Priority |
|---|---|---|
| 1 | … | Must |
| 2 | … | Should |
| 3 | … | Could |

## User experience
Describe the main flow, step by step. Link the flowchart on the canvas.

## Success metrics
- Adoption: …
- Quality: …

## Launch plan
1. Internal beta
2. 10% rollout
3. Everyone

## Open questions
- …
`) },
  { k: 'doc-meeting', name: 'Meeting notes', note: 'Agenda, decisions and action items', make: () => docFile('Meeting notes', `# Meeting notes — ${new Date().toLocaleDateString()}

**Attendees:** …
**Goal of the meeting:** …

## Agenda
1. …
2. …
3. …

## Discussion
- …

## Decisions
- …

## Action items
| Owner | Action | Due |
|---|---|---|
| … | … | … |

## Next meeting
…
`) },
  { k: 'doc-postmortem', name: 'Incident postmortem', note: 'What happened, impact, timeline, causes, follow-ups', make: () => docFile('Incident postmortem', `# Postmortem: Untitled incident

**Date:** …  **Severity:** …  **Authors:** …

## Summary
Two or three sentences: what broke, for whom, for how long.

## Impact
- Users affected: …
- Duration: …
- Revenue / data impact: …

## Timeline (UTC)
| Time | Event |
|---|---|
| 00:00 | First alert |
| 00:05 | On-call acknowledged |
| 00:30 | Mitigated |
| 01:10 | Resolved |

## Root cause
What actually caused it (not who).

## What went well
- …

## What went badly
- …

## Follow-ups
| Action | Owner | Due |
|---|---|---|
| … | … | … |
`) },
  { k: 'doc-adr', name: 'Architecture decision record', note: 'One decision: context, options, consequences', make: () => docFile('Architecture decision', `# ADR-001: Untitled decision

**Status:** Proposed

## Context
What forces are at play: requirements, constraints, team skills, deadlines.

## Options considered
1. **Option A** — pros / cons
2. **Option B** — pros / cons
3. **Do nothing** — pros / cons

## Decision
We will …

## Consequences
- Good: …
- Bad: …
- What we'll revisit, and when: …
`) },
];

/* ---- Sheets ---- */
const SHEETS = [
  { k: 's-tracker', name: 'Project tracker', note: 'Tasks, owners, status, due dates and progress', make: () => {
    const s = newSheet('Tasks', {
      A1: 'Task', B1: 'Owner', C1: 'Status', D1: 'Due', E1: 'Estimate (h)', F1: 'Done (h)', G1: 'Progress',
      A2: 'Write the spec', B2: 'Ada', C2: 'Done', D2: '2026-11-03', E2: '6', F2: '6', G2: '=IF(E2=0,0,F2/E2)',
      A3: 'Design the screens', B3: 'Grace', C3: 'In progress', D3: '2026-11-07', E3: '12', F3: '7', G3: '=IF(E3=0,0,F3/E3)',
      A4: 'Build the API', B4: 'Linus', C4: 'In progress', D4: '2026-11-14', E4: '20', F4: '8', G4: '=IF(E4=0,0,F4/E4)',
      A5: 'Write tests', B5: 'Margaret', C5: 'To do', D5: '2026-11-18', E5: '8', F5: '0', G5: '=IF(E5=0,0,F5/E5)',
      A6: 'Launch', B6: 'Ada', C6: 'To do', D6: '2026-11-21', E6: '4', F6: '0', G6: '=IF(E6=0,0,F6/E6)',
      A8: 'Total', E8: '=SUM(E2:E6)', F8: '=SUM(F2:F6)', G8: '=F8/E8',
      A9: 'Tasks done', C9: '=COUNTIF(C2:C6,"Done")',
    });
    s.fmt = { ...head(['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1']), A8: { b: 1 }, E8: { b: 1 }, F8: { b: 1 }, G8: { b: 1, nf: '0%' }, ...Object.fromEntries([2, 3, 4, 5, 6].map(r => [`G${r}`, { nf: '0%' }])) };
    s.widths = { A: 180, C: 110 };
    s.freeze = { r: 1, c: 0 };
    return sheetFile('Project tracker', [s]);
  } },
  { k: 's-invoice', name: 'Invoice', note: 'Line items with subtotal, tax and total', make: () => {
    const s = newSheet('Invoice', {
      A1: 'INVOICE', A3: 'Bill to:', B3: 'Customer name', A4: 'Invoice #', B4: 'INV-0001', A5: 'Date', B5: new Date().toISOString().slice(0, 10),
      A7: 'Description', B7: 'Qty', C7: 'Unit price', D7: 'Amount',
      A8: 'Design work', B8: '10', C8: '85', D8: '=B8*C8',
      A9: 'Development', B9: '24', C9: '95', D9: '=B9*C9',
      A10: 'Hosting (1 year)', B10: '1', C10: '240', D10: '=B10*C10',
      C12: 'Subtotal', D12: '=SUM(D8:D10)', C13: 'Tax rate', D13: '18%', C14: 'Tax', D14: '=D12*D13', C15: 'Total', D15: '=D12+D14',
    });
    s.fmt = { A1: { b: 1, fs: 20 }, ...head(['A7', 'B7', 'C7', 'D7']), C15: { b: 1 }, D15: { b: 1, bd: { t: 1, b: 2 } } };
    s.widths = { A: 200 };
    return sheetFile('Invoice', [s]);
  } },
  { k: 's-sales', name: 'Sales report with chart', note: 'Monthly sales by region, totals and a chart', make: () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], data = [[120, 90, 150], [135, 95, 160], [150, 110, 155], [170, 105, 180], [160, 125, 190], [190, 130, 210]];
    const cells = { A1: 'Month', B1: 'North', C1: 'South', D1: 'East', E1: 'Total' };
    months.forEach((m, i) => { const r = i + 2; cells[`A${r}`] = m; data[i].forEach((v, j) => { cells[`${'BCD'[j]}${r}`] = String(v); }); cells[`E${r}`] = `=SUM(B${r}:D${r})`; });
    Object.assign(cells, { A8: 'Total', B8: '=SUM(B2:B7)', C8: '=SUM(C2:C7)', D8: '=SUM(D2:D7)', E8: '=SUM(E2:E7)', A9: 'Average', B9: '=AVERAGE(B2:B7)', C9: '=AVERAGE(C2:C7)', D9: '=AVERAGE(D2:D7)', E9: '=AVERAGE(E2:E7)' });
    const s = newSheet('Sales', cells);
    s.fmt = { ...head(['A1', 'B1', 'C1', 'D1', 'E1']), A8: { b: 1 }, E8: { b: 1 }, ...Object.fromEntries(['B9', 'C9', 'D9', 'E9'].map(a => [a, { nf: '0.0' }])) };
    s.charts = [{ id: rid('ch'), type: 'column', range: 'A1:D7', title: 'Sales by region', x: 520, y: 20, w: 460, h: 280 }];
    return sheetFile('Sales report', [s]);
  } },
  { k: 's-habits', name: 'Weekly habit tracker', note: 'Tick off habits each day; streaks and percentages', make: () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], habits = ['Exercise', 'Read 20 min', 'No phone after 10pm', 'Drink water'];
    const cells = { A1: 'Habit', I1: 'Done', J1: 'Rate' };
    days.forEach((d, i) => { cells[`${'BCDEFGH'[i]}1`] = d; });
    habits.forEach((h, i) => { const r = i + 2; cells[`A${r}`] = h; ['B', 'D', 'F'].forEach(c => { cells[`${c}${r}`] = '1'; }); cells[`I${r}`] = `=SUM(B${r}:H${r})`; cells[`J${r}`] = `=I${r}/7`; });
    const s = newSheet('This week', cells);
    s.fmt = { ...head(['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1']), ...Object.fromEntries(habits.map((_, i) => [`J${i + 2}`, { nf: '0%' }])) };
    s.widths = { A: 180 };
    return sheetFile('Habit tracker', [s]);
  } },
];

/* ---- Databases (schemas, drawn; connect a live database in the Database view) ---- */
const DATABASES = [
  { k: 'db-shop', name: 'Online shop schema', note: 'Customers, products, orders, payments', make: () => diagram('Online shop', 'erd', `title: Online shop
customers [icon: user, color: blue] {
  id uuid pk
  email text unique
  name text
  created_at timestamptz
}
products [icon: package, color: green] {
  id uuid pk
  sku text unique
  name text
  price_cents int
  stock int
}
orders [icon: shopping-cart, color: orange] {
  id uuid pk
  customer_id uuid fk
  status text
  total_cents int
  placed_at timestamptz
}
order_items [icon: list, color: orange] {
  id uuid pk
  order_id uuid fk
  product_id uuid fk
  quantity int
  price_cents int
}
payments [icon: credit-card, color: purple] {
  id uuid pk
  order_id uuid fk
  provider text
  amount_cents int
  paid_at timestamptz
}
orders.customer_id > customers.id
order_items.order_id > orders.id
order_items.product_id > products.id
payments.order_id > orders.id`) },
  { k: 'db-blog', name: 'Blog schema', note: 'Authors, posts, tags and comments', make: () => diagram('Blog', 'erd', `title: Blog
authors [icon: user, color: blue] {
  id uuid pk
  name text
  email text unique
}
posts [icon: file, color: green] {
  id uuid pk
  author_id uuid fk
  title text
  slug text unique
  body text
  published_at timestamptz
}
tags [icon: tag, color: orange] {
  id uuid pk
  name text unique
}
post_tags [color: orange] {
  post_id uuid pk fk
  tag_id uuid pk fk
}
comments [icon: message-circle, color: purple] {
  id uuid pk
  post_id uuid fk
  author_name text
  body text
  created_at timestamptz
}
posts.author_id > authors.id
post_tags.post_id > posts.id
post_tags.tag_id > tags.id
comments.post_id > posts.id`) },
  { k: 'db-saas', name: 'SaaS accounts and billing', note: 'Organizations, members, plans, subscriptions, invoices', make: () => diagram('SaaS billing', 'erd', `title: SaaS accounts and billing
organizations [icon: users, color: blue] {
  id uuid pk
  name text
  created_at timestamptz
}
users [icon: user, color: blue] {
  id uuid pk
  email text unique
  name text
}
memberships [color: blue] {
  id uuid pk
  organization_id uuid fk
  user_id uuid fk
  role text
}
plans [icon: star, color: green] {
  id uuid pk
  name text
  price_cents int
  interval text
}
subscriptions [icon: repeat, color: orange] {
  id uuid pk
  organization_id uuid fk
  plan_id uuid fk
  status text
  renews_at timestamptz
}
invoices [icon: credit-card, color: purple] {
  id uuid pk
  subscription_id uuid fk
  amount_cents int
  paid boolean
  issued_at timestamptz
}
memberships.organization_id > organizations.id
memberships.user_id > users.id
subscriptions.organization_id > organizations.id
subscriptions.plan_id > plans.id
invoices.subscription_id > subscriptions.id`) },
];

/* ---- Code ---- */
const CODE = [
  { k: 'c-api', name: 'Node.js REST API', note: 'An Express-style API with routes and an in-memory store (Run starts it)', make: () => codeFile('REST API', [
    ['README.md', '# REST API\n\nA tiny API with no dependencies. Run `node server.js`, then open /api/todos.\n'],
    ['server.js', `import { createServer } from 'node:http';
import { todos, addTodo, toggleTodo } from './store.js';

const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readJson = req => new Promise(ok => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b ? JSON.parse(b) : {})); });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/todos') return send(res, 200, todos());
  if (req.method === 'POST' && url.pathname === '/api/todos') {
    const { title } = await readJson(req);
    if (!title) return send(res, 400, { error: 'title is required' });
    return send(res, 201, addTodo(title));
  }
  const m = url.pathname.match(/^\\/api\\/todos\\/(\\d+)\\/toggle$/);
  if (req.method === 'POST' && m) return send(res, 200, toggleTodo(Number(m[1])) || { error: 'not found' });
  send(res, 404, { error: 'not found' });
}).listen(3000, () => console.log('API on http://localhost:3000/api/todos'));
`],
    ['store.js', `let next = 1;
const list = [];

export const todos = () => list;
export function addTodo(title) {
  const t = { id: next++, title, done: false };
  list.push(t);
  return t;
}
export function toggleTodo(id) {
  const t = list.find(x => x.id === id);
  if (t) t.done = !t.done;
  return t;
}

addTodo('Try the API');
`],
    ['package.json', '{\n  "name": "rest-api",\n  "type": "module",\n  "scripts": { "start": "node server.js" }\n}\n'],
  ]) },
  { k: 'c-python', name: 'Python data analysis', note: 'Read a CSV, group, summarize and print a report', make: () => codeFile('Data analysis', [
    ['analysis.py', `import csv
from collections import defaultdict
from statistics import mean

# Sales per region and month, from sales.csv
totals = defaultdict(float)
by_month = defaultdict(list)
with open("sales.csv") as f:
    for row in csv.DictReader(f):
        amount = float(row["amount"])
        totals[row["region"]] += amount
        by_month[row["month"]].append(amount)

print("Total by region")
for region, total in sorted(totals.items(), key=lambda x: -x[1]):
    print(f"  {region:<8} {total:>10,.2f}")

print("\\nAverage sale by month")
for month, amounts in by_month.items():
    print(f"  {month:<8} {mean(amounts):>10,.2f}")

best = max(totals, key=totals.get)
print(f"\\nBest region: {best}")
`],
    ['sales.csv', 'month,region,amount\nJan,North,120\nJan,South,90\nJan,East,150\nFeb,North,135\nFeb,South,95\nFeb,East,160\nMar,North,150\nMar,South,110\nMar,East,155\n'],
  ]) },
  { k: 'c-landing', name: 'Landing page', note: 'HTML, CSS and a little JavaScript: hero, features, sign-up', make: () => codeFile('Landing page', [
    ['index.html', `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Acme — ship faster</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="hero">
    <h1>Ship faster with Acme</h1>
    <p>Everything your team needs to plan, build and launch, in one place.</p>
    <form id="signup"><input type="email" placeholder="you@company.com" required><button>Get early access</button></form>
    <p id="thanks" hidden>Thanks! We'll be in touch.</p>
  </header>
  <section class="features">
    <article><h3>Plan</h3><p>Roadmaps and specs that stay up to date.</p></article>
    <article><h3>Build</h3><p>Code, review and deploy without switching tools.</p></article>
    <article><h3>Launch</h3><p>Announce, measure and learn from every release.</p></article>
  </section>
  <script src="main.js"></script>
</body>
</html>
`],
    ['style.css', `body { margin: 0; font: 16px/1.6 system-ui, sans-serif; color: #1d2433; }
.hero { padding: 96px 24px; text-align: center; background: linear-gradient(135deg, #eef2ff, #e0f7f1); }
.hero h1 { font-size: 44px; margin: 0 0 12px; }
form { display: flex; gap: 8px; justify-content: center; margin-top: 24px; }
input { padding: 12px 14px; border: 1px solid #c9cfdd; border-radius: 10px; min-width: 260px; }
button { padding: 12px 18px; border: 0; border-radius: 10px; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; max-width: 960px; margin: 48px auto; padding: 0 24px; }
.features article { padding: 20px; border: 1px solid #e3e6ef; border-radius: 14px; }
`],
    ['main.js', `document.getElementById('signup').addEventListener('submit', e => {
  e.preventDefault();
  e.target.hidden = true;
  document.getElementById('thanks').hidden = false;
});
`],
  ]) },
  { k: 'c-ts', name: 'TypeScript utility with tests', note: 'A small typed module and its tests', make: () => codeFile('TypeScript utilities', [
    ['src/money.ts', `export type Money = { cents: number; currency: string };

export const money = (amount: number, currency = 'USD'): Money => ({ cents: Math.round(amount * 100), currency });

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(\`Can't add \${a.currency} and \${b.currency}\`);
  return { cents: a.cents + b.cents, currency: a.currency };
}

export const format = (m: Money): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency }).format(m.cents / 100);
`],
    ['src/money.test.ts', `import { add, format, money } from './money';

const check = (name: string, ok: boolean) => console.log(ok ? '✓' : '✗', name);

check('adds amounts', add(money(1.1), money(2.2)).cents === 330);
check('formats dollars', format(money(1234.5)) === '$1,234.50');
let threw = false;
try { add(money(1), money(1, 'EUR')); } catch { threw = true; }
check('refuses mixed currencies', threw);
`],
  ]) },
];

/* ---- Workflows ---- */
const WORKFLOWS = [
  { k: 'w-digest', name: 'Daily AI news digest', note: 'Every morning: read a feed, summarize with AI, email the digest', make: () => {
    const nodes = [
      node('trigger.schedule', 'Every morning', 80, { mode: 'daily', at: '07:00' }),
      node('data.rss', 'Read the feed', 340, { url: 'https://hnrss.org/frontpage', limit: 30 }),
      node('core.limit', 'Top 10', 600, { max: 10, from: 'start' }),
      node('ai.summarize', 'Summarize each', 860, { text: '{{ $json.title }}\n{{ $json.summary || "" }}', length: 'sentence', output: 'summary' }),
      node('core.aggregate', 'Collect', 1120, { field: '', into: 'stories' }),
      node('app.email', 'Email me', 1380, { to: 'you@example.com', subject: 'Your daily digest', text: '{{ $json.stories.map(s => "• " + s.title + "\\n  " + s.summary + "\\n  " + s.link).join("\\n\\n") }}' }),
    ];
    return flowFile('Daily AI news digest', nodes);
  } },
  { k: 'w-leads', name: 'Lead capture with AI', note: 'A form → AI sorts the lead → a sheet row → a Slack ping for hot leads', make: () => {
    const nodes = [
      node('trigger.form', 'Contact form', 80, { path: secretPath(), title: 'Talk to sales', fields: 'Name*\nEmail* (email)\nCompany\nWhat do you need? (long)', button: 'Send', thanks: 'Thanks! We’ll reply within a day.' }),
      node('ai.classify', 'How hot?', 340, { text: '{{ $json.whatDoYouNeed }} (company: {{ $json.company }})', categories: 'hot, warm, cold', instructions: 'hot = ready to buy soon with budget; cold = students, spam or job seekers', output: 'temperature' }),
      node('workline.sheet', 'Add to a leads sheet (pick it)', 600, { operation: 'append', values: '{{ { "Name": $json.name, "Email": $json.email, "Company": $json.company, "Need": $json.whatDoYouNeed, "Temperature": $json.temperature, "At": $json.submittedAt } }}' }),
      node('core.if', 'Hot?', 860, { left: '{{ $json.temperature }}', op: 'equals', right: 'hot' }),
      node('app.slack', 'Tell sales', 1120, { channel: '#sales', text: '🔥 Hot lead: {{ $json.name }} ({{ $json.company }}) — {{ $json.whatDoYouNeed }}' }),
    ];
    const edges = chain(nodes.slice(0, 4));
    edges.push({ id: rid('e'), from: nodes[3].id, fromPort: 'true', to: nodes[4].id, toPort: 'main' });
    return flowFile('Lead capture', nodes, edges);
  } },
  { k: 'w-triage', name: 'Support ticket triage', note: 'A webhook → AI pulls out the details and sorts the ticket → the right channel', make: () => {
    const nodes = [
      node('trigger.webhook', 'New ticket', 80, { path: secretPath(), method: 'POST', respond: 'now' }),
      node('ai.extract', 'Pull out details', 340, { text: '{{ $json.body.subject }}\n{{ $json.body.message }}', fields: [{ name: 'product', value: 'which product it’s about' }, { name: 'urgency', value: 'low, normal or urgent' }, { name: 'summary', value: 'one sentence' }] }),
      node('ai.classify', 'Kind of ticket', 600, { text: '{{ $json.body.message }}', categories: 'bug, billing, feature request, question', output: 'kind' }),
      node('core.switch', 'Route', 860, { value: '{{ $json.kind }}', rule1: 'bug', rule2: 'billing', rule3: 'feature request' }),
      node('app.slack', 'Engineering', 1120, { channel: '#bugs', text: '🐞 {{ $json.summary }} ({{ $json.urgency }})' }, 40),
      node('app.slack', 'Finance', 1120, { channel: '#billing', text: '💳 {{ $json.summary }}' }, 160),
      node('app.slack', 'Product', 1120, { channel: '#ideas', text: '💡 {{ $json.summary }}' }, 280),
    ];
    const edges = chain(nodes.slice(0, 4));
    ['0', '1', '2'].forEach((p, i) => edges.push({ id: rid('e'), from: nodes[3].id, fromPort: p, to: nodes[4 + i].id, toPort: 'main' }));
    return flowFile('Support triage', nodes, edges);
  } },
  { k: 'w-report', name: 'Weekly sales report', note: 'Once a week: query the database, total by region, email the report', make: () => {
    const nodes = [
      node('trigger.schedule', 'Every week', 80, { mode: 'interval', every: 7, unit: 'days' }),
      node('workline.database', 'Last week’s orders', 340, { sql: "SELECT region, total_cents / 100.0 AS total\nFROM orders\nWHERE placed_at >= now() - interval '7 days'" }),
      node('core.summarize', 'Total by region', 600, { op: 'sum', field: 'total', groupBy: 'region' }),
      node('core.code', 'Write the report', 860, { language: 'javascript', code: "const lines = items.map(r => `${r.region}: $${Number(r.sum ?? r.total ?? 0).toFixed(2)}`);\nreturn [{ report: 'Sales last week\\n\\n' + lines.join('\\n') }];" }),
      node('app.email', 'Email the team', 1120, { to: 'team@example.com', subject: 'Weekly sales report', text: '{{ $json.report }}' }),
    ];
    return flowFile('Weekly sales report', nodes);
  } },
  { k: 'w-alerts', name: 'Failure alerts', note: 'When any of your workflows fails, post what broke to Slack', make: () => {
    const nodes = [
      node('trigger.error', 'A workflow failed', 80, {}),
      node('app.slack', 'Alert', 340, { channel: '#alerts', text: '⚠️ “{{ $json.workflow }}” failed at {{ $json.failedNode }}: {{ $json.error }}' }),
    ];
    return flowFile('Failure alerts', nodes);
  } },
];

/* ---- Custom apps (a workflow, and a page of your own around it) ---- */
const appFile = (title, nodes, html) => {
  const f = flowFile(title, nodes);
  f.view = 'app';
  f.ui = { html, flows: [f.id], published: false, doc: appDoc(html, { workflows: [{ id: f.id, name: title }], title }) };
  return f;
};
const APPS = [
];

/* ---- A visual app (App view → Visual): components on pages, people sign in ---- */
const visualApp = (title, nodes, spec, access = 'public') => {
  // Each component starts from its defaults, so a template names only what it changes.
  for (const pg of spec.pages) pg.components = pg.components.map(c => ({ ...c, props: { ...JSON.parse(JSON.stringify(COMPONENTS[c.type].props)), ...c.props } }));
  const f = flowFile(title, nodes);
  f.view = 'app';
  const html = builderHtml(spec, { access });
  f.ui = { mode: 'visual', spec, access, allow: [], html, flows: [f.id], published: false, doc: appDoc(html, { workflows: [{ id: f.id, name: title }], title }) };
  return f;
};
const C = (id, type, name, x, y, w, h, props) => ({ id, type, name, x, y, w, h, props });

const go = page => ({ kind: 'go', page }), set = (name, value) => ({ kind: 'set', name, value }), toast = text => ({ kind: 'toast', text });

/* ---- The streaming app: the workflow fetches the video files and builds the catalogue; the app is all
   Visual builder components (no code), on nine pages. ---- */
APPS.push({ k: 'a-ott', name: 'OTT streaming app (Hotstar-style)', note: 'StarPlay, no code: spotlight slideshow, Top 10, continue watching, live sports, shows with seasons and episodes, a player, search, My Space and plans', make: () => visualApp('StarPlay', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.http', 'Fetch video files', 340, { method: 'GET', url: VIDEO_LIST_URL, query: [], headers: [], bodyType: 'none', body: '', failOnError: true }),
  node('core.code', 'Build the catalogue', 600, { language: 'javascript', code: OTT_CATALOGUE }),
], ottSpec()) });

/* ---- Two easy examples, for the "Easy start" guide: first a workflow, then an app that uses it ---- */
const REPORT = `// STEP 1 of the app: the workflow.
// The app sends us: the student's name and marks in 5 subjects (out of 100 each).
const s = items[0] || {};
const subjects = ['maths', 'science', 'english', 'hindi', 'social'];
const marks = subjects.map(k => Number(s[k]) || 0);

// Add up the marks and work out the percentage.
const total = marks.reduce((sum, m) => sum + m, 0);
const percent = Math.round(total / subjects.length * 10) / 10;

// Grade from the percentage. You pass if every subject has 33 or more.
const grade = percent >= 90 ? 'A+' : percent >= 75 ? 'A' : percent >= 60 ? 'B' : percent >= 45 ? 'C' : percent >= 33 ? 'D' : 'E';
const passed = marks.every(m => m >= 33);
const best = subjects[marks.indexOf(Math.max(...marks))];

// What we give back to the app: one row.
return [{ name: s.name || 'Student', total, percent, grade, result: passed ? 'Pass' : 'Fail', best }];`;
const mark = (id, name, label, x, y) => C(id, 'input', name, x, y, 4, 9, { label, kind: 'number', placeholder: '0 to 100', value: '' });
const easyReport = () => visualApp('Report card', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.code', 'Work out the result', 340, { language: 'javascript', code: REPORT }),
], {
  name: 'Report card', theme: { ...THEMES.ocean, radius: 14, font: 'system' }, nav: 'top', data: [],
  pages: [
    { id: 'home', name: 'Report card', nav: true, components: [
      C('r1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'My report card', size: 'lg' }),
      C('r2', 'text', 'text1', 0, 6, 12, 5, { text: 'Type your marks (out of 100) and press the button. The **workflow** works out the rest.' }),
      C('r3', 'input', 'name', 0, 12, 4, 9, { label: 'Your name', placeholder: 'e.g. Riya', value: '' }),
      mark('r4', 'maths', 'Maths', 4, 12), mark('r5', 'science', 'Science', 8, 12),
      mark('r6', 'english', 'English', 0, 22), mark('r7', 'hindi', 'Hindi', 4, 22), mark('r8', 'social', 'Social science', 8, 22),
      C('r9', 'button', 'make', 0, 32, 4, 6, { label: 'Make my report card', look: 'primary', steps: [
        { kind: 'workflow', workflow: 'Report card', into: 'card', input: ['name', 'maths', 'science', 'english', 'hindi', 'social'].map(k => ({ name: k, value: `{{ vars.${k} }}` })) },
      ] }),
      C('r10', 'stat', 'total', 0, 40, 3, 12, { label: 'Total (out of 500)', value: '{{ data.card ? data.card[0].total : "–" }}', note: '' }),
      C('r11', 'stat', 'percent', 3, 40, 3, 12, { label: 'Percentage', value: '{{ data.card ? data.card[0].percent + "%" : "–" }}', note: '' }),
      C('r12', 'stat', 'grade', 6, 40, 3, 12, { label: 'Grade', value: '{{ data.card ? data.card[0].grade : "–" }}', note: '' }),
      C('r13', 'stat', 'result', 9, 40, 3, 12, { label: 'Result', value: '{{ data.card ? data.card[0].result : "–" }}', note: '{{ data.card ? "Best subject: " + data.card[0].best : "" }}' }),
      C('r14', 'text', 'text2', 0, 53, 12, 5, { text: '{{ data.card ? "Well done, " + data.card[0].name + "!" : "" }}' }),
    ] },
  ],
});

const QUIZ = `// STEP 1 of the app: the workflow.
// It has the questions and the right answers. The app shows the questions,
// then sends back what was picked as a1, a2, a3, a4, a5, and we count the right ones.
const questions = [
  { q: 'What is 12 × 12?', options: ['124', '144', '154'], answer: '144' },
  { q: 'Which planet is called the Red Planet?', options: ['Venus', 'Mars', 'Jupiter'], answer: 'Mars' },
  { q: 'What gas do plants take in?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen'], answer: 'Carbon dioxide' },
  { q: 'Who wrote the national anthem of India?', options: ['Rabindranath Tagore', 'Bankim Chandra', 'Sarojini Naidu'], answer: 'Rabindranath Tagore' },
  { q: 'H₂O is the formula of…', options: ['Salt', 'Water', 'Sugar'], answer: 'Water' },
];
const sent = items[0] || {};
const picked = questions.map((q, i) => sent['a' + (i + 1)] || '');
const score = picked.filter((p, i) => p === questions[i].answer).length;

// One row per question: the app shows these.
return questions.map((q, i) => ({
  number: i + 1, question: q.q, options: q.options,
  picked: picked[i] || '(none)', correct: q.answer,
  mark: picked[i] === q.answer ? '✅' : '❌', score,
}));`;
const question = (n, y) => C('q' + n, 'radio', 'a' + n, 0, y, 12, 12, { label: `{{ data.quiz ? data.quiz[${n - 1}].number + ". " + data.quiz[${n - 1}].question : "" }}`, options: `{{ data.quiz ? data.quiz[${n - 1}].options : [] }}`, value: '', inline: true });
const easyQuiz = () => visualApp('Quiz', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.code', 'Questions and score', 340, { language: 'javascript', code: QUIZ }),
], {
  name: 'Quiz', theme: { ...THEMES.sunset, radius: 14, font: 'system' }, nav: 'top',
  data: [{ id: 's1', name: 'quiz', workflow: 'Quiz', input: [], auto: true }],
  pages: [
    { id: 'home', name: 'Quiz', nav: true, components: [
      C('h1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Quick quiz', size: 'lg' }),
      C('h2', 'text', 'text1', 0, 6, 12, 5, { text: 'Pick one answer for each question, then press **Check my answers**.' }),
      question(1, 12), question(2, 25), question(3, 38), question(4, 51), question(5, 64),
      C('h3', 'button', 'check', 0, 77, 4, 6, { label: 'Check my answers', look: 'primary', steps: [
        { kind: 'workflow', workflow: 'Quiz', into: 'checked', input: [1, 2, 3, 4, 5].map(n => ({ name: 'a' + n, value: `{{ vars.a${n} }}` })) },
        go('score'),
      ] }),
    ] },
    { id: 'score', name: 'Score', nav: false, components: [
      C('s1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Your score', size: 'lg' }),
      C('s2', 'stat', 'score', 0, 7, 4, 12, { label: 'Right answers', value: '{{ data.checked ? data.checked[0].score + " / 5" : "–" }}', note: '' }),
      C('s3', 'table', 'answers', 0, 20, 12, 34, { title: '', rows: '{{ data.checked }}', columns: 'number, question, picked, correct, mark', search: false }),
      C('s4', 'button', 'again', 0, 55, 3, 6, { label: '↺ Try again', look: 'secondary', steps: [go('home')] }),
    ] },
  ],
});
// Example 3: the workflow fetches a list of videos from the internet (an HTTP request), the app plays them.
export const VIDEO_LIST_URL = 'https://raw.githubusercontent.com/sraj452002/LineWork/master/samples/videos.json';
const TIDY = `// STEP 2 of the workflow. The HTTP request node fetched the video list from the internet,
// and each video in it is now one item. Keep the ones that have a link, and tidy them up.
return items
  .filter(v => v.src)
  .map(v => ({
    id: v.id,
    title: v.title,
    category: v.category || 'Other',
    duration: v.duration || '',
    src: v.src,
    poster: v.poster || '',
  }));`;
const playing = '(vars.list1 || (data.videos || [])[0] || {})';
const easyVideos = () => visualApp('Video app', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.http', 'Fetch videos', 340, { method: 'GET', url: VIDEO_LIST_URL, query: [], headers: [], bodyType: 'none', body: '', failOnError: true }),
  node('core.code', 'Tidy up', 600, { language: 'javascript', code: TIDY }),
], {
  name: 'Video app', theme: { ...THEMES.midnight, radius: 14, font: 'system' }, nav: 'top',
  data: [{ id: 's1', name: 'videos', workflow: 'Video app', input: [], auto: true }],
  pages: [
    { id: 'home', name: 'Videos', nav: true, components: [
      C('v1', 'video', 'player', 0, 0, 8, 40, { src: `{{ ${playing}.src }}`, poster: `{{ ${playing}.poster }}` }),
      C('v2', 'heading', 'playing', 8, 0, 4, 6, { text: `{{ ${playing}.title || "Loading videos…" }}`, size: 'md' }),
      C('v3', 'text', 'about', 8, 7, 4, 8, { text: `{{ ${playing}.title ? ${playing}.category + " · " + ${playing}.duration : "" }}` }),
      C('v4', 'text', 'how', 8, 16, 4, 14, { text: 'These videos come from a **workflow**: it fetches a list from the internet. Click a video below to play it.' }),
      C('v5', 'search', 'search', 0, 41, 4, 6, { placeholder: 'Search videos' }),
      C('v6', 'radio', 'category', 4, 41, 8, 6, { label: '', options: '{{ ["All", ...new Set((data.videos || []).map(v => v.category))] }}', value: 'All', inline: true }),
      C('v7', 'list', 'list1', 0, 48, 12, 60, { rows: '{{ (data.videos || []).filter(v => (!vars.category || vars.category === "All" || v.category === vars.category) && (!vars.search || v.title.toLowerCase().includes(vars.search.toLowerCase()))) }}', title: '{{ item.title }}', subtitle: '{{ item.category + " · " + item.duration }}', image: '{{ item.poster }}' }),
    ] },
  ],
});
export const EASY = { report: REPORT, quiz: QUIZ, tidy: TIDY };
// Hidden from Templates: they open from the Easy start guide.
APPS.unshift(
  { k: 'a-easy-report', hidden: true, name: 'Easy example 1: Report card', note: 'The simplest start: type marks, a workflow works out total, percentage and grade, and the app shows them', make: easyReport },
  { k: 'a-easy-quiz', hidden: true, name: 'Easy example 2: Quiz', note: 'A workflow holds the questions and marks the answers; the app shows them and the score on a second page', make: easyQuiz },
  { k: 'a-easy-videos', hidden: true, name: 'Easy example 3: Video app (fetches videos)', note: 'A workflow fetches a video list from the internet with an HTTP request; the app plays them, with search and categories', make: easyVideos },
);


/* ---- Pages made of nodes (no code) ---- */
const PAGES = [
  // StarPlay 2: the streaming service as one workflow, only nodes, on five pages. The menu and search
  // sit on every page; a Switch sends the run down one page's nodes (the others get no items, so they
  // don't draw). Pick nodes choose what each section shows.
  { k: 'p-ott', name: 'StarPlay 2: OTT app made only of nodes', note: 'One workflow, no app, five pages (Home, Watch, Browse, Sports, Plans) picked by a Switch: menu, search, player, episodes, rows, Top 10, live scores and plans', make: () => {
    const code = (name, c) => node('core.code', name, 0, { language: 'javascript', code: c });
    const text = (name, t) => node('ui.text', name, 0, { text: t, style: 'text' });
    const gallery = (name, caption) => node('ui.media', name, 0, { url: '{{ $json.poster }}', caption, kind: 'image', link: '{{ $json._link }}', poster: '', layout: 'gallery' });
    const head = [
      node('trigger.page', 'Page', 0, { path: secretPath(), title: 'StarPlay 2', description: 'Movies, shows and live sports. This whole app is one workflow made of nodes.', theme: 'dark', width: 'wide' }),
      node('core.http', 'Fetch video files', 0, { method: 'GET', url: VIDEO_LIST_URL, query: [], headers: [], bodyType: 'none', body: '', failOnError: true }),
      node('core.set', 'Remember the choice', 0, { fields: [
        { name: 'q', value: '{{ $node["Page"].json.query || {} }}' }, { name: 'search', value: '{{ ($node["Page"].json.form || {}).search || "" }}' },
        { name: 'action', value: '{{ $node["Page"].json.action || "" }}' }, { name: 'form', value: '{{ $node["Page"].json.form || {} }}' },
      ], keep: true }),
      code('Build the catalogue', OTT2_FIRST),
      node('ui.buttons', 'Menu', 0, { buttons: [{ name: '🏠 Home', value: '?' }, { name: '🎬 Movies', value: '?page=browse&tab=movies' }, { name: '📺 TV Shows', value: '?page=browse&tab=shows' }, { name: '🧸 Kids', value: '?page=browse&tab=kids' }, { name: '🏏 Sports', value: '?page=sports' }, { name: '⭐ Plans', value: '?page=plans' }] }),
      node('ui.form', 'Search', 0, { title: '', fields: 'Search', button: 'Search', action: 'search' }),
      node('core.switch', 'Which page?', 0, { value: '{{ $json._page }}', rule1: 'watch', rule2: 'browse', rule3: 'sports', rule4: 'plans' }),
    ];
    const pages = {
      other: [ // Home
        node('ui.media', 'Spotlight', 0, { url: '{{ $json.backdrop }}', caption: '▶ Watch {{ $json.title }}', kind: 'image', poster: '', link: '?page=watch&video={{ $json.id }}', layout: 'one' }),
        text('Spotlight info', '## {{ $json.title }}\n**{{ $json.year }} · {{ $json.length }} · {{ $json.language }} · {{ $json.rating }}** · ★ {{ $json.score }}\n\n{{ $json.about }}'),
        code('Pick latest', OTT2_ROW), text('Latest heading', '### {{ $json._heading }}'), gallery('Latest', '{{ $json.title }} · {{ $json.year }}'),
        code('Pick the Top 10', OTT2_TOP10), text('Top 10 heading', '### Top 10 in India Today'), gallery('Top 10', '#{{ $json.rank }} {{ $json.title }}'),
      ],
      0: [ // Watch
        node('ui.media', 'Player', 0, { url: '{{ $json.src }}', caption: '', kind: 'video', poster: '{{ $json.backdrop }}', link: '', layout: 'one' }),
        text('About', '## {{ $json.title }}\n**{{ $json.year }} · {{ $json.length }} · {{ $json.language }} · {{ $json.rating }}** · ★ {{ $json.score }}\n\n{{ $json.about }}\n\n{{ $json.genres }}'),
        code('Pick episodes or more', OTT2_EPISODES), text('Episodes heading', '### {{ $json._heading }}'), gallery('Episodes', '{{ $json.title }}'),
      ],
      1: [ // Browse: a menu tab, or search results
        code('Pick the titles', OTT2_ROW), text('Browse heading', '## {{ $json._heading }}'), gallery('Titles', '{{ $json.title }} · {{ $json.year }} · {{ $json.language }}'),
      ],
      2: [ // Sports
        code('Pick live sports', OTT2_LIVE), text('Sports heading', '## 🔴 Live Sports'), node('ui.table', 'Live scores', 0, { title: '', columns: 'match, sport, score, status, watching', max: 10 }),
        gallery('Matches', '{{ $json.status === "LIVE" ? "● LIVE · " : "" }}{{ $json.title }}'),
      ],
      3: [ // Plans
        code('Pick the plans', OTT2_PLANS), text('Plans heading', '{{ $json._thanks }}## Choose your plan'),
        node('ui.cards', 'Prices', 0, { title: '', cards: ['Mobile', 'Super', 'Premium'].map(p => ({ name: p, value: `{{ "₹" + $items.find(i => i.plan === "${p}").monthly + " / month" }}` })) }),
        node('ui.table', 'Compare plans', 0, { title: '', columns: 'plan, monthly, quarterly, yearly, devices, quality, ads, audio, downloads', max: 10 }),
        node('ui.chart', 'Price per year', 0, { title: 'Price per year (₹)', type: 'bar', label: 'plan', value: 'yearly' }),
        node('ui.form', 'Subscribe', 0, { title: 'Subscribe', fields: 'Name*\nMobile number* (tel)\nPlan', button: 'Continue', action: 'subscribe' }),
      ],
    };
    // The shared part across the top; each page on a row of its own under it.
    head.forEach((n, i) => { n.x = 80 + i * 240; n.y = 80; });
    const sw = head[head.length - 1], edges = chain(head);
    Object.assign(sw, { x: 80, y: 660 }); // the Switch at the left, facing the five pages
    [0, 1, 2, 3, 'other'].forEach((port, row) => { // in the Switch's port order, so no lines cross
      const list = pages[port];
      list.forEach((n, i) => { n.x = 400 + i * 240; n.y = 280 + row * 190; });
      edges.push({ id: rid('e'), from: sw.id, fromPort: String(port), to: list[0].id, toPort: 'main' }, ...chain(list));
    });
    return flowFile('StarPlay 2', [...head, ...Object.values(pages).flat()], edges);
  } },
  { k: 'p-sales', name: 'Sales dashboard page', note: 'Cards, a chart, region buttons and a table, built only from nodes', make: () => {
    const nodes = [
      node('trigger.page', 'Page', 80, { path: secretPath(), title: 'Sales dashboard', description: 'Pick a region to filter.', theme: 'light', width: 'wide' }),
      node('core.code', 'Orders', 340, { language: 'javascript', code: "// Swap for a database or sheet node.\nconst { query = {} } = items[0] || {};\nconst orders = [\n  { customer: 'Ada', region: 'North', total: 120 },\n  { customer: 'Grace', region: 'South', total: 80 },\n  { customer: 'Linus', region: 'North', total: 45 },\n  { customer: 'Margaret', region: 'East', total: 210 },\n];\nreturn orders.filter(o => !query.region || o.region === query.region);" }),
      node('ui.buttons', 'Regions', 600, { buttons: [{ name: 'All', value: '?' }, { name: 'North', value: '?region=North' }, { name: 'South', value: '?region=South' }, { name: 'East', value: '?region=East' }] }),
      node('ui.cards', 'Totals', 860, { cards: [{ name: 'Orders', value: '{{ $items.length }}' }, { name: 'Revenue', value: '{{ $items.reduce((s, i) => s + i.total, 0) }}' }] }),
      node('ui.chart', 'By customer', 1120, { title: 'Revenue by customer', type: 'bar', label: 'customer', value: 'total' }),
      node('ui.table', 'Orders table', 1380, { title: 'Orders', columns: 'customer, region, total', max: 100 }),
    ];
    return flowFile('Sales dashboard page', nodes);
  } },
  { k: 'p-feedback', name: 'Feedback form page', note: 'A form that thanks people and shows what was sent, with AI sentiment', make: () => {
    const nodes = [
      node('trigger.page', 'Page', 80, { path: secretPath(), title: 'Tell us what you think', theme: 'light', width: 'normal' }),
      node('core.if', 'Sent?', 340, { left: '{{ $json.action }}', op: 'equals', right: 'feedback' }),
      node('ai.classify', 'Sentiment', 600, { text: '{{ $json.form.message }}', categories: 'happy, neutral, unhappy', output: 'sentiment' }, 60),
      node('ui.text', 'Thanks', 860, { text: '## Thank you, {{ $json.form.name || "friend" }}!\nWe read every message. You sounded **{{ $json.sentiment }}**.', style: 'note' }, 60),
      node('ui.form', 'Feedback form', 600, { title: 'Your feedback', fields: 'Name\nMessage* (long)', button: 'Send', action: 'feedback' }, 260),
    ];
    const edges = [
      { id: rid('e'), from: nodes[0].id, fromPort: 'main', to: nodes[1].id, toPort: 'main' },
      { id: rid('e'), from: nodes[1].id, fromPort: 'true', to: nodes[2].id, toPort: 'main' },
      { id: rid('e'), from: nodes[2].id, fromPort: 'main', to: nodes[3].id, toPort: 'main' },
      { id: rid('e'), from: nodes[1].id, fromPort: 'false', to: nodes[4].id, toPort: 'main' },
    ];
    return flowFile('Feedback form page', nodes, edges);
  } },
];

export const READY_TOOLS = ['Diagrams', 'Docs', 'Sheets', 'Databases', 'Code', 'Workflows', 'Apps', 'Pages'];
export const READY = [
  ...DIAGRAMS.map(t => ({ ...t, tool: 'Diagrams', view: 'Canvas' })),
  ...DOCS.map(t => ({ ...t, tool: 'Docs', view: 'Doc' })),
  ...SHEETS.map(t => ({ ...t, tool: 'Sheets', view: 'Sheet' })),
  ...DATABASES.map(t => ({ ...t, tool: 'Databases', view: 'Canvas' })),
  ...CODE.map(t => ({ ...t, tool: 'Code', view: 'Code' })),
  ...WORKFLOWS.map(t => ({ ...t, tool: 'Workflows', view: 'Workflow' })),
  ...APPS.map(t => ({ ...t, tool: 'Apps', view: 'App' })),
  ...PAGES.map(t => ({ ...t, tool: 'Pages', view: 'Workflow' })),
];
