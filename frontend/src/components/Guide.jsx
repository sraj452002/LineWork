import { useEffect, useMemo, useRef, useState } from 'react';
import { dg, prep, svgDoc } from '../lib/engines.js';
import { HELP } from '../lib/help.js';
import { GROUPS, NODES } from '../lib/flows.js';
import { NODE_GUIDE } from '../lib/flowguide.js';
import { NodeCard } from './NodeGuide.jsx';
import { Brand, useUI } from './ui.jsx';

/* ---- examples, kept small so each one teaches one idea ---- */
const EX = {
  first: `users {
  id uuid pk
  email text unique
  name text
}`,
  label: `users [User accounts] {
  id uuid pk
  email text unique
}`,
  rels: `authors {
  id uuid pk
  name text
}
books {
  id uuid pk
  author_id uuid fk
  title text
}
books.author_id > authors.id : writes`,
  kinds: `users {
  id uuid pk
}
profiles {
  user_id uuid pk,fk
}
orders {
  id uuid pk
  user_id uuid fk
}
products {
  id uuid pk
}
users - profiles
users < orders
orders <> products`,
  full: `title: Online store
# People
customers {
  id uuid pk
  email text unique
  name text
}
addresses {
  id uuid pk
  customer_id uuid fk
  city text
}
# Buying
orders {
  id uuid pk
  customer_id uuid fk
  placed_at timestamp
  status text
}
order_items {
  order_id uuid pk,fk
  product_id uuid pk,fk
  qty int
}
products {
  id uuid pk
  sku text unique
  price numeric
}

addresses.customer_id > customers.id : lives at
orders.customer_id > customers.id : places
order_items.order_id > orders.id : contains
order_items.product_id > products.id`,
  self: `employees {
  id uuid pk
  manager_id uuid fk
  name text
}
employees.manager_id > employees.id : reports to`,
};

function Example({ code, title, onTry, theme }) {
  const svg = useMemo(() => {
    const doc = svgDoc(prep(dg('erd', 'Example', code)), { margin: 20 });
    return doc ? doc.text : '';
  }, [code, theme]);
  return (
    <figure className="gx">
      <pre className="gx-code">{code}</pre>
      <div className="gx-pic" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>
        <button className="btn" onClick={() => onTry(code, title)}>Try it in a new file</button>
      </figcaption>
    </figure>
  );
}

const K = ({ children }) => <kbd className="gk">{children}</kbd>;

