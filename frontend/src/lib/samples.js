// Starter projects for the Code view (its "Start from a sample" menu, and the Tools page).
export const SAMPLES = {
  ts: { label: 'TypeScript', files: [
    { path: 'README.md', text: '# Service\n\nNotes and code that go with this design.\n' },
    { path: 'src/index.ts', text: "import { greet } from './greet';\n\nconsole.log(greet('Workline'));\n" },
    { path: 'src/greet.ts', text: 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n' },
  ] },
  node: { label: 'Node.js web server', files: [
    { path: 'package.json', text: JSON.stringify({ name: 'demo', private: true, type: 'module', scripts: { start: 'node server.js' } }, null, 2) + '\n' },
    { path: 'server.js', text: "import { createServer } from 'node:http';\n\nconst port = 3000;\ncreateServer((req, res) => {\n  res.writeHead(200, { 'content-type': 'text/html' });\n  res.end('<h1>Hello from Node.js</h1><p>Edit server.js and run it again.</p>');\n}).listen(port, () => console.log(`Listening on http://localhost:${port}`));\n" },
  ] },
  py: { label: 'Python', files: [
    { path: 'main.py', text: 'from stats import summary\n\nnumbers = [3, 1, 4, 1, 5, 9, 2, 6]\nprint("Numbers:", numbers)\nprint(summary(numbers))\n' },
    { path: 'stats.py', text: 'from statistics import mean, median\n\n\ndef summary(xs):\n    return {"count": len(xs), "mean": mean(xs), "median": median(xs)}\n' },
  ] },
};
