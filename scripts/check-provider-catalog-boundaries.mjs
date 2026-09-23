import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const modelToken = /(?:^|\/)(?:gpt-\d|gemini-\d|claude-(?:opus|sonnet|haiku|fable|\d)|grok-\d|muse-spark|deepseek-v\d|qwen\d)/i;
export function findCatalogBoundaryViolations(path, source) {
  if (path.endsWith('.html')) return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(match => findCatalogBoundaryViolations(`${path}.js`, match[1]));
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];
  const fail = (node, message) => findings.push(`${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${message}`);
  const name = node => node?.name?.getText(tree) ?? '';
  function withinModelTable(node) {
    for (let cursor = node.parent; cursor && !ts.isSourceFile(cursor); cursor = cursor.parent) {
      if (/models|model_catalog|modelcatalog/i.test(name(cursor))) return true;
      if (ts.isStatement(cursor)) break;
    }
    return false;
  }
  function visit(node) {
    if (ts.isArrayLiteralExpression(node) && node.elements.length && /effort|thinking/i.test(name(node.parent))
      && node.elements.some(element => ts.isStringLiteralLike(element)
        && /^(off|none|minimal|low|medium|high|xhigh|max|ultra|ultracode)$/i.test(element.text))) {
      fail(node, 'effort choices belong in catalog data');
    }
    if (ts.isStringLiteralLike(node) && modelToken.test(node.text)) fail(node, 'model literal belongs in catalog data');
    if (ts.isArrayLiteralExpression(node) && node.elements.length && withinModelTable(node)) {
      if (node.elements.some(element => ts.isStringLiteralLike(element) || ts.isObjectLiteralExpression(element)
        && element.properties.some(property => ts.isPropertyAssignment(property)
          && /^(id|model|label)$/.test(name(property).replace(/["']/g, '')) && ts.isStringLiteralLike(property.initializer)))) {
        fail(node, 'handwritten model table');
      }
    }
    if (ts.isPropertyAssignment(node) && /^(model|defaultModel|default_model)$/.test(name(node).replace(/["']/g, ''))
      && ts.isStringLiteralLike(node.initializer) && node.initializer.text) fail(node, 'model/default fallback must come from data');
    if (ts.isBinaryExpression(node) && /^(===|==|!==|!=)$/.test(node.operatorToken.getText(tree))) {
      const pair = [[node.left, node.right], [node.right, node.left]];
      for (const [key, value] of pair) if (!ts.isTypeOfExpression(key) && /(?:^|\.)(model|modelId|entryId|modelName)$/.test(key.getText(tree))
        && ts.isStringLiteralLike(value) && value.text && !value.text.startsWith('__')) fail(node, 'model-keyed branch');
    }
    if (ts.isNoSubstitutionTemplateLiteral(node) && node.text.includes('function ')) {
      findings.push(...findCatalogBoundaryViolations(`${path}:embedded.js`, node.text));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

export function checkCatalogBoundaries(root) {
  const failures = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|html)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        failures.push(...findCatalogBoundaryViolations(relative(root, path), readFileSync(path, 'utf8')));
      }
    }
  }
  walk(join(root, 'src'));
  const generator = readFileSync(join(root, 'scripts', 'generate-provider-catalog.mjs'), 'utf8');
  for (const match of generator.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (!match[1].startsWith('node:') && !match[1].startsWith('../src/catalogs/')) failures.push(`Catalog generator imports non-data service: ${match[1]}`);
  }
  return failures;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = checkCatalogBoundaries(root);
  if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
  else console.log('Catalog code/data boundaries checked.');
}