function appGuide() {
  return [
    { id: 'basics', title: 'The basics', body: <>
      <p>Workline is for technical design work. Every <b>file</b> holds two things side by side:</p>
      <ul>
        <li>A <b>design doc</b>, written like in Word: pages, styles, tables, pictures, comments.</li>
        <li>One or more <b>diagrams</b>, each on its own tab: Architecture, Flowchart, Sequence or Database schema.</li>
      </ul>
      <p>You can make diagrams three ways, and mix them freely: write a few lines of <b>diagram code</b>, <b>ask AI</b> to draw them, or <b>draw by hand</b> on the canvas.</p>
      <p>The <b>theme</b> button (a sun or moon, on the home page and at the top of every file) switches between Light, Dark and your computer's setting. Workline remembers the choice on this device.</p>
    </> },
    { id: 'home', title: 'The home page', body: <>
      <ul>
        <li><b>Create a Blank File</b> opens an empty doc and canvas.</li>
        <li><b>Generate an AI Diagram</b> asks what you're designing, then writes a short doc and draws 1 to 3 diagrams. Click the card again while it's working to stop it.</li>
        <li><b>Write a Design Doc</b> starts a doc with the usual sections (Context, Goals, Proposal…) already laid out.</li>
        <li><b>Start from a Template</b> gives ready-made examples: cloud architecture, flowchart, sequence diagram and database schema. <b>Templates</b> in the sidebar has <a href="#" data-guide="readymade">templates for every tool</a>.</li>
        <li><b>New File</b> at the bottom of the sidebar has the same templates.</li>
      </ul>
      <h4>Finding and organising files</h4>
      <ul>
        <li><b>All / Recents</b>: Recents shows files edited in the last 7 days.</li>
        <li><b>Search</b> looks in file names and doc text.</li>
        <li>Click a <b>column heading</b> (Name, Created, Edited…) to sort. Click it again to reverse the order.</li>
        <li>Hover a row and click <b>⋯</b> to rename, duplicate, move to a folder, archive or delete it.</li>
        <li><b>Folders</b>: create one with the folder + button in the sidebar. New files you create while a folder is open go into it.</li>
        <li><b>Archive</b> hides a file from All Files without deleting it. Restore it from the Archive's ⋯ menu.</li>
      </ul>
      <h4>Shortcuts on the home page</h4>
      <ul className="gkeys">
        <li><K>/</K> Search</li><li><K>Alt N</K> New file</li><li><K>A</K> All Files</li><li><K>E</K> Archive</li>
      </ul>
      <p><b>Tools</b> in the sidebar (or <K>T</K>) lists every tool in one place, grouped by what you're making (<b>Diagrams</b>, <b>Databases</b>, <b>Docs &amp; spreadsheets</b>, <b>Code</b>; the chips at the top show one group), and each card says which view it opens in: each diagram type, a whiteboard, AI diagrams, design docs, spreadsheets, opening an Excel or CSV file, opening a .sql file as a database diagram, a schema from pasted SQL, the code editor, the Terminal, Python, a Node.js server and the code visualizer. Pick one and it starts a new file, open in that tool. The search box finds a tool by name.</p>
    </> },
    { id: 'editor', title: 'The editor', body: <>
      <p>Opening a file shows the editor. Along the top:</p>
      <ul>
        <li><b>Files</b> takes you back home.</li>
        <li>The <b>file name</b> is editable in place.</li>
        <li><b>Saved / Saving</b> shows that changes are stored. There's no save button.</li>
        <li>The <b>View</b> menu at the top (it shows the view you're in, like <b>Canvas</b>) switches between <b>Canvas</b> (diagrams), <b>Doc</b>, <b>Doc + Canvas</b> side by side, <b>Sheet</b> (spreadsheets), <b>Database</b>, <b>Code</b>, <b>App</b> (your own page on your workflows: see <a href="#" data-guide="apps">the Custom apps guide</a>) and <b>Workflow</b>. On a phone there's no side-by-side view.</li>
        <li><b>Export</b> and <b>⋯</b> (rename, duplicate, delete, this guide).</li>
      </ul>
      <h4>Diagram tabs</h4>
      <p>Above the canvas, each diagram has a tab. <b>+ Diagram</b> adds one of any type. On the active tab, <b>⋯</b> renames, duplicates or deletes it.</p>
    </> },
    { id: 'code', title: 'Diagrams as code', body: <>
      <p>Click <b>Code Editor</b> above the diagram (or <b>Code</b> at the top left of the canvas) to open the code editor on the right. It takes the place of AI Chat while it's open. The diagram redraws as you type, and lines it can't understand turn red in the line numbers and are listed below the code. In the footer, <b>&lt;?&gt;</b> is a quick syntax reminder, the symbols insert connections at the cursor, and the download button saves the code.</p>
      <p>Every type starts with an optional <code>title: …</code> line, and <code># text</code> is a comment.</p>
      <h4>Architecture</h4>
      <pre className="gpre">{HELP.graph}</pre>
      <h4>Flowchart</h4>
      <pre className="gpre">{HELP.flowchart}</pre>
      <h4>Sequence</h4>
      <pre className="gpre">{HELP.sequence}</pre>
      <h4>Database schema</h4>
      <p>This one has <a href="#" data-guide="erd">its own full guide</a>.</p>
      <h4>From drawing to code</h4>
      <p>It works the other way too. Draw boxes (first line = name, second line = detail), diagram icons and arrows on the canvas, select them and choose <b>⋯ → Convert to code</b>, then pick the diagram type. Frames around boxes become groups, cylinders become databases, diamonds become decisions, and arrow labels are kept. In a sequence diagram, boxes become participants (left to right) and arrows become messages (top to bottom); dashed arrows are replies.</p>
      <p>If the diagram already has code, the drawings are added to it instead. The code editor also shows a <b>Convert to code</b> button whenever there are drawings that aren't in the code yet.</p>
      <h4>Layout buttons</h4>
      <ul>
        <li><b>Horizontal / Vertical</b> flips the direction (architecture and flowchart).</li>
        <li><b>Tidy layout</b> puts back the automatic layout after you've dragged boxes around.</li>
        <li><b>Color / Mono</b> switches the colour style.</li>
      </ul>
    </> },
    { id: 'draw', title: 'Drawing on the canvas', body: <>
      <p>The toolbar on the left of the canvas has drawing tools. Each one has a single-key shortcut:</p>
      <ul className="gkeys">
        <li><K>V</K> Select</li><li><K>H</K> Hand (pan)</li><li><K>R</K> Rectangle</li><li><K>O</K> Ellipse</li>
        <li><K>A</K> Arrow</li><li><K>L</K> Line</li><li><K>D</K> Draw</li><li><K>T</K> Text</li>
        <li><K>I</K> Icon</li><li><K>F</K> Frame</li><li><K>C</K> Comment</li>
      </ul>
      <ul>
        <li>Drag an <b>arrow</b> from one box to another and it stays attached when they move. Or point at a figure and drag from the dot on its right (its output) to another figure: the wire runs into the dot on its left (its input).</li>
        <li>A <b>code block</b> runs its JavaScript with <b>▶ Run</b>. A <b>dashboard block</b> shows live cards, charts and tables from HTML and JavaScript; its <code>data</code> comes from code blocks wired into it, or from this file's workflow (<b>↻ Refresh</b>).</li>
        <li><b>+</b> at the top of the toolbar (or <K>/</K>) opens <b>Insert</b>: shapes, 2,000+ icons (general icons, tech logos and cloud provider logos, all searchable), phone/tablet/desktop/browser frames, figures, code blocks, dashboard blocks, images and the diagram catalogue.</li>
        <li>Select something to get a toolbar at the bottom. For shapes: <b>Shape</b> swaps between 11 shapes (rectangle, pill, star and so on); <b>Fill and style</b> sets the colour (or a custom one), a tinted, solid or no fill, and a plain, shadow or watercolor look; <b>Stroke</b> sets dashed, the border colour and thickness (S, M, L, XL). For lines: colour, curved/elbow/straight, thickness and arrowheads. <b>⋯</b> copies as PNG or SVG, copies and pastes styles, exports the selection, wraps it in a figure and changes the stacking order.</li>
        <li><b>Group</b> several objects (<K>Ctrl G</K>, or <b>Group</b> in the <b>⋯</b> menu) so they select and move together. Click a group again to pick one object inside it; <K>Ctrl Shift G</K> ungroups.</li>
        <li><b>Text alignment and indent</b> on the toolbar (for shapes, sticky notes and text) aligns text left, center or right, and top, middle or bottom, and indents it a step at a time.</li>
        <li>To edit a shape's text, select it and press <K>Enter</K>, or choose <b>Edit text</b> from the <b>⋯</b> menu on the toolbar. While typing, <K>Enter</K> starts a new line; <K>Esc</K>, <K>Ctrl Enter</K> or a click elsewhere finishes.</li>
      </ul>
      <h4>Moving around</h4>
      <ul className="gkeys">
        <li><K>Space + drag</K> Pan</li><li><K>+</K> <K>−</K> Zoom</li><li><K>Shift 1</K> Fit</li><li><K>Shift 0</K> 100%</li>
        <li><K>Ctrl Z</K> Undo</li><li><K>Ctrl Y</K> Redo</li><li><K>Ctrl A</K> Select all</li><li><K>Ctrl D</K> Duplicate</li>
        <li><K>Ctrl G</K> Group</li><li><K>Ctrl Shift G</K> Ungroup</li>
      </ul>
      <p>Press <K>?</K> on the canvas any time for the full shortcut list.</p>
    </> },
    { id: 'code-editor', title: 'Code editor', body: <>
      <ul>
        <li><b>Code</b>, in the <b>View</b> menu at the top, opens an editor like VS Code for code, configs and queries that go with the design. It's the same editor VS Code uses.</li>
        <li>The <b>Explorer</b> on the left holds files and folders: create them with its buttons, or open files from your computer. Right-click, or use <b>⋯</b>, to rename, delete or download. Use slashes in a name to make folders, like <code>src/app.ts</code>.</li>
        <li>Files open in tabs. You get syntax highlighting for 80+ languages, IntelliSense and error checking for JavaScript, TypeScript, JSON, CSS and HTML, find and replace (<K>Ctrl F</K> <K>Ctrl H</K>), multiple cursors (<K>Alt</K> + click) and the command palette (<K>F1</K>).</li>
        <li><K>Ctrl P</K> goes to a file by name and <K>Ctrl B</K> shows or hides the Explorer. Changes save on their own as you type. Click the language in the status bar to change it.</li>
        <li>Code is saved with the file, and <b>Export → Doc as Markdown</b> includes it.</li>
        <li><b>Run</b> (or <K>F5</K>) runs the open file: JavaScript with Node.js, TypeScript with tsx, Python, or an HTML page in a preview. Its menu (<b>▾</b>) also runs <b>npm install</b> and the scripts in <b>package.json</b>. Output appears in the panel below; <K>Ctrl `</K> shows or hides it.</li>
        <li><b>Terminal</b> is a shell with <code>node</code>, <code>npm</code>, <code>npx</code>, <code>yarn</code> and <code>pnpm</code>, so you can install any npm package or start a dev server (<b>Preview</b> shows it). It also has <code>grep</code>, <code>find</code>, <code>touch</code>, <code>head</code>, <code>tail</code>, <code>wc</code>, <code>sort</code>, <code>tree</code>, <code>diff</code>, <code>sed</code>, <code>curl</code>, <code>wget</code>, <code>git</code>, <code>python</code> and <code>pip</code>; type <code>help</code> for the full list.</li>
        <li>The Terminal and the editor work together: files and folders you make in either show up in the other, <code>code file.js</code> opens a file in the editor, and <b>Open in Terminal</b> (on a folder's <b>⋯</b> menu) goes to that folder.</li>
        <li><code>git</code> keeps history in this browser tab. To push or pull, set a token first: <code>export GITHUB_TOKEN=…</code>.</li>
        <li><b>Python</b> is a Python prompt: type Python, <code>pip install</code> a package, or <code>python main.py</code>. <K>Ctrl C</K> stops a running program.</li>
        <li>Everything runs in your browser, so it needs Chrome, Edge or Firefox on a computer. Files programs create (like <code>package.json</code> or <code>package-lock.json</code>) appear in the Explorer; installed packages (<code>node_modules</code>) don't, and are installed again after the page reloads.</li>
      </ul>
    </> },
    { id: 'database', title: 'Live databases', body: <>
      <p>The <b>Database</b> view (in the <b>View</b> menu, or <b>Tools → Connect to a database</b>) connects to a real database so you can see its schema and data as they are right now.</p>
      <ul>
        <li><b>PostgreSQL</b> (also Supabase, Neon, RDS, CockroachDB), <b>MySQL / MariaDB</b> (also PlanetScale), <b>SQL Server</b> (also Azure SQL) and <b>MongoDB</b> (also Atlas): paste the connection string, or fill in the host, database and user. <b>Test</b> checks it before saving.</li>
        <li><b>SQLite files</b> open right in your browser; nothing is uploaded. After changing data, <b>⋯ → Download .sqlite file</b> saves it.</li>
        <li><b>Schema</b> lists every table with its columns, keys and links. <b>Draw on canvas</b> turns it into a database schema diagram; draw again, or use the diagram's <b>⋯ → Refresh from the database</b>, after the database changes.</li>
        <li><b>Data</b> shows a table's rows: click a column to sort, add filters, page through. Double-click a cell to change it, <b>Add row</b> to insert, the bin to delete (tables need a primary key for this).</li>
        <li><b>Query</b> runs SQL (or MongoDB commands like <code>db.users.find({"{"} age: {"{"} $gt: 30 {"}"} {"}"})</code>) with <K>Ctrl Enter</K>. Results can go to a CSV or straight into a sheet. Statements that drop tables or change every row ask first.</li>
        <li>Tick <b>Read-only</b> on a connection to make sure nothing can change: PostgreSQL runs everything in a read-only transaction, and the others only allow reading statements.</li>
        <li>Connections are saved in this browser only, never inside files (which can be shared). Passwords are kept only if you tick <b>Remember the password</b>.</li>
        <li>Connections go through Workline's server, so you need to be signed in, and the database must be reachable from the internet. Databases on your own computer or office network are refused; to use one, run the Workline server inside that network with <code>DB_ALLOW_PRIVATE=1</code>. On the hosted site each request has about 9 seconds.</li>
      </ul>
    </> },
    { id: 'sheets', title: 'Spreadsheets', body: <>
      <p>The <b>Sheet</b> view works like Excel: a ribbon (<b>File</b>, <b>Home</b>, <b>Insert</b>, <b>Formulas</b>, <b>Data</b>, <b>View</b>), the name box and formula bar, and sheets as tabs along the bottom. Use it for costs, capacity estimates, schedules and test data.</p>
      <ul>
        <li>Click a cell and type to replace it, or double-click (or <K>F2</K>) to change it. <K>Enter</K> and <K>Tab</K> move on; arrow keys move around, <K>Ctrl</K> + arrow jumps to the edge of the data, and <K>Shift</K> (or a drag) selects a block. Type an address like <code>B2:D9</code> in the name box to go there.</li>
        <li>Start with <code>=</code> for a formula. Over a hundred of Excel's functions work: <code>SUM</code>, <code>IF</code>, <code>IFS</code>, <code>XLOOKUP</code>, <code>VLOOKUP</code>, <code>INDEX</code>/<code>MATCH</code>, <code>SUMIFS</code>, <code>COUNTIFS</code>, <code>TEXT</code>, <code>TEXTJOIN</code>, dates (<code>TODAY</code>, <code>EDATE</code>, <code>NETWORKDAYS</code>…), <code>PMT</code> and more; <b>Formulas</b> lists them by group. While writing one, click cells to put their addresses in. <code>Sheet2!A1</code> reads another sheet; <code>$A$1</code> stays fixed when copied.</li>
        <li>Typed dates, times, percents and amounts (<code>2026-03-15</code>, <code>12.5%</code>, <code>$1,200</code>) are kept as numbers with a matching format. <b>Home</b> has fonts, colours, fills, borders, alignment, wrap, merge, number formats and decimals; the Format Painter copies formats.</li>
        <li>Drag the small square at the corner of the selection (the fill handle) to continue a series (1, 2, 3…, Mon, Tue…, Jan, Feb…, dates) or copy formulas; double-click it to fill down beside your data. <K>Ctrl D</K> / <K>Ctrl R</K> fill down and right; <K>Alt =</K> is AutoSum.</li>
        <li><K>Ctrl C</K> / <K>Ctrl V</K> copy and paste, also to and from Excel and Google Sheets. Right-click to insert or delete rows and columns (formulas follow), sort, filter or add a chart. <K>Ctrl Z</K> undoes.</li>
        <li><b>Data → Filter</b> (<K>Ctrl Shift L</K>) puts a menu on each header to sort and pick which values show. <K>Ctrl F</K> / <K>Ctrl H</K> find and replace. <b>View</b> freezes panes, hides gridlines, shows formulas and zooms.</li>
        <li><b>Insert</b> adds a column, bar, line, area, pie, doughnut or scatter chart of the table around the selected cell. Drag it to move it, its corner to resize it; its bar changes the type, title and cells.</li>
        <li><b>File → Open</b> opens <b>.xlsx</b> and CSV files; <b>Download .xlsx</b> saves the whole workbook for Excel, with formulas, formats, widths, merged cells and frozen panes (charts stay in Workline). Selecting cells shows their average, count and sum in the status bar.</li>
        <li><b>Show on canvas</b> (under <b>File</b> or <b>Insert</b>, or <b>Insert → Spreadsheet</b> on the canvas) puts the sheet on the diagram as a table that stays up to date. Double-click it to open the sheet.</li>
      </ul>
    </> },
    { id: 'visualize', title: 'Visualizing code', body: <>
      <p>The <b>Visualize</b> button (next to <b>Run</b>) opens a pane beside the editor that draws your Python, JavaScript and TypeScript code.</p>
      <ul>
        <li><b>Structure → Flowchart</b> charts one function: its steps, decisions (yes/no), loops (repeat/done), returns and errors. It follows your cursor; pick another function from the list to jump to it. <b>(whole file)</b> charts the top-level code.</li>
        <li><b>Structure → Classes</b> shows every class in the project with its fields and methods, and which class extends which.</li>
        <li><b>Structure → Imports</b> shows how the files import each other, grouped by folder, with outside packages on the side.</li>
        <li><b>Open on canvas</b> adds the diagram to this file as a canvas tab, where you can edit, restyle and export it like any other.</li>
        <li><b>Step through</b> runs the open file and records it, line by line. Then move with <b>◀ ▶</b>, the slider, or the arrow keys: the editor highlights the line, and the pane shows the call stack, the variables at that moment, and the output so far. Click a function on the stack to see its variables.</li>
        <li>A recording stops after 2,000 steps, so a loop that never ends can't hang the page. JavaScript recordings run on their own and can't use npm packages or <code>node:</code> modules; Python recordings use the same Python as the <b>Run</b> button.</li>
      </ul>
    </> },
    { id: 'ai', title: 'Working with AI', body: <>
      <ul>
        <li><b>AI Chat</b> opens on the right of the canvas from <b>AI Chat</b> in the top bar, the sparkle button on the toolbar, or <K>Ctrl J</K>. <K>Esc</K> closes it.</li>
        <li><b>Start something new:</b> pick Architecture, Flow Chart, Entity Relationship, Sequence, BPMN or Document, then describe it. If the current diagram already has content, the new one opens in its own tab.</li>
        <li><b>Change what's there:</b> just type, for example “add a Redis cache in front of the database”. The chat remembers what you said earlier.</li>
        <li><b>Bring your own:</b> paste code or SQL, upload a file (SQL, Terraform, YAML, JSON, code), or draw from the design doc. Press <K>/</K> in the chat box for these options.</li>
        <li><b>+</b> starts a new chat and the clock button reopens earlier ones. Chats are saved with the file.</li>
        <li><b>Change one part:</b> click a box or table first. A chip shows <i>Editing …</i>, and your next request applies to that item.</li>
        <li><b>In the doc:</b> <b>Ask AI</b> can draft the doc from your diagrams, continue writing, tighten the wording, or make any change you describe.</li>
        <li>You can paste Terraform, SQL or code into any AI box. It will turn it into a diagram.</li>
      </ul>
      <p className="gnote">If AI isn't set up for this site, you'll see “AI is off”. Everything else still works.</p>
    </> },
    { id: 'ai-everywhere', title: 'AI in every view', body: <>
      <p><b>AI Chat</b> in the top bar opens an AI panel next to whatever you’re working on. It sees what’s on screen, answers questions, and when it proposes a change, a button makes it (nothing changes until you press it):</p>
      <ul>
        <li><b>Sheet</b>: formulas for the selected cell, totals, filling in or cleaning up data, what the numbers say. Ctrl Z undoes it.</li>
        <li><b>Database</b>: queries from a description, put in the Query tab for you to check and run; the schema explained.</li>
        <li><b>Code</b>: explain, fix, refactor or test the open file, or write a new one. Ctrl Z undoes it.</li>
        <li><b>Workflow</b>: describe an automation and it adds the nodes; or it writes a Code node’s code, or explains why a run failed.</li>
        <li><b>App</b>: builds or restyles the page.</li>
      </ul>
      <p>On the canvas the same button opens the diagram chat; the doc has <b>Ask AI</b> in its ribbon.</p>
    </> },
    { id: 'doc', title: 'Writing the doc', body: <>
      <p>The doc works like Microsoft Word: white pages with margins, and a <b>ribbon</b> on top.</p>
      <ul>
        <li><b>Home</b>: undo, the format painter, fonts and sizes, bold / italic / underline, colour and highlight, bullets, numbering and checklists, indent (<K>Tab</K>), alignment, line spacing, and styles (Heading 1–4, Quote, Code).</li>
        <li><b>Insert</b>: page breaks (<K>Ctrl</K> + <K>Enter</K>), tables (pick the size on the grid; a <b>Table</b> tab appears inside one), pictures (a <b>Picture</b> tab sets their size and position), links, comments, lines, symbols, the date and a table of contents.</li>
        <li><b>Layout</b>: paper size (A4, Letter, Legal), portrait or landscape, margins, and a header, footer and page numbers on every page.</li>
        <li><b>Review</b>: spelling, word count, <b>comments</b> (select text → New comment; reply, resolve or delete them on the right), <b>Track changes</b> (while it’s on, additions show green and deletions red until you accept or reject them, one by one or all at once) and <b>Compare</b> with an earlier version (for files in your account).</li>
        <li><b>View</b>: Read mode, Print layout (pages) or Web layout (one long page), the <b>Navigation</b> pane (every heading; click to go there), and zoom. The status bar at the bottom shows the page, words and zoom.</li>
        <li><b>Find and replace</b>: <K>Ctrl</K> + <K>F</K> / <K>Ctrl</K> + <K>H</K>, with match case and whole words.</li>
        <li><b>File</b>: open a Word file (.docx), save as Word, print or save as PDF (<K>Ctrl</K> + <K>P</K>), or save as Markdown.</li>
      </ul>
      <p>Markdown still works when pasted, and AI writes into the doc as before. A copy of the doc’s text is kept as Markdown, so search, exports and workflows read it too.</p>
    </> },
    { id: 'export', title: 'Exporting and sharing', body: <>
      <ul>
        <li><b>Diagram as PNG</b>: a high-resolution image for slides and docs.</li>
        <li><b>Diagram as SVG</b>: a vector image you can edit in design tools.</li>
        <li><b>Doc as Markdown</b>: the doc plus the code of every diagram. This is the best way to back up a file.</li>
        <li><b>Copy diagram code</b> / <b>Copy doc text</b> copy to the clipboard.</li>
      </ul>
    </> },
    { id: 'saving', title: 'Where your work is saved', body: <>
      <p><b>Signed in</b>, files are saved to your account a moment after each change, so they follow you to any device. Your folders and archive go with them. A copy is kept in the browser too, so you can keep working offline; it uploads when you're back.</p>
      <p><b>Without an account</b>, files are saved <b>in this browser only</b>: they don't appear on another computer, and clearing site data or using a private window loses them. Export important files as Markdown to keep a copy.</p>
      <p>When Workline runs on its own server (ask whoever set it up), a file's <b>⋯</b> menu also has:</p>
      <ul>
        <li><b>Share…</b> makes a link to the file. <b>Can view</b> links open it read-only; <b>Can edit</b> links let anyone with the link change it, and their changes are saved to your account. Turn a link off to stop it working.</li>
        <li><b>Version history…</b> lists earlier versions (one for each stretch of editing, the last 100) and restores one. The version you replace stays in the list.</li>
        <li>AI has a daily allowance per account; it resets at midnight UTC.</li>
      </ul>
      <p>You stay signed in for 30 days. <b>Sign out</b> is in the sidebar; it doesn't delete your files.</p>
      <p>On a Workline server, <b>Account &amp; security</b> in the sidebar changes your name and password, connects Google or GitHub, and turns on <b>two-step verification</b>: scan the QR code with an authenticator app, enter its code, and save the ten recovery codes it gives you. After that, signing in also asks for the code from your app (or one recovery code, if you've lost your phone).</p>
    </> },
  ];
}

function erdGuide(onTry, theme) {
  const ex = (k, t) => <Example code={EX[k]} title={t} onTry={onTry} theme={theme} />;
  return [
    { id: 'what', title: 'What an ERD shows', body: <>
      <p>An <b>entity relationship diagram</b> (ERD) is a picture of a database. It has three parts:</p>
      <ul>
        <li><b>Tables</b> (entities), such as <i>customers</i> or <i>orders</i>.</li>
        <li><b>Columns</b> in each table, with their type and whether they're a key.</li>
        <li><b>Relationships</b> between tables: “one customer places many orders”.</li>
      </ul>
      <p>In Workline this diagram type is called <b>Database schema</b>. You describe it in a few lines of text and it draws itself.</p>
    </> },
    { id: 'start', title: 'Starting one', body: <>
      <ul>
        <li><b>From the home page:</b> Start from a Template → <b>Database schema</b>.</li>
        <li><b>In an open file:</b> <b>+ Diagram</b> → <b>Database schema</b>.</li>
        <li><b>With AI:</b> describe your data (“a library with books, authors, members and loans”) or paste <code>CREATE TABLE</code> SQL into the AI box.</li>
      </ul>
      <p>Then click <b>Code</b> on the canvas to see and edit the code.</p>
    </> },
    { id: 'tables', title: 'Tables and columns', body: <>
      <p>A table is its name, then its columns between <code>{'{'}</code> and <code>{'}'}</code>, one column per line:</p>
      {ex('first', 'Users table')}
      <p>Each column line is <code>name type flags</code>:</p>
      <ul>
        <li><b>name</b>: letters, numbers, <code>_</code> or <code>-</code>, no spaces.</li>
        <li><b>type</b> is optional and can be anything: <code>uuid</code>, <code>text</code>, <code>int</code>, <code>varchar(255)</code>…</li>
        <li><b>flags</b> are optional:
          <table className="gtable"><tbody>
            <tr><td><code>pk</code></td><td>Primary key: identifies each row</td></tr>
            <tr><td><code>fk</code></td><td>Foreign key: points at another table</td></tr>
            <tr><td><code>pk,fk</code></td><td>Both (common in join tables)</td></tr>
            <tr><td><code>unique</code></td><td>No two rows can share this value</td></tr>
          </tbody></table>
        </li>
      </ul>
      <h4>Icons and colours</h4>
      <p>Add <code>icon</code> and <code>color</code> in square brackets. Icons can be any of the 2,000+ in the icon picker (<code>user</code>, <code>home</code>, <code>message-circle</code>…). Colours are <code>blue</code>, <code>green</code>, <code>orange</code>, <code>purple</code>, <code>red</code>, <code>olive</code>, <code>yellow</code>, <code>grey</code> or a hex code like <code>#e5484d</code>. You can also pick both from the toolbar by clicking a table.</p>
      <pre className="gpre">{`users [icon: user, color: blue] {
  id string pk
  name string
}`}</pre>
      <h4>Friendlier display names</h4>
      <p>Put a label in square brackets to show something other than the code name:</p>
      {ex('label', 'Labelled table')}
    </> },
    { id: 'rels', title: 'Relationships', body: <>
      <p>A relationship goes on its own line, outside any table: <code>left symbol right</code>. The symbol says how many rows on each side:</p>
      <table className="gtable"><thead><tr><th>Write</th><th>Means</th><th>Example</th></tr></thead><tbody>
        <tr><td><code>a &gt; b</code></td><td>many <i>a</i> to one <i>b</i></td><td>many orders belong to one customer</td></tr>
        <tr><td><code>a &lt; b</code></td><td>one <i>a</i> to many <i>b</i></td><td>one customer has many orders</td></tr>
        <tr><td><code>a - b</code></td><td>one to one</td><td>one user has one profile</td></tr>
        <tr><td><code>a &lt;&gt; b</code></td><td>many to many</td><td>orders contain many products, products appear in many orders</td></tr>
      </tbody></table>
      <p><b>Tip:</b> the arrow points <i>at the “one” side</i>. <code>&lt;</code> and <code>&gt;</code> open toward the “many” side.</p>
      {ex('kinds', 'Relationship kinds')}
      <h4>Connect specific columns</h4>
      <p>Write <code>table.column</code> to attach the line to that column's row instead of the table's header. Add <code>: text</code> to label the line:</p>
      {ex('rels', 'Authors and books')}
      <h4>A table that points at itself</h4>
      {ex('self', 'Employees and managers')}
    </> },
    { id: 'read', title: 'Reading the line ends', body: <>
      <p>Workline draws relationships in “crow's foot” style:</p>
      <ul>
        <li><b>Crow's foot</b> (three prongs) at an end means <b>many</b> rows on that side.</li>
        <li><b>Two short bars</b> at an end means <b>exactly one</b> row on that side.</li>
      </ul>
      <p>So for <code>orders &gt; customers</code>, the prongs are at <i>orders</i> and the bars are at <i>customers</i>.</p>
      <p><b>pk</b>, <b>fk</b> and <b>unique</b> appear after a column's type, and primary keys are bold.</p>
      <h4>Chen notation</h4>
      <p>Prefer <b>1</b> and <b>*</b> at the line ends? Add <code>notation chen</code> on its own line, or click the diagram's name above it and choose <b>Chen</b> in the toolbar.</p>
    </> },
    { id: 'full', title: 'A complete example', body: <>
      <p>A small online store, with a title, comments, column-level relationships and a join table (<i>order_items</i>) that turns a many-to-many into two many-to-ones:</p>
      {ex('full', 'Online store')}
    </> },
    { id: 'canvas', title: 'Working on the canvas', body: <>
      <ul>
        <li><b>Drag tables</b> to arrange them. Positions are remembered.</li>
        <li><b>Click a table's header</b> for its toolbar: rename it (relationships follow), pick an icon or a colour, add a column, or delete it.</li>
        <li><b>Click a row</b> to select just that column. Its toolbar edits the <b>name</b>, <b>type</b> and <b>metadata</b> (keys like <code>pk</code>, <code>fk</code>, <code>unique</code>, or notes like <code>not null</code>), with quick <b>pk</b>/<b>fk</b> toggles. <K>↑</K> <K>↓</K> move between rows, <K>Alt ↑</K> <K>Alt ↓</K> reorder them, <K>Enter</K> edits the name, <K>Delete</K> removes the column and <K>Esc</K> goes back to the whole table. Renaming a column updates the relationships that point at it.</li>
        <li><b>Click the diagram's name</b> (above its top-left corner) for <b>Reset Layout</b>, renaming, notation and colours. <b>AI Chat</b> and <b>Code Editor</b> sit beside it.</li>
        <li>The <b>code editor</b> colours the code, numbers the lines (lines with a problem turn red), and has buttons to insert <code>&gt;</code>, <code>&lt;</code>, <code>-</code> and <code>&lt;&gt;</code>.</li>
        <li><b>Color / Mono</b> switches between coloured table headers and grey ones.</li>
        <li><b>Click a table, then ask AI</b> to change just that table: “add created_at and updated_at”, “split address into its own table”.</li>
        <li>You can still add notes, arrows, frames and comments on top with the drawing tools.</li>
        <li><b>Export → Diagram as PNG / SVG</b> for docs and slides.</li>
      </ul>
    </> },
    { id: 'convert', title: 'Converting to and from', body: <>
      <ul>
        <li><b>From boxes you drew:</b> write a table name on the first line of a box and one column per line below it (<code>id uuid pk</code> or <code>id: uuid</code>). Connect boxes with arrows: an arrow from A to B means many A to one B, arrows at both ends mean many-to-many, a plain line means one-to-one. Select them and choose <b>⋯ → Convert to code → Database schema</b> (or <b>Add to the database schema code</b> if the schema already has tables).</li>
        <li><b>From a picture:</b> in AI Chat, click <b>From a picture</b> (or press <code>/</code> → Attach a picture) and pick a screenshot or photo of a diagram, even a whiteboard. Choose <b>Entity Relationship</b> first to be sure you get a schema.</li>
        <li><b>From another diagram:</b> click an architecture, flowchart or sequence diagram's name above it, then <b>⋯ → Generate ER diagram from this</b>. AI designs the tables behind it in a new tab.</li>
        <li><b>To SQL:</b> click the schema's name, then <b>⋯ → Export as SQL</b> (PostgreSQL or MySQL), or use the download button in the code editor. Columns, primary keys, unique columns and foreign keys (from relationships that name their columns) are all included.</li>
        <li><b>From a .sql file:</b> drop a <code>.sql</code> file on the canvas, or use <b>Insert → Database schema from SQL</b>, <b>Tools → Open a .sql file</b>, or the schema's <b>⋯ → Import SQL</b>. No AI is needed. It reads schema files, migrations and whole database dumps (<code>pg_dump</code>, <code>mysqldump</code>, SQLite <code>.schema</code>, SQL Server scripts): tables, columns and their types (<code>varchar(255)</code>, <code>numeric(10,2)</code>…), primary keys (also added later with <code>ALTER TABLE</code>), unique columns, and foreign keys as relationship lines (one-to-one when the key is unique). <code>ALTER TABLE</code> adding, dropping and renaming columns is followed in order; data, views and functions are skipped.</li>
      </ul>
    </> },
    { id: 'errors', title: 'Fixing mistakes', body: <>
      <p>When a line can't be understood, the code panel says <i>“Line N isn't recognized”</i>. The usual causes:</p>
      <table className="gtable"><thead><tr><th>Problem</th><th>Fix</th></tr></thead><tbody>
        <tr><td>Missing <code>{'}'}</code>, so the next table becomes columns</td><td>Close every table with <code>{'}'}</code> on its own line</td></tr>
        <tr><td>Spaces in a column name: <code>first name text</code></td><td>Use <code>first_name text</code></td></tr>
        <tr><td><code>a -&gt; b</code> or <code>a =&gt; b</code></td><td>Use one of <code>&gt;</code> <code>&lt;</code> <code>-</code> <code>&lt;&gt;</code></td></tr>
        <tr><td>A relationship written inside a table's braces</td><td>Move it below the closing <code>{'}'}</code></td></tr>
        <tr><td>A table appears with <i>“no columns”</i></td><td>A relationship names a table that doesn't exist. Check the spelling.</td></tr>
      </tbody></table>
    </> },
  ];
}

/* ---- the Workflows guide: how they work, then every node, from NODES and NODE_GUIDE ---- */
function NodeGroup({ group, q, lit }) {
  const needle = q.trim().toLowerCase();
  const list = Object.entries(NODES).filter(([k, d]) => d.group === group && (!needle || `${d.label} ${d.note} ${k} ${NODE_GUIDE[k]?.what || ''}`.toLowerCase().includes(needle)));
  if (!list.length) return <p className="muted">{needle ? 'No node here matches.' : ''}</p>;
  return <div className="gn-list">{list.map(([k, d]) => <NodeCard key={k} type={k} d={d} lit={lit === k} />)}</div>;
}
const GROUP_NOTE = {
  Triggers: 'Every workflow starts with one. A workflow may have several (a webhook and a schedule, say); each starts it on its own. Apart from Run by hand, triggers only work while the workflow is Active.',
  Workline: 'Your own Workline files: sheets, docs, diagrams and saved database connections. A file a workflow changes keeps its version history.',
  Flow: 'Steer the items: branch, filter, join, sort, wait, or run code.',
  Data: 'Change the items’ fields and values without calling anything outside.',
  UI: 'Build a web page from nodes, no code: start with the Page trigger, then add Text, Cards, Tables, Charts, pictures and videos, Buttons and Forms. The page is at the trigger’s link; its forms and buttons run the workflow again.',
  Web: 'Read web pages: fast without a browser, or with a real one for pages that need JavaScript, clicks or screenshots.',
  AI: 'Ask a model for text: summaries, replies, classifications, translations.',
  Communication: 'Send messages, emails and notifications.',
  Productivity: 'Tasks, pages, sheets and calendars in other apps.',
  Developer: 'Any API, code hosts, issue trackers and on-call.',
  'Sales & payments': 'CRM records, payments and orders.',
  'Storage & feeds': 'Databases, files, feeds and public data.',
};

function flowGuide(q, setQ, lit) {
  const count = Object.keys(NODES).length;
  return [
    { id: 'first', title: 'Your first workflow', body: <>
      <p>A <b>workflow</b> is a chain of <b>nodes</b>: a <b>trigger</b> that starts it, then steps that each do one thing — read data, change it, decide, or send it to an app. Data flows along the lines between them.</p>
      <ol>
        <li>Make one: <b>Tools → Automation → Workflow</b> (or pick a ready-made one, such as <i>Form to a sheet</i>). A new workflow starts with a <b>Run by hand</b> trigger.</li>
        <li>Add a step: click a node in the <b>Nodes</b> list on the left (it’s added after the selected node and joined to it), drag it onto the canvas, or drag from a node’s right-hand dot and let go on empty space.</li>
        <li>Set it up: click the node. The panel on the right shows its settings. Fields can use what came in, e.g. <code>{'{{ $json.name }}'}</code>.</li>
        <li>If it’s an app (Slack, Gmail…), choose a <b>credential</b>, or press <b>New</b> to add one: the dialog says where to find the key.</li>
        <li>Press <b>Run workflow</b>. Each node shows a tick or an error; click one and open <b>Output</b> to see exactly what it gave.</li>
        <li>To make it run by itself, use a trigger like Webhook, Schedule or Form and switch the workflow <b>Active</b>.</li>
      </ol>
      <p>Try this: <b>Run by hand → Hacker News → Limit</b> (3) <b>→ Slack</b> with the text <code>{'{{ $json.title }} {{ $json.url }}'}</code>. It posts the three top stories.</p>
    </> },
    { id: 'canvas', title: 'The canvas', body: <>
      <ul>
        <li><b>Connect</b> two nodes by dragging from an output dot (right) to an input dot (left). Let go on empty canvas to pick a new node there.</li>
        <li><b>Move</b> a node by dragging it; <b>pan</b> by dragging the background or scrolling; <b>zoom</b> with <K>Ctrl</K> + scroll or the buttons at the bottom left (the last one fits everything in view).</li>
        <li><b>Delete</b> the selected node or line with <K>Delete</K> or <K>Backspace</K>; <K>Esc</K> clears the selection.</li>
        <li>Nodes with several outputs (<b>IF</b>: true/false, <b>Switch</b>: 1–4/other) have a dot for each; connect each to its own next step.</li>
        <li><b>Nodes</b> (top left) and the panel button (top right) hide the side panels for more room. The list has a search box.</li>
      </ul>
    </> },
    { id: 'items', title: 'Items and expressions', body: <>
      <p>Nodes pass <b>items</b> to each other: a list of small JSON objects, like rows. Most nodes run once <b>for each item</b>: if an RSS feed gives 10 posts, the Slack node after it sends 10 messages. To get one message for everything, put <b>Aggregate</b> (or Code) in between.</p>
      <p>Any field can hold <b>expressions</b> in double braces. They are JavaScript, run for each item:</p>
      <table className="gtable"><tbody>
        <tr><td><code>{'{{ $json.email }}'}</code></td><td>A field of the item coming in. Paths work: <code>{'{{ $json.customer.address.city }}'}</code>, <code>{'{{ $json.items[0].name }}'}</code>.</td></tr>
        <tr><td><code>{'{{ $node["Webhook"].json.body.id }}'}</code></td><td>The first item an earlier node (by its name) gave. <code>.items</code> is all of them. Useful after an app node, whose output replaces the item.</td></tr>
        <tr><td><code>{'{{ $now }}'}</code></td><td>The time the run started (ISO text). <code>{'{{ $now.slice(0, 10) }}'}</code> is today’s date.</td></tr>
        <tr><td><code>{'{{ $index }}'}</code></td><td>The item’s position, from 0.</td></tr>
        <tr><td><code>{'{{ $json.price * 1.18 }}'}</code></td><td>Any JavaScript expression: maths, <code>.toUpperCase()</code>, <code>? :</code>, <code>JSON.stringify(…)</code>, <code>Math.round(…)</code>.</td></tr>
      </tbody></table>
      <p>A field that is <i>only</i> an expression keeps its type (a number, a list, an object); text around it makes it text: <code>{'Total: {{ $json.total }}'}</code>.</p>
      <p>Not sure what a field is called? Run the workflow, click the node before, and look at its <b>Output</b>.</p>
    </> },
    { id: 'triggers', title: 'Triggers and Active', body: <>
      <ul>
        <li><b>Run by hand</b> only runs when you press Run. Good for building and testing.</li>
        <li><b>Webhook, Form and app triggers</b> (GitHub, Stripe, Shopify, Slack, Typeform, Calendly) each have their <b>own secret URL</b>, shown in the node’s settings. Paste it into the other app. Anyone with the URL can start the workflow, so keep it private; app triggers can also check a <b>signing secret</b>.</li>
        <li><b>Schedule</b> runs every few minutes, hours or days, or daily at a time in <b>UTC</b> (India is UTC+5:30).</li>
        <li><b>New in a feed, Telegram message, Page changed, New sheet row</b> look for something new every few minutes. The first look only remembers what’s there, so you don’t get old things.</li>
      </ul>
      <p>These only work while the workflow is <b>Active</b> (the switch in the toolbar) <i>and saved</i>. Switching it off stops them at once. <b>Run workflow</b> always works, Active or not, so you can test a webhook workflow by hand.</p>
      <p><b>On the free server</b> (Render) the backend sleeps after 15 quiet minutes. Webhooks and forms wake it (the first call can take about a minute); schedules and the “look every few minutes” triggers wait until it is awake. A free pinger such as cron-job.org calling the site every 10 minutes keeps it awake.</p>
    </> },
    { id: 'creds', title: 'Credentials', body: <>
      <p>App nodes need a <b>credential</b>: an API key, token or webhook URL from that app. Add them in the node (<b>New</b>) or with <b>Credentials</b> in the toolbar. Each kind says where to find its key.</p>
      <ul>
        <li>They are stored <b>encrypted</b> on the server and never sent back to the browser: when you edit one, empty fields keep their saved value.</li>
        <li>One credential can be used by many nodes and workflows. Deleting it breaks the nodes that use it.</li>
        <li>Exports and templates <b>never</b> contain credentials; after an import, pick them again.</li>
      </ul>
    </> },
    { id: 'save', title: 'Save, export, import, templates', body: <>
      <ul>
        <li><b>Save</b>: workflows save by themselves a moment after each change, like every Workline file. <b>Save</b> in the toolbar (or <K>Ctrl</K> + <K>S</K>) saves at once; it reads <b>Saved ✓</b> when everything is stored.</li>
        <li><b>Export</b> downloads the workflow as a <code>.workflow.json</code> file, to keep, share or move to another account. Credentials, signing secrets and webhook URLs are left out.</li>
        <li><b>Import</b> opens a Workline workflow file or one exported from <b>n8n</b>. Into an empty workflow it replaces it; otherwise it’s added beside what’s there. n8n nodes Workline has become the same node; others become <i>No operation</i> placeholders named after them, to rebuild by hand. Imported webhooks get new URLs. You can also import from <b>Tools → Automation → Import a workflow</b>.</li>
        <li><b>Template</b> keeps the workflow (without credentials) in <b>Templates</b> on the home page (sidebar, or press <K>P</K>), to start new workflows from. Saving a template with the same name replaces it; each can be renamed or removed there.</li>
      </ul>
    </> },
    { id: 'apps', title: 'Apps: workflows for everyone', body: <>
      <p>Build a workflow once, then <b>publish</b> it as an <b>app</b>: people who don’t build workflows run it from <b>Apps</b> on the home page (sidebar, or <K>R</K>) — a simple form and a <b>Run</b> button, no nodes, no credentials.</p>
      <ol>
        <li>Build and test the workflow as usual, starting from <b>Run by hand</b>.</li>
        <li>Press <b>Publish</b> in the toolbar. Switch it to <b>Published</b>, give it a name, a line about what it does, an icon and a colour.</li>
        <li>Add the <b>questions</b> it asks (short or long text, number, email, date, a choice, yes/no). Each answer reaches the workflow as <code>{'{{ $json.<name> }}'}</code> — the dialog shows the exact name under each question — so use those in the nodes.</li>
        <li>Choose which trigger it <b>starts from</b>, which node’s output to <b>show</b> (or the last steps), and <b>how</b>: best fit, text, table, cards or raw data. Pictures (screenshots, QR codes) and links show as such.</li>
      </ol>
      <ul>
        <li>An app is <b>live</b>: it always runs the workflow as last <b>saved</b>. Change the workflow and the app changes with it; unpublish it to take it away.</li>
        <li>It runs with <b>your</b> credentials; people using the app never see them.</li>
        <li>Results can be copied, or downloaded as CSV or JSON. Earlier runs are listed under the result.</li>
        <li>Templates are different: a template is a <i>copy</i> of a workflow, for building new ones; an app is the workflow itself, for using.</li>
      </ul>
    </> },
    { id: 'runs', title: 'Runs and results', body: <>
      <ul>
        <li>While a run goes, nodes light up as they finish: green worked, red failed, grey skipped (no items reached it, like the unused side of an IF).</li>
        <li>Click a node, then <b>Output</b>, to see its items (the first 20). A failed node shows its error; the run stops there.</li>
        <li><b>Run from here</b> (in a node’s settings) starts at that node, handy to test the end of a long workflow.</li>
        <li>With no node selected, the side panel lists the last <b>20 runs</b> and what started them; click one to see it on the canvas. <b>Download results</b> saves what each node gave in that run as JSON.</li>
      </ul>
    </> },
    { id: 'limits', title: 'Limits and tips', body: <>
      <ul>
        <li>A run may take up to 2 minutes and 200 steps; up to 5,000 items may reach a node; 5 runs at once per account.</li>
        <li>HTTP and app nodes can’t call private or local addresses (like <code>localhost</code>) unless the server allows it.</li>
        <li>Use <b>IF</b> + <b>Stop and error</b> to fail loudly on bad data, and <b>Remove duplicates</b> before sending messages.</li>
        <li>Rename nodes (click the name in the settings panel) so <code>{'$node["…"]'}</code> expressions read well.</li>
        <li>Missing an app? <b>HTTP request</b> calls any API; add a <b>Bearer token</b> or <b>Header</b> credential for its key.</li>
      </ul>
    </> },
    { id: 'nodes', title: `All ${count} nodes`, body: <>
      <p>Every node, by group, with its settings, an example and what it gives. In the editor, the <b>?</b> on a node’s settings opens its entry here.</p>
      <label className="gn-search"><input type="search" placeholder="Find a node (e.g. email, sheet, translate)" aria-label="Find a node" value={q} onChange={e => setQ(e.target.value)} /></label>
    </> },
    ...GROUPS.map(gname => ({ id: 'grp-' + gname.replace(/\W+/g, '-').toLowerCase(), title: gname, body: <>
      <p className="muted">{GROUP_NOTE[gname]}</p>
      <NodeGroup group={gname} q={q} lit={lit} />
    </> })),
  ];
}


/* ---- the Custom apps guide: your own UI on your workflows, dashboards, and code in many languages ---- */
const APP_EX = {
  run: `<input id="city" placeholder="City">
<button id="go">Check</button>
<div id="out"></div>

<script>
  document.getElementById('go').onclick = async () => {
    const out = document.getElementById('out');
    out.textContent = 'Running…';
    try {
      // Runs the workflow "Weather" with { city }; gives back its output.
      const items = await workline.run('Weather', {
        city: document.getElementById('city').value,
      });
      table(out, items);
    } catch (err) {
      out.textContent = err.message;
    }
  };
</script>`,
  helpers: `cards('#kpis', [['Orders', 128], ['Revenue', '$4,210']]);
bars('#chart', rows, 'month', 'sales');     // label field, number field
line('#trend', rows, 'day', 'visits');
pie('#split', rows, 'region', 'sales');
table('#rows', rows);                        // all fields, or table(el, rows, ['a', 'b'])`,
  workflow: `// In the workflow: a Code node right after "Run by hand".
// The app's input is the first item.
const { city } = items[0];
const r = await fetch('https://wttr.in/' + encodeURIComponent(city) + '?format=j1');
const w = await r.json();
return [{ city, temp: +w.current_condition[0].temp_C, sky: w.current_condition[0].weatherDesc[0].value }];`,
};

function appsGuide() {
  return [
    { id: 'what', title: 'What a custom app is', body: <>
      <p>Three ways to put a UI on your workflows: the <b>visual builder</b> (drag and drop, with pages and sign-in: next section), a <b>page made of nodes</b> built in the workflow itself, or a <b>custom app</b> with your own HTML.</p>
      <p>A <b>custom app</b> is a web page of your own, made in HTML, CSS and JavaScript, that runs your <b>workflows</b> and shows what they give back however you like: a form, a dashboard, a chat, a video player. Publish it and it gets <b>a link of its own</b> that anyone can open, outside Workline, without an account.</p>
      <ul>
        <li>The <b>workflow</b> is the back end: it fetches data, calls APIs and AI, reads your sheets and databases, with your credentials.</li>
        <li>The <b>app</b> is the front end: one line, <code>await workline.run('Workflow name', input)</code>, runs a workflow and gives you its result.</li>
        <li>Compared with <a href="#" data-guide="flow">published workflow apps</a> (a ready-made form in Home → Apps), a custom app looks and behaves exactly as you write it.</li>
      </ul>
    </> },
    { id: 'visual', title: 'Visual builder: drag and drop an app', body: <>
      <p>The easiest way to make an app for other people. Open a workflow, then <b>View → App</b> (or Tools → Custom app): it starts in <b>Visual</b>, already showing that workflow’s results in a table.</p>
      <ol>
        <li><b>Add components</b> from the left (Heading, Text, Button, Input, Dropdown, Form, Table, Chart, Number, Cards list, Image, Video…): click one, or drag it onto the page. Drag a box to move it, its edge or corner to resize. On the right, set what it shows.</li>
        <li><b>Data</b> tab: each data source runs a workflow and keeps its output as <code>data.name</code>. Point a table at it with <code>{'{{ data.orders }}'}</code>; show a count with <code>{'{{ data.orders.length }}'}</code>. Send what people typed with <code>{'{{ vars.input1 }}'}</code>.</li>
        <li><b>Steps</b>: a button, form, table row or card can refresh data, run a workflow, set a value, go to a page, show a message, open a link or sign out. For a details page: add a page, then give the table the step <i>Go to a page</i>; on that page show <code>{'{{ vars.table1.name }}'}</code>.</li>
        <li><b>App</b> tab: name, menu (top or side), theme, and <b>who can use it</b>: anyone with the link, anyone who signs in, or only emails you invite. Signed-in people are <code>{'{{ user.email }}'}</code> in the app and <code>{'{{ $json.user.email }}'}</code> in the workflow, so each person can see only their own data.</li>
        <li><b>Preview</b> to try it; <b>Phone</b> to see it on a small screen (components stack top to bottom). Then <b>Publish</b> and share the link.</li>
      </ol>
      <p>The <b>AI</b> button can build or change the whole app from a description. Prefer code? <b>Code</b> gives you the page to write by hand (next sections).</p>
    </> },
    { id: 'nodes', title: 'No code: a page made of nodes', body: <>
      <p>Don’t want to write HTML? A workflow can draw a page by itself from <b>UI nodes</b>:</p>
      <ol>
        <li>Start the workflow with the <b>Page</b> trigger (Nodes → Triggers). Give it a title, and a light or dark look.</li>
        <li>Add the nodes that get your data (a database, a sheet, an HTTP call, AI…), then <b>UI</b> nodes in the order they should appear: <b>Text</b>, <b>Cards</b>, <b>Table</b>, <b>Chart</b>, <b>Image or video</b>, <b>Buttons</b>, <b>Form</b>. Each one shows the items reaching it and passes them on.</li>
        <li>Press <b>Preview page</b> on the Page trigger to see it. Turn the workflow <b>Active</b>, then <b>Open</b> or <b>Copy</b> its link.</li>
      </ol>
      <ul>
        <li>The workflow gets <code>{'{ action, query, form }'}</code>: <b>Buttons</b> reopen the page with a choice in <code>query</code> (<code>?category=Film</code>), and a <b>Form</b> reruns it with its answers in <code>form</code> and its name in <code>action</code>. Read them with <code>{'{{ $json.query.category }}'}</code> right after the trigger, or <code>{'{{ $node["Page"].json.form.search }}'}</code> further on.</li>
        <li><b>Cards</b> can count and add up: <code>{'{{ $items.length }}'}</code>, <code>{'{{ $items.reduce((s, i) => s + i.total, 0) }}'}</code>.</li>
        <li>Ready-made example: <b>Templates → Ready-made → Video library page (no code UI)</b>.</li>
      </ul>
      <p>A page made of nodes has a set look; a custom app (below) can look like anything.</p>
    </> },
    { id: 'first', title: 'Your first app', body: <>
      <ol>
        <li><b>Tools → Automation → Custom app.</b> You get a file with a small workflow (<i>Run by hand → Code</i>) and the <b>App</b> view open.</li>
        <li>The App view has the page’s <b>code</b> on the left and a <b>live preview</b> on the right. Type in the preview’s form and press <b>Run</b>: it runs the workflow and shows the answer.</li>
        <li>Change the code; the preview follows a moment after you stop typing. <b>↻ Reload</b> starts it again.</li>
        <li><b>Workflows ▾</b> chooses which of your workflows the app may run: this file’s own, or any other workflow file of yours.</li>
        <li><b>Start from ▾</b> swaps the page for a starter: a <i>form</i>, a <i>dashboard</i> that refreshes every minute, or a <i>chat</i>.</li>
        <li>When it works, switch on <b>Publish</b>. Copy the link, or <b>Open</b> it.</li>
      </ol>
      <p>An App view can be added to any file: <b>View → App</b>.</p>
    </> },
    { id: 'run', title: 'Running a workflow from the page', body: <>
      <p><code>workline.run(workflow, input)</code> runs one of the app’s workflows and resolves to what its <b>last steps</b> output, as a list of objects. It throws (rejects) with a readable message if the workflow fails.</p>
      <pre className="gpre">{APP_EX.run}</pre>
      <ul>
        <li><b>workflow</b>: its name (the file’s title) or id. Leave it out to run the app’s first workflow: <code>workline.run({'{ city }'})</code>.</li>
        <li><b>input</b>: an object (one item) or a list of them. The workflow starts from its <b>Run by hand</b> trigger with that as its items, so nodes read it as <code>{'{{ $json.city }}'}</code> and Code reads <code>items[0].city</code>.</li>
        <li><code>workline.workflows</code> lists the app’s workflows as <code>{'{ id, name }'}</code>.</li>
        <li>It always runs the workflow as last <b>saved</b> (in the preview: as it is in the editor). A run may wait up to a minute for its result.</li>
      </ul>
      <p>The matching workflow, for the example above:</p>
      <pre className="gpre">{APP_EX.workflow}</pre>
    </> },
    { id: 'draw', title: 'Showing results', body: <>
      <p>Use any HTML and CSS, or load a library from a CDN (<code>{'<script src="https://cdn.jsdelivr.net/…">'}</code>) such as Chart.js or a map. A few helpers are built in; each takes an element (or a CSS selector) and the rows:</p>
      <pre className="gpre">{APP_EX.helpers}</pre>
      <p>An error in the page’s script shows in red at the bottom of the page, so it doesn’t fail silently.</p>
    </> },
    { id: 'publish', title: 'Publishing and sharing', body: <>
      <ul>
        <li><b>Publish</b> gives the app a long, unguessable link. Anyone with the link can use the app; nobody needs an account.</li>
        <li>The app runs its workflows with <b>your credentials</b>, like a webhook. People using it never see them, but they can run the workflows as often as the rate limit allows (60 runs a minute per app), so only give an app the workflows it needs.</li>
        <li>An app can only run the workflows ticked under <b>Workflows ▾</b>; asking for any other is refused.</li>
        <li>The page runs <b>apart from Workline</b> (a sandbox): it can’t see your Workline sign-in, files or storage, and <code>localStorage</code> isn’t available to it.</li>
        <li>Changes go live as soon as the file saves. Switch <b>Publish</b> off and the link stops working; switch it on again and the same link works again.</li>
      </ul>
    </> },
    { id: 'readymade', title: 'Templates for every tool', body: <>
      <p><b>Home → Templates → Ready-made</b> has a starting point for each tool. The chips at the top show one tool’s templates; the search box narrows them too. Each makes a new file and opens it.</p>
      <table className="gtable"><tbody>
        <tr><th>Diagrams</th><td>Microservices architecture, Sign-up flow, Checkout sequence, CI/CD pipeline</td></tr>
        <tr><th>Docs</th><td>Product requirements (PRD), Meeting notes, Incident postmortem, Architecture decision record</td></tr>
        <tr><th>Sheets</th><td>Project tracker, Invoice, Sales report with a chart, Weekly habit tracker, with working formulas</td></tr>
        <tr><th>Databases</th><td>Online shop, Blog, SaaS accounts and billing: schemas, drawn. Connect a live database in the Database view.</td></tr>
        <tr><th>Code</th><td>Node.js REST API, Python data analysis, Landing page, TypeScript utility with tests</td></tr>
        <tr><th>Workflows</th><td>Daily AI news digest, Lead capture with AI, Support ticket triage, Weekly sales report, Failure alerts</td></tr>
        <tr><th>Apps</th><td>Feedback analyzer, KPI dashboard, Video streaming app</td></tr>
        <tr><th>Pages</th><td>Sales dashboard page, Feedback form page, Video library page: made only of nodes</td></tr>
      </tbody></table>
      <p>Where a template sends to Slack or email, reads a database or adds rows to a sheet, the node is there and named: pick your credential, connection or file on it, then turn the workflow <b>Active</b>.</p>
    </> },
    { id: 'templates', title: 'Ready-made: Video streaming app', body: <>
      <p><b>Templates → Ready-made → Video streaming app</b> (also in Tools) makes a whole app to start from: a <i>Video library</i> workflow and a player around it, with search, categories, a playlist, MP4 and HLS (<code>.m3u8</code>) streams.</p>
      <ol>
        <li><b>Find videos</b> (JavaScript) holds the list of videos and filters it by the search and category the app sends. Replace the list with your own, or with a <b>Google Sheet</b>, <b>Airtable</b>, a database or your video host’s API (an HTTP node).</li>
        <li><b>Playback links</b> (Python) hands out the links. With your own CDN, put its signing secret in <code>SECRET</code> and links stop working after 10 minutes; the player gets fresh ones by itself.</li>
        <li>Put the videos on a video host or CDN (Cloudflare Stream, Mux, Bunny, S3 with CloudFront, …). It does the streaming; the workflow only decides <i>what</i> plays and <i>who</i> gets a link. A workflow doesn’t send the video itself.</li>
      </ol>
    </> },
    { id: 'code', title: 'Code in many languages', body: <>
      <p>The workflow’s <b>Code</b> node has a <b>Language</b>. Picking one brings a small example to change.</p>
      <table className="gtable"><tbody>
        <tr><th>Runs on Workline</th><td><b>JavaScript</b>, <b>TypeScript</b>, <b>Python</b> (numpy, pandas and other packages load on first import), <b>Lua</b>, <b>SQL</b> (SQLite; the items are a table called <code>items</code>). <code>items</code> is the list of items; <code>return</code> the new list. Printed lines show in the output as <code>_logs</code>.</td></tr>
        <tr><th>Runs on your code runner</th><td><b>Go, Java, C, C++, C#, Rust, Ruby, PHP, Kotlin, Swift, Bash, R, Perl, Scala, Haskell, Dart, Elixir.</b> The program reads the items as JSON on standard input and prints the new items as JSON (the last line it prints).</td></tr>
      </tbody></table>
      <p>For the second group, add a <b>Code runner</b> credential and pick it on the node: a <b>Piston</b> server you run yourself (Service <code>piston</code>, its URL), or <b>Judge0</b> (Service <code>judge0</code>; on RapidAPI, URL <code>https://judge0-ce.p.rapidapi.com</code> and your RapidAPI key).</p>
      <p>Code runs in a locked-down sandbox: it can use the internet (<code>fetch</code>, <code>requests</code>-style calls), but not the server’s files or secrets. It stops after 10 seconds (Python: 60).</p>
    </> },
    { id: 'dash', title: 'Dashboards on the canvas', body: <>
      <p>For a dashboard inside a file rather than at its own link, use <b>Insert → Dashboard block</b> on the canvas: the same HTML and helpers, shown live on the canvas. Its <code>data</code> comes from:</p>
      <ul>
        <li><b>Code blocks</b>: point at a code block, drag from the dot on its right to the dashboard. Whatever the code returns becomes <code>data</code>, again whenever the code changes.</li>
        <li><b>This file’s workflow</b>: press <b>↻ Refresh</b> (or have it refresh every 1, 5 or 15 minutes). The last result is kept with the file.</li>
      </ul>
      <p><b>Edit HTML</b> on the block opens its code.</p>
    </> },
    { id: 'tips', title: 'Tips and troubleshooting', body: <>
      <table className="gtable"><tbody>
        <tr><td>“This app can’t run …”</td><td>Tick that workflow under <b>Workflows ▾</b>, and check the name matches the workflow file’s title.</td></tr>
        <tr><td>“Workflows run on the Workline server. Sign in…”</td><td>Apps need the server: sign in. Without an account, files stay in this browser and workflows can’t run.</td></tr>
        <tr><td>“The workflow needs a trigger”</td><td>Add a <b>Run by hand</b> trigger at the start of the workflow.</td></tr>
        <tr><td>“…taking more than a minute”</td><td>The workflow is slow. Make it quicker, or have it save its result (a sheet, the key-value store) and let the app read that.</td></tr>
        <tr><td>The result looks wrong</td><td>Open the workflow, <b>Run workflow</b>, and look at each node’s <b>Output</b>: the app gets what the last nodes give.</td></tr>
        <tr><td>A video won’t play</td><td>Open its link on its own. A <code>403</code> means the signed link expired or the secret doesn’t match the CDN’s.</td></tr>
      </tbody></table>
    </> },
  ];
}

export default function Guide({ which, onWhich, onClose, onTry }) {
  const { theme } = useUI();
  const bodyRef = useRef(null);
  const [q, setQ] = useState('');
  const flow = String(which).startsWith('flow');
  const lit = flow && String(which).includes(':') ? String(which).split(':')[1] : null;
  const apps = which === 'apps';
  const sections = which === 'erd' ? erdGuide(onTry, theme) : apps ? appsGuide() : flow ? flowGuide(q, setQ, lit) : appGuide();

  useEffect(() => {
    if (lit) { setQ(''); setTimeout(() => document.getElementById('g-node-' + lit)?.scrollIntoView({ block: 'start' }), 30); }
    else bodyRef.current?.scrollTo(0, 0);
  }, [which, lit]);
  useEffect(() => {
    const key = e => { if (e.key === 'Escape' && !document.querySelector('.modal,.menu')) onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const jump = id => document.getElementById('g-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section className="screen guide">
      <div className="bar">
        <button className="btn" onClick={onClose}>← Back</button>
        <Brand />
        <span className="grow" />
        <div className="seg" role="group" aria-label="Choose a guide">
          <button aria-pressed={which !== 'erd' && !flow && !apps} onClick={() => onWhich('app')}>Using Workline</button>
          <button aria-pressed={flow} onClick={() => onWhich('flow')}>Workflows</button>
          <button aria-pressed={apps} onClick={() => onWhich('apps')}>Custom apps</button>
          <button aria-pressed={which === 'erd'} onClick={() => onWhich('erd')}>Database schemas</button>
        </div>
      </div>
      <div className="g-body" ref={bodyRef}
        onClick={e => { const a = e.target.closest('[data-guide]'); if (a) { e.preventDefault(); onWhich(a.dataset.guide); } }}>
        <div className="g-in">
          <nav className="g-toc" aria-label="Contents">
            <h2>Contents</h2>
            {sections.map((s, i) => <button key={s.id} onClick={() => jump(s.id)}><span>{i + 1}</span>{s.title}</button>)}
          </nav>
          <article className="g-doc">
            <header>
              <h1>{which === 'erd' ? 'Database schemas (ERD)' : apps ? 'Custom apps' : flow ? 'Workflows' : 'How to use Workline'}</h1>
              <p>{apps ? 'Your own page, in HTML, CSS and JavaScript, on top of your workflows: a form, a dashboard, a chat or a video player, at a link anyone can open.'
                : which === 'erd'
                ? 'Describe tables, columns and relationships as text, and Workline draws the entity relationship diagram.'
                : flow ? 'Automations like n8n: a trigger starts them, nodes do the steps, and they run on the Workline server.'
                : 'Everything you need to go from an idea to a design doc with diagrams.'}</p>
            </header>
            {sections.map((s, i) => (
              <section key={s.id} id={'g-' + s.id}>
                <h2><span>{i + 1}</span>{s.title}</h2>
                {s.body}
              </section>
            ))}
          </article>
        </div>
      </div>
    </section>
  );
}
