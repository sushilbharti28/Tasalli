import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { LANGUAGES, SCRIPTS_DIR, loadScript, toEngineTemplates } from '../src';

const out = join(SCRIPTS_DIR, 'engine');
mkdirSync(out, { recursive: true });
for (const lang of LANGUAGES) {
  const header = `# GENERATED from ${lang}.yaml by scripts/build-engine.ts. Do not edit by hand.\n# ${lang === 'en' || lang === 'hi' ? 'Status: needs native-speaker review until approved in the source file.' : 'NEEDS NATIVE-SPEAKER REVIEW.'}\n`;
  writeFileSync(join(out, `${lang}.yaml`), header + stringify(toEngineTemplates(loadScript(lang)), { lineWidth: 0 }));
}
console.log('wrote', LANGUAGES.length, 'files to', out);
