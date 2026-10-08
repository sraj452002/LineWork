import { useEffect, useMemo, useRef } from 'react';
import { dg, prep, svgDoc } from '../lib/engines.js';
import { HELP } from '../lib/help.js';
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
      <p>Linework is for technical design work. Every <b>file</b> holds two things side by side:</p>
      <ul>
        <li>A <b>design doc</b>, written in Markdown.</li>
        <li>One or more <b>diagrams</b>, each on its own tab: Architecture, Flowchart, Sequence or Database schema.</li>
      </ul>
      <p>You can make diagrams three ways, and mix them freely: write a few lines of <b>diagram code</b>, <b>ask AI</b> to draw them, or <b>draw by hand</b> on the canvas.</p>
    </> },
    { id: 'home', title: 'The home page', body: <>
      <ul>
        <li><b>Create a Blank File</b> opens an empty doc and canvas.</li>
        <li><b>Generate an AI Diagram</b> asks what you're designing, then writes a short doc and draws 1 to 3 diagrams. Click the card again while it's working to stop it.</li>
        <li><b>Write a Design Doc</b> starts a doc with the usual sections (Context, Goals, Proposal…) already laid out.</li>
        <li><b>Start from a Template</b> gives ready-made examples: cloud architecture, flowchart, sequence diagram and database schema.</li>
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
    </> },
    { id: 'editor', title: 'The editor', body: <>
      <p>Opening a file shows the editor. Along the top:</p>
      <ul>
        <li><b>Files</b> takes you back home.</li>
        <li>The <b>file name</b> is editable in place.</li>
        <li><b>Saved / Saving</b> shows that changes are stored. There's no save button.</li>
        <li><b>Doc · Both · Canvas</b> chooses what you see. On a phone it's one or the other.</li>
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
        <li>Drag an <b>arrow</b> from one box to another and it stays attached when they move.</li>
        <li><b>+</b> at the top of the toolbar (or <K>/</K>) opens <b>Insert</b>: shapes, 2,000+ icons (general icons, tech logos and cloud provider logos, all searchable), phone/tablet/desktop/browser frames, figures, code blocks, images and the diagram catalogue.</li>
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
    { id: 'doc', title: 'Writing the doc', body: <>
      <p>Switch between <b>Write</b> and <b>Read</b> at the top of the doc. It's Markdown:</p>
      <pre className="gpre">{`# Heading      ## Smaller heading
- bullet       1. numbered
**bold**       *italic*       \`code\`
| a | b |      tables
|---|---|`}</pre>
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
      <p>Files are saved <b>in this browser only</b>, a moment after each change. That means:</p>
      <ul>
        <li>They don't appear on another computer or another browser.</li>
        <li>Clearing site data, or using a private window, loses them.</li>
        <li>Export important files as Markdown to keep a copy.</li>
      </ul>
      <p>You stay signed in for 30 days. <b>Sign out</b> is in the sidebar; it doesn't delete your files.</p>
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
      <p>In Linework this diagram type is called <b>Database schema</b>. You describe it in a few lines of text and it draws itself.</p>
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
      <p>Linework draws relationships in “crow's foot” style:</p>
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
        <li><b>From SQL:</b> <b>⋯ → Import SQL</b> takes pasted <code>CREATE TABLE</code> statements or a <code>.sql</code> file, no AI needed.</li>
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

export default function Guide({ which, onWhich, onClose, onTry }) {
  const { theme } = useUI();
  const bodyRef = useRef(null);
  const sections = which === 'erd' ? erdGuide(onTry, theme) : appGuide();

  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [which]);
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
          <button aria-pressed={which !== 'erd'} onClick={() => onWhich('app')}>Using Linework</button>
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
              <h1>{which === 'erd' ? 'Database schemas (ERD)' : 'How to use Linework'}</h1>
              <p>{which === 'erd'
                ? 'Describe tables, columns and relationships as text, and Linework draws the entity relationship diagram.'
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
