// Monaco (the editor inside VS Code), loaded only when the Code view first opens.
// Language services run in web workers, which Vite bundles from these imports.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// JS and TS files see each other (imports resolve across the workspace) and JSX works.
const ts = monaco.typescript || monaco.languages.typescript;
if (ts) {
  const opts = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX, allowJs: true, allowNonTsExtensions: true, esModuleInterop: true };
  ts.typescriptDefaults.setCompilerOptions(opts);
  ts.javascriptDefaults.setCompilerOptions(opts);
}

export default monaco;
