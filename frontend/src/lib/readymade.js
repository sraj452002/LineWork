import { dg } from './engines.js';
import { rid } from './utils.js';
import { newSheet } from './sheet.js';
import { appDoc } from './apphost.js';
import { secretPath } from './flows.js';
import { THEMES, builderHtml } from './appbuilder.js';

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
  { k: 'a-feedback', name: 'Feedback analyzer', note: 'Paste feedback; AI gives the sentiment, themes and a reply draft', make: () => appFile('Feedback analyzer', [
    node('trigger.manual', 'Run by hand', 80),
    node('ai.classify', 'Sentiment', 340, { text: '{{ $json.feedback }}', categories: 'positive, neutral, negative', output: 'sentiment' }),
    node('ai.extract', 'Themes', 600, { text: '{{ $json.feedback }}', fields: [{ name: 'themes', value: 'up to 3 short themes, comma-separated' }, { name: 'reply', value: 'a short, kind reply to the customer' }] }),
  ], `<style>
  body { max-width: 760px; margin: 0 auto; padding: 32px 20px; font: 15px/1.55 system-ui, sans-serif; }
  textarea { width: 100%; min-height: 140px; padding: 12px; font: inherit; border: 1px solid #d0d7de; border-radius: 10px; }
  button { margin-top: 10px; padding: 10px 18px; border: 0; border-radius: 10px; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; }
  .tag { display: inline-block; padding: 3px 10px; border-radius: 999px; background: #eef2ff; margin-right: 6px; }
  .reply { margin-top: 12px; padding: 14px; border-left: 4px solid #4f46e5; background: #f6f8fa; border-radius: 8px; white-space: pre-wrap; }
</style>
<h1>Feedback analyzer</h1>
<p>Paste a customer's message.</p>
<textarea id="text" placeholder="I love the product, but exporting to PDF keeps failing…"></textarea>
<button id="go">Analyze</button>
<div id="out"></div>
<script>
  document.getElementById('go').onclick = async () => {
    const out = document.getElementById('out');
    out.textContent = 'Thinking…';
    try {
      const [r] = await workline.run({ feedback: document.getElementById('text').value });
      out.innerHTML = '<h3>Sentiment: ' + r.sentiment + '</h3>' +
        String(r.themes || '').split(',').filter(Boolean).map(t => '<span class="tag">' + t.trim() + '</span>').join('') +
        '<div class="reply"></div>';
      out.querySelector('.reply').textContent = r.reply || '';
    } catch (e) { out.textContent = e.message; }
  };
</script>`) },
  { k: 'a-kpi', name: 'KPI dashboard', note: 'A workflow computes metrics; the app shows cards and a chart, refreshing every minute', make: () => appFile('KPI dashboard', [
    node('trigger.manual', 'Run by hand', 80),
    node('core.code', 'Metrics', 340, { language: 'javascript', code: "// Swap for a database, sheet or API node: one row per day.\nconst days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];\nreturn days.map((day, i) => ({ day, signups: 40 + i * 7 + (i % 3) * 5, revenue: 1200 + i * 180 }));" }),
  ], `<style>body { max-width: 980px; margin: 0 auto; padding: 28px 20px; font: 15px/1.5 system-ui, sans-serif; } .panel { border: 1px solid #e3e6ef; border-radius: 14px; padding: 16px; margin-top: 14px; }</style>
<h1>KPI dashboard</h1>
<div id="cards"></div>
<div class="panel"><h3>Sign-ups this week</h3><div id="chart"></div></div>
<div class="panel"><h3>Revenue</h3><div id="line"></div></div>
<script>
  async function load() {
    let rows;
    try { rows = await workline.run({}); } catch (e) { document.getElementById('cards').textContent = e.message; return; }
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    cards('#cards', [['Sign-ups', sum('signups')], ['Revenue', '$' + sum('revenue').toLocaleString()], ['Best day', rows.reduce((a, b) => (b.signups > a.signups ? b : a)).day]]);
    bars('#chart', rows, 'day', 'signups');
    line('#line', rows, 'day', 'revenue');
  }
  load(); setInterval(load, 60000);
</script>`) },
];

