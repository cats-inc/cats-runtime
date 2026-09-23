import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCatalogDocument } from '../src/catalogs/schema.ts';
import { catalogDigest, stableCatalogJson } from '../src/catalogs/resolver.ts';

const sourcePath = new URL('../config/curated-model-catalogs.yaml.example', import.meta.url);
const outputPath = new URL('../config/curated-model-catalogs.generated.json', import.meta.url);
const source = readFileSync(sourcePath, 'utf8');
const output = `${stableCatalogJson({ sourceDigest: catalogDigest(source), document: parseCatalogDocument(source) })}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== output) throw new Error('Generated catalog is stale. Run npm run catalog:generate.');
} else {
  writeFileSync(outputPath, output);
}
console.log(`Catalog ${process.argv.includes('--check') ? 'checked' : 'generated'}: ${fileURLToPath(outputPath)} (${catalogDigest(source)})`);
