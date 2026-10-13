import { dg } from './engines.js';
import { rid } from './utils.js';
import { newSheet } from './sheet.js';
import { appDoc } from './apphost.js';
import { secretPath } from './flows.js';
import { COMPONENTS, THEMES, builderHtml } from './appbuilder.js';

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
  // Each component starts from its defaults, so a template names only what it changes.
  for (const pg of spec.pages) pg.components = pg.components.map(c => ({ ...c, props: { ...JSON.parse(JSON.stringify(COMPONENTS[c.type].props)), ...c.props } }));
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

/* ---- Stylish visual apps, to show what the builder can do ---- */
const go = page => ({ kind: 'go', page }), set = (name, value) => ({ kind: 'set', name, value }), toast = text => ({ kind: 'toast', text });

// Sales: a dark dashboard with a side menu, a pipeline board, a calendar and a page for each deal.
APPS.push({ k: 'a-sales', name: 'Sales command center', note: 'Dark dashboard: KPIs, charts, a gauge, a pipeline board, a calendar and a page per deal', make: () => visualApp('Sales command center', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.code', 'Deals', 340, { language: 'javascript', code: `// Swap for your CRM (HubSpot, Pipedrive, a database or a sheet): one item per deal.
const owners = ['Ada', 'Grace', 'Linus', 'Margaret'], stages = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];
const regions = ['North', 'South', 'East', 'West'], months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
const companies = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark', 'Wayne', 'Wonka', 'Soylent', 'Cyberdyne', 'Tyrell', 'Pied Piper', 'Vandelay', 'Dunder', 'Oscorp', 'Gringotts'];
return companies.map((company, i) => ({
  id: 100 + i, company, owner: owners[i % 4], stage: stages[(i * 3) % 5], region: regions[i % 4], month: months[i % 6],
  value: 4000 + ((i * 7919) % 26000), close: '2026-10-' + String(2 + (i * 5) % 27).padStart(2, '0'),
}));` }),
], {
  name: 'Sales HQ', theme: { ...THEMES.midnight, radius: 16, font: 'system' }, nav: 'side',
  data: [{ id: 's1', name: 'deals', workflow: 'Sales command center', input: [], auto: true }],
  pages: [
    { id: 'overview', name: 'Overview', nav: true, components: [
      C('o1', 'heading', 'heading1', 0, 0, 8, 6, { text: 'Good {{ new Date().getHours() < 12 ? "morning" : "afternoon" }}{{ user ? ", " + user.name : "" }}', size: 'lg' }),
      C('o2', 'badge', 'badge1', 10, 1, 2, 5, { text: 'Live', tone: 'green' }),
      C('o3', 'text', 'text1', 0, 6, 12, 5, { text: 'Your pipeline at a glance. Click a deal for the details.' }),
      C('o4', 'stat', 'stat1', 0, 12, 3, 12, { label: 'Open pipeline', value: '{{ "$" + fmt((data.deals || []).filter(d => !["Won", "Lost"].includes(d.stage)).reduce((s, d) => s + d.value, 0)) }}', note: 'Lead → Proposal', card: true }),
      C('o5', 'stat', 'stat2', 3, 12, 3, 12, { label: 'Won', value: '{{ "$" + fmt((data.deals || []).filter(d => d.stage === "Won").reduce((s, d) => s + d.value, 0)) }}', note: 'This quarter', card: true }),
      C('o6', 'stat', 'stat3', 6, 12, 3, 12, { label: 'Deals', value: '{{ (data.deals || []).length }}', note: 'All stages', card: true }),
      C('o7', 'stat', 'stat4', 9, 12, 3, 12, { label: 'Average deal', value: '{{ "$" + fmt(Math.round((data.deals || []).reduce((s, d) => s + d.value, 0) / Math.max(1, (data.deals || []).length))) }}', note: 'Across regions', card: true }),
      C('o8', 'chart', 'chart1', 0, 25, 8, 34, { title: 'Pipeline by region', kind: 'bar', rows: '{{ Object.entries((data.deals || []).reduce((m, d) => (m[d.region] = (m[d.region] || 0) + d.value, m), {})).map(([name, value]) => ({ name, value })) }}', label: 'name', value: 'value', card: true }),
      C('o9', 'gauge', 'gauge1', 8, 25, 4, 34, { label: 'Win rate', value: '{{ Math.round((data.deals || []).filter(d => d.stage === "Won").length / Math.max(1, (data.deals || []).filter(d => ["Won", "Lost"].includes(d.stage)).length) * 100) }}', max: 100, unit: '%', card: true }),
      C('o10', 'chart', 'chart2', 0, 60, 7, 34, { title: 'Bookings by month', kind: 'line', rows: '{{ ["May", "Jun", "Jul", "Aug", "Sep", "Oct"].map(name => ({ name, value: (data.deals || []).filter(d => d.month === name).reduce((s, d) => s + d.value, 0) })) }}', label: 'name', value: 'value', card: true }),
      C('o11', 'items', 'items1', 7, 60, 5, 34, { title: 'Biggest deals', rows: '{{ [...(data.deals || [])].sort((a, b) => b.value - a.value).slice(0, 6) }}', text: '{{ item.company }}', note: '{{ "$" + fmt(item.value) }}', card: true, steps: [set('deal', '{{ item }}'), go('deal')] }),
      C('o12', 'table', 'table1', 0, 95, 12, 46, { title: 'All deals', rows: '{{ data.deals }}', columns: 'company, owner, stage, region, value, close', search: true, card: true, steps: [set('deal', '{{ item }}'), go('deal')] }),
    ] },
    { id: 'pipeline', name: 'Pipeline', nav: true, components: [
      C('p1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Pipeline' }),
      C('p2', 'text', 'text1', 0, 6, 12, 5, { text: 'Every deal by stage. Click one to open it.' }),
      C('p3', 'kanban', 'kanban1', 0, 12, 12, 64, { rows: '{{ data.deals }}', group: 'stage', columns: 'Lead, Qualified, Proposal, Won, Lost', title: '{{ item.company }}', subtitle: '{{ item.owner + " · $" + fmt(item.value) }}', steps: [set('deal', '{{ item }}'), go('deal')] }),
    ] },
    { id: 'calendar', name: 'Calendar', nav: true, components: [
      C('k1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Closing dates' }),
      C('k2', 'calendar', 'calendar1', 0, 7, 12, 64, { rows: '{{ data.deals }}', date: 'close', title: '{{ item.company + " $" + fmt(item.value) }}', card: true, steps: [set('deal', '{{ item.company ? item : vars.deal }}')] }),
    ] },
    { id: 'deal', name: 'Deal', nav: false, components: [
      C('d1', 'button', 'button1', 0, 0, 2, 6, { label: '← Back', look: 'link', steps: [go('overview')] }),
      C('d2', 'heading', 'heading1', 0, 7, 9, 7, { text: '{{ vars.deal ? vars.deal.company : "Pick a deal on the Overview" }}' }),
      C('d3', 'badge', 'badge1', 10, 8, 2, 5, { text: '{{ vars.deal && vars.deal.stage }}', tone: 'purple' }),
      C('d4', 'stepper', 'stepper1', 0, 15, 12, 10, { stages: 'Lead, Qualified, Proposal, Won', current: '{{ ["Lead", "Qualified", "Proposal", "Won"].indexOf(vars.deal && vars.deal.stage) + 1 }}' }),
      C('d5', 'details', 'details1', 0, 26, 7, 34, { title: 'Details', value: '{{ vars.deal }}', fields: 'company, owner, region, value, close', card: true }),
      C('d6', 'progress', 'progress1', 7, 26, 5, 9, { label: 'Chance to win', value: '{{ ({ Lead: 10, Qualified: 35, Proposal: 60, Won: 100, Lost: 0 })[vars.deal && vars.deal.stage] || 0 }}', max: 100, card: true }),
      C('d7', 'form', 'form1', 7, 36, 5, 24, { title: 'Add a note', fields: 'Note* (long)', button: 'Save note', thanks: 'Saved.', card: true, steps: [toast('Note saved')] }),
    ] },
  ],
}) });

// Travel: a warm, photo-led site to browse stays, filter them, and request a booking.
APPS.push({ k: 'a-stays', name: 'Stay finder', note: 'A travel site: photo hero, slideshow, filters (search, price slider, city tags), stays, a map and a booking form', make: () => visualApp('Stay finder', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.code', 'Stays', 340, { language: 'javascript', code: `// Swap for your listings (a sheet, Airtable or a database).
const stays = [
  ['Palm Cove Villa', 'Goa', 180, 4.8, 15.5527, 73.7517, 'A breezy villa a short walk from Anjuna beach, with a pool and hammocks.'],
  ['Haveli Sunrise', 'Jaipur', 120, 4.7, 26.9124, 75.7873, 'A restored haveli with painted ceilings and rooftop breakfasts.'],
  ['Cedar Ridge Cabin', 'Manali', 95, 4.9, 32.2396, 77.1887, 'A wooden cabin above the valley; a fireplace and mountain views.'],
  ['Backwater House', 'Kerala', 140, 4.6, 9.4981, 76.3388, 'A houseboat-side cottage on the backwaters of Alleppey.'],
  ['Lake Palace Suites', 'Udaipur', 260, 4.9, 24.5764, 73.6835, 'Suites on Lake Pichola with sunset terraces.'],
  ['Tea Estate Lodge', 'Darjeeling', 110, 4.5, 27.0410, 88.2663, 'Stay in a working tea estate; tastings every evening.'],
  ['Desert Camp', 'Jaisalmer', 85, 4.4, 26.9157, 70.9083, 'Luxury tents in the dunes; camel rides and starry skies.'],
  ['Cliffside Retreat', 'Varkala', 150, 4.7, 8.7379, 76.7163, 'Rooms on the red cliffs over the Arabian Sea.'],
];
return stays.map(([name, city, price, rating, lat, lon, about], i) => ({ id: 'stay' + (i + 1), name, city, price, rating, lat, lon, about, photo: 'https://picsum.photos/seed/stay' + (i + 1) + '/900/560' }));` }),
], {
  name: 'Stay finder', theme: { ...THEMES.sunset, radius: 18, font: 'rounded' }, nav: 'top',
  data: [{ id: 's1', name: 'stays', workflow: 'Stay finder', input: [], auto: true }],
  pages: [
    { id: 'home', name: 'Explore', nav: true, components: [
      C('h1', 'hero', 'hero1', 0, 0, 12, 40, { kicker: 'Summer escapes', title: 'Find a stay you’ll never forget', subtitle: 'Hand-picked villas, cabins and palaces across India. Book in a minute.', button: 'Browse stays', image: 'https://picsum.photos/seed/stayhero/1600/700', steps: [go('stays')] }),
      C('h2', 'stat', 'stat1', 0, 41, 4, 12, { label: 'Places to stay', value: '{{ (data.stays || []).length }}', card: true }),
      C('h3', 'stat', 'stat2', 4, 41, 4, 12, { label: 'Cities', value: '{{ new Set((data.stays || []).map(s => s.city)).size }}', card: true }),
      C('h4', 'stat', 'stat3', 8, 41, 4, 12, { label: 'Average rating', value: '{{ "★ " + ((data.stays || []).reduce((s, x) => s + x.rating, 0) / Math.max(1, (data.stays || []).length)).toFixed(1) }}', card: true }),
      C('h5', 'heading', 'heading1', 0, 55, 12, 6, { text: 'Guest favourites', size: 'md' }),
      C('h6', 'carousel', 'carousel1', 0, 62, 7, 40, { images: '{{ (data.stays || []).slice(0, 5).map(s => s.photo) }}', every: 4 }),
      C('h7', 'accordion', 'accordion1', 7, 62, 5, 40, { items: 'Can I cancel? | Free cancellation up to 48 hours before check-in.\nIs breakfast included? | At most stays, yes: look for **Breakfast** on the stay’s page.\nHow do I pay? | Pay at the property, by card or UPI.\nPets? | Many cabins and villas welcome them; ask us when you book.' }),
    ] },
    { id: 'stays', name: 'Stays', nav: true, components: [
      C('s1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Stays' }),
      C('s2', 'search', 'search1', 0, 7, 6, 6, { placeholder: 'Search by name or city' }),
      C('s3', 'slider', 'slider1', 7, 6, 5, 9, { label: 'Max price a night', min: 50, max: 300, step: 10, value: 300, unit: ' $' }),
      C('s4', 'multiselect', 'multiselect1', 0, 15, 12, 9, { label: 'Cities', options: '{{ [...new Set((data.stays || []).map(s => s.city))] }}' }),
      C('s5', 'list', 'list1', 0, 25, 12, 80, { rows: '{{ (data.stays || []).filter(s => s.price <= (vars.slider1 ?? 300) && (!vars.search1 || (s.name + " " + s.city).toLowerCase().includes(vars.search1.toLowerCase())) && (!(vars.multiselect1 || []).length || vars.multiselect1.includes(s.city))) }}', title: '{{ item.name }}', subtitle: '{{ item.city + " · $" + item.price + " a night · ★ " + item.rating }}', image: '{{ item.photo }}', steps: [set('stay', '{{ item }}'), go('stay')] }),
    ] },
    { id: 'stay', name: 'Stay', nav: false, components: [
      C('t1', 'button', 'button1', 0, 0, 2, 6, { label: '← All stays', look: 'link', steps: [go('stays')] }),
      C('t2', 'carousel', 'carousel1', 0, 7, 7, 44, { images: '{{ vars.stay ? [vars.stay.photo, "https://picsum.photos/seed/" + vars.stay.id + "b/900/560", "https://picsum.photos/seed/" + vars.stay.id + "c/900/560"] : [] }}', every: 0 }),
      C('t3', 'heading', 'heading1', 7, 8, 5, 7, { text: '{{ vars.stay ? vars.stay.name : "Pick a stay" }}', size: 'md' }),
      C('t4', 'badge', 'badge1', 7, 16, 2, 5, { text: '{{ vars.stay && vars.stay.city }}', tone: 'amber' }),
      C('t5', 'badge', 'badge2', 9, 16, 2, 5, { text: '{{ vars.stay && "★ " + vars.stay.rating }}', tone: 'green' }),
      C('t6', 'text', 'text1', 7, 21, 5, 16, { text: '{{ vars.stay ? vars.stay.about : "" }}\n\n**{{ vars.stay ? "$" + vars.stay.price : "" }}** a night · Breakfast · Free Wi-Fi' }),
      C('t7', 'rating', 'rating1', 7, 38, 5, 9, { label: 'Been here? Rate it', max: 5, steps: [toast('Thanks for rating!')] }),
      C('t8', 'map', 'map1', 0, 52, 6, 40, { lat: '{{ vars.stay && vars.stay.lat }}', lon: '{{ vars.stay && vars.stay.lon }}', zoom: 12 }),
      C('t9', 'form', 'form1', 6, 52, 6, 52, { title: 'Request a booking', fields: 'Name*\nEmail* (email)\nCheck-in* (date)\nNights* (number)\nGuests (number)', button: 'Request booking', thanks: 'Request sent: we’ll confirm by email within a day.', card: true, steps: [toast('Request sent!')] }),
    ] },
  ],
}) });

// Fitness: a fresh, green tracker with gauges, a habit panel, a countdown and a training plan.
APPS.push({ k: 'a-fitness', name: 'Fitness journal', note: 'A bright tracker: gradient hero, three gauges, a steps chart, a habits panel, countdown, training plan and timeline', make: () => visualApp('Fitness journal', [
  node('trigger.manual', 'Run by hand', 80),
  node('core.code', 'My days', 340, { language: 'javascript', code: `// Swap for your watch's export, Google Fit, Strava or a sheet: one item per day.
const kinds = ['Run', 'Yoga', 'Cycle', 'Rest', 'Swim', 'Strength', 'Walk'];
return Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.now() - (13 - i) * 864e5);
  return { day: d.toLocaleDateString('en', { weekday: 'short', day: 'numeric' }), date: d.toISOString().slice(0, 10), steps: 5200 + ((i * 2731) % 7400), minutes: kinds[i % 7] === 'Rest' ? 0 : 20 + ((i * 17) % 50), sleep: +(6 + ((i * 7) % 25) / 10).toFixed(1), workout: kinds[i % 7] };
});` }),
], {
  name: 'Fitness journal', theme: { ...THEMES.forest, radius: 20, font: 'rounded' }, nav: 'top',
  data: [{ id: 's1', name: 'days', workflow: 'Fitness journal', input: [], auto: true }],
  pages: [
    { id: 'today', name: 'Today', nav: true, components: [
      C('f1', 'hero', 'hero1', 0, 0, 12, 26, { kicker: 'Today', title: 'Keep moving{{ user ? ", " + user.name : "" }}!', subtitle: '{{ fmt(((data.days || []).at(-1) || {}).steps || 0) }} steps so far. Every one counts.', button: '' }),
      C('f2', 'gauge', 'gauge1', 0, 27, 4, 22, { label: 'Steps (goal 10,000)', value: '{{ ((data.days || []).at(-1) || {}).steps || 0 }}', max: 10000, unit: '', card: true }),
      C('f3', 'gauge', 'gauge2', 4, 27, 4, 22, { label: 'Active minutes (goal 60)', value: '{{ ((data.days || []).at(-1) || {}).minutes || 0 }}', max: 60, unit: ' min', card: true }),
      C('f4', 'gauge', 'gauge3', 8, 27, 4, 22, { label: 'Sleep (goal 8 h)', value: '{{ ((data.days || []).at(-1) || {}).sleep || 0 }}', max: 8, unit: ' h', card: true }),
      C('f5', 'chart', 'chart1', 0, 50, 8, 34, { title: 'Steps, last two weeks', kind: 'line', rows: '{{ data.days }}', label: 'day', value: 'steps', card: true }),
      C('f6', 'box', 'box1', 8, 50, 4, 34, { title: 'Today’s habits' }),
      C('f7', 'checkbox', 'checkbox1', 8, 56, 4, 5, { label: '💧 8 glasses of water' }),
      C('f8', 'checkbox', 'checkbox2', 8, 61, 4, 5, { label: '🥗 Vegetables with lunch' }),
      C('f9', 'checkbox', 'checkbox3', 8, 66, 4, 5, { label: '📵 No phone after 10pm' }),
      C('f10', 'rating', 'rating1', 8, 72, 4, 9, { label: 'How do you feel?', max: 5 }),
      C('f11', 'countdown', 'countdown1', 0, 85, 5, 13, { label: '🏁 Race day in', to: '2026-12-14T07:00', done: 'Race day! Go get it.', card: true }),
      C('f12', 'stepper', 'stepper1', 5, 85, 7, 13, { stages: 'Base, Build, Peak, Taper, Race', current: '{{ 2 }}', card: true }),
      C('f13', 'timeline', 'timeline1', 0, 99, 12, 40, { rows: '{{ (data.days || []).filter(d => d.minutes).slice(-5).reverse() }}', time: '{{ item.day }}', title: '{{ item.workout + " · " + item.minutes + " min" }}', text: '{{ fmt(item.steps) + " steps · slept " + item.sleep + " h" }}', card: true }),
    ] },
    { id: 'history', name: 'History', nav: true, components: [
      C('g1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'History' }),
      C('g2', 'chart', 'chart1', 0, 7, 6, 34, { title: 'Active minutes', kind: 'bar', rows: '{{ data.days }}', label: 'day', value: 'minutes', card: true }),
      C('g3', 'chart', 'chart2', 6, 7, 6, 34, { title: 'Workouts', kind: 'pie', rows: '{{ Object.entries((data.days || []).reduce((m, d) => (m[d.workout] = (m[d.workout] || 0) + 1, m), {})).map(([name, value]) => ({ name, value })) }}', label: 'name', value: 'value', card: true }),
      C('g4', 'table', 'table1', 0, 42, 12, 44, { rows: '{{ [...(data.days || [])].reverse() }}', columns: 'day, workout, minutes, steps, sleep', search: false, card: true }),
    ] },
  ],
}) });

// Support: a help centre with an AI chat (Claude, through a workflow), FAQs, guides in tabs and a contact form.
APPS.push({ k: 'a-help', name: 'AI help center', note: 'A help centre: hero, AI chat answered by Claude, status alert, FAQ, guides in tabs and a contact form', make: () => visualApp('AI help center', [
  node('trigger.manual', 'Run by hand', 80),
  node('ai.claude', 'Answer', 340, { prompt: 'Earlier in the chat:\n{{ ($json.history || []).map(m => m.from + ": " + m.text).join("\\n") }}\n\nThe customer asks: {{ $json.message }}', system: 'You are the friendly support assistant for Acme, a project-management app. Answer in 2–4 short sentences. If you don’t know, say so and suggest the contact form.' }),
], {
  name: 'Acme Help', theme: { ...THEMES.rose, primary: '#7c3aed', bg: '#faf7ff', radius: 16, font: 'system' }, nav: 'top',
  data: [],
  pages: [
    { id: 'help', name: 'Help', nav: true, components: [
      C('a1', 'hero', 'hero1', 0, 0, 12, 30, { kicker: 'Help center', title: 'How can we help?', subtitle: 'Ask our AI assistant anything, browse the guides, or write to a person.', button: '', align: 'center' }),
      C('a2', 'alert', 'alert1', 0, 31, 12, 9, { tone: 'success', title: 'All systems normal', text: 'Everything is running smoothly. Last checked a minute ago.' }),
      C('a3', 'chat', 'chat1', 0, 41, 7, 56, { title: '💬 Ask the assistant', workflow: 'AI help center', field: 'text', greeting: 'Hi! I’m the Acme assistant. Ask me about projects, billing or your account.', placeholder: 'How do I invite my team?', card: true }),
      C('a4', 'heading', 'heading1', 7, 41, 5, 6, { text: 'Popular questions', size: 'sm' }),
      C('a5', 'accordion', 'accordion1', 7, 47, 5, 50, { items: 'How do I invite my team? | Open **Settings → Members** and press **Invite**.\nCan I change my plan? | Yes, any time, under **Billing**. Changes apply right away.\nWhere are my invoices? | **Billing → Invoices**: each one downloads as a PDF.\nHow do I export a project? | **Project → ⋯ → Export**: CSV or JSON.\nIs my data safe? | Encrypted at rest and in transit, and backed up daily.' }),
    ] },
    { id: 'guides', name: 'Guides', nav: true, components: [
      C('b1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Guides' }),
      C('b2', 'tabs', 'tabs1', 0, 7, 8, 40, { tabs: 'Getting started | 1. Create a project.\n2. Add tasks and due dates.\n3. Invite your team.\nBilling | Plans are billed monthly or yearly. **Yearly saves 20%.**\nIntegrations | Connect **Slack**, **Google Drive** and **GitHub** under Settings → Integrations.\nSecurity | Turn on two-step sign-in under Account → Security.', card: true }),
      C('b3', 'video', 'video1', 8, 7, 4, 26, {}),
      C('b4', 'text', 'text1', 8, 34, 4, 12, { text: '**Watch:** a 10-minute tour of Acme.' }),
    ] },
    { id: 'contact', name: 'Contact', nav: true, components: [
      C('c1', 'heading', 'heading1', 0, 0, 12, 6, { text: 'Talk to a person' }),
      C('c2', 'text', 'text1', 0, 6, 12, 5, { text: 'We reply within one working day.' }),
      C('c3', 'form', 'form1', 0, 12, 7, 48, { title: '', fields: 'Name*\nEmail* (email)\nTopic\nMessage* (long)', button: 'Send', thanks: 'Thanks! We’ll get back to you by email.', card: true, steps: [toast('Message sent')] }),
      C('c4', 'avatar', 'avatar1', 7, 12, 5, 8, { image: 'https://i.pravatar.cc/120?img=47', name: 'Priya, Support lead', subtitle: 'Usually replies in a few hours' }),
      C('c5', 'link', 'link1', 7, 22, 5, 4, { text: 'Status page →', url: 'https://example.com/status' }),
      C('c6', 'qr', 'qr1', 7, 28, 3, 24, { text: 'https://example.com/help', caption: 'Help on your phone' }),
    ] },
  ],
}) });

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