/* ---- A visual app (App view → Visual): components on pages, people sign in ---- */
const visualApp = (title, nodes, spec, access = 'public') => {
  const f = flowFile(title, nodes);
  f.view = 'app';
  const html = builderHtml(spec, { access });
  f.ui = { mode: 'visual', spec, access, allow: [], html, flows: [f.id], published: false, doc: appDoc(html, { workflows: [{ id: f.id, name: title }], title }) };
  return f;
};
const C = (id, type, name, x, y, w, h, props) => ({ id, type, name, x, y, w, h, props });
APPS.push({ k: 'a-orders', name: 'Order tracker (drag and drop)', note: 'A visual app: people sign in, see only their orders, search and open one; works on phones', make: () => visualApp('Order tracker', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.code', 'My orders', 340, { language: 'javascript', code: `// Swap for a database or sheet node, filtered by who's asking: {{ $json.user.email }}.
const who = items[0] && items[0].user ? items[0].user.email : 'you@example.com';
const all = [
  { id: 1041, item: 'Desk lamp', status: 'Delivered', total: 39, placed: '2026-09-28' },
  { id: 1057, item: 'Office chair', status: 'Shipped', total: 189, placed: '2026-10-06' },
  { id: 1063, item: 'Monitor arm', status: 'Processing', total: 74, placed: '2026-10-11' },
];
return all.map(o => ({ ...o, customer: who }));` }),
], {
  name: 'Order tracker', theme: { ...THEMES.light, primary: '#0e7490', radius: 14, font: 'system' }, nav: 'top',
  data: [{ id: 's1', name: 'orders', workflow: 'Order tracker', input: [], auto: true }],
  pages: [
    { id: 'home', name: 'My orders', nav: true, components: [
      C('c1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Hi {{ user ? user.name : "there" }}', size: 'lg', align: 'left' }),
      C('c2', 'text', 'text1', 0, 6, 12, 5, { text: 'Your orders, newest first. Tap one to see it.', align: 'left' }),
      C('c3', 'stat', 'stat1', 0, 12, 4, 12, { label: 'Orders', value: '{{ (data.orders || []).length }}', note: '', card: true }),
      C('c4', 'stat', 'stat2', 4, 12, 4, 12, { label: 'Spent', value: '{{ "$" + (data.orders || []).reduce((s, o) => s + o.total, 0) }}', note: '', card: true }),
      C('c5', 'stat', 'stat3', 8, 12, 4, 12, { label: 'On the way', value: '{{ (data.orders || []).filter(o => o.status !== "Delivered").length }}', note: '', card: true }),
      C('c6', 'table', 'table1', 0, 25, 12, 34, { title: '', rows: '{{ data.orders }}', columns: 'id, item, status, total, placed', search: true, card: true, steps: [{ kind: 'go', page: 'detail' }] }),
    ] },
    { id: 'detail', name: 'Order', nav: false, components: [
      C('d1', 'button', 'button1', 0, 0, 3, 6, { label: '← All orders', look: 'link', steps: [{ kind: 'go', page: 'home' }] }),
      C('d2', 'heading', 'heading1', 0, 7, 12, 6, { text: 'Order {{ vars.table1 ? vars.table1.id : "" }}', size: 'lg', align: 'left' }),
      C('d3', 'stat', 'stat1', 0, 14, 4, 12, { label: 'Item', value: '{{ vars.table1 && vars.table1.item }}', note: '', card: true }),
      C('d4', 'stat', 'stat2', 4, 14, 4, 12, { label: 'Status', value: '{{ vars.table1 && vars.table1.status }}', note: 'Placed {{ vars.table1 && vars.table1.placed }}', card: true }),
      C('d5', 'stat', 'stat3', 8, 14, 4, 12, { label: 'Total', value: '{{ vars.table1 && "$" + vars.table1.total }}', note: '', card: true }),
      C('d6', 'form', 'form1', 0, 27, 6, 34, { title: 'Need help with it?', fields: 'Message* (long)', button: 'Send', thanks: 'Thanks, we’ll get back to you by email.', card: true, steps: [{ kind: 'toast', text: 'Sent' }] }),
    ] },
  ],
}, 'signin') });

/* ---- Pages made of nodes (no code) ---- */
const PAGES = [
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
