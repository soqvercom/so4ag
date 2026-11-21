#!/usr/bin/env node
// so4ag-validate <file|https-url> [--json]        validate a source (SO4AG JSON, its JSON-LD form, or an HTML page with the JSON-LD inside)
// so4ag-validate <file|https-url> --to-jsonld      print the JSON-LD form
// so4ag-validate <file|https-url> --to-so4ag       print the SO4AG JSON read from JSON-LD or a page (a 0.2 file is expanded to 0.1)
// so4ag-validate <file|https-url> --to-0.2 [--full] print the short 0.2 form (current view unless --full)
// so4ag-validate <file> --verify <signature.json> --keys <keys.json>   check a detached signature
// so4ag-validate <file|https-url> --profile <file|https-url> [--profile …]   check the claims against your own profile too
// so4ag-validate --check-profile <file|https-url>   check a profile document
import { readFileSync } from 'node:fs';
import { validateManifest, validateProfile, withProfiles } from './index.mjs';
import { manifestToJsonLd, manifestFromJsonLd, manifestsFromHtml } from './jsonld.mjs';
import { validateAny, toCore, compact02, is02 } from './v02.mjs';
import { verifySignature } from './sign.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const optAll = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const load = async (where) => {
  if (/^https:\/\//.test(where)) {
    const r = await fetch(where, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
    if (!r.ok) { console.error(`HTTP ${r.status} for ${where}`); process.exit(2); }
    const t = await r.text();
    if (t.length > 1024 * 1024) { console.error('profile larger than 1 MB'); process.exit(2); }
    return JSON.parse(t);
  }
  return JSON.parse(readFileSync(where, 'utf8'));
};
if (opt('--check-profile')) {
  const r = validateProfile(await load(opt('--check-profile')));
  console.log(r.valid ? 'VALID  SO4AG profile' : 'INVALID');
  for (const e of r.errors) console.log(`  error   ${e.path}  ${e.code}: ${e.message}`);
  process.exit(r.valid ? 0 : 1);
}
let profiles;
try { profiles = withProfiles(await Promise.all(optAll('--profile').map(load))); } catch (e) { console.error(e.message); process.exit(2); }
const taken = new Set([opt('--verify'), opt('--keys'), ...optAll('--profile')].filter(Boolean));
const target = args.find((a) => !a.startsWith('--') && !taken.has(a));
if (!target) { console.error('usage: so4ag-validate <file|https-url> [--json | --to-jsonld | --to-so4ag]'); process.exit(2); }
let text;
if (/^https:\/\//.test(target)) {
  const r = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { accept: 'application/json, application/ld+json;q=0.9, text/html;q=0.8' } });
  if (!r.ok) { console.error(`HTTP ${r.status}`); process.exit(2); }
  text = await r.text();
} else text = readFileSync(target, 'utf8');
if (text.length > 5 * 1024 * 1024) { console.error('source larger than 5 MB'); process.exit(2); }
let m; let form = 'so4ag';
try {
  if (text.trimStart().startsWith('<')) {
    const found = manifestsFromHtml(text);
    if (!found.length) { console.error('the page has no JSON-LD block with a SO4AG source'); process.exit(1); }
    m = found[0]; form = 'html';
  } else {
    m = JSON.parse(text);
    if (Array.isArray(m?.['@graph'])) { m = manifestFromJsonLd(m); form = 'jsonld'; }
  }
} catch (e) { console.error('cannot read the source: ' + e.message); process.exit(1); }
if (args.includes('--to-jsonld')) { console.log(JSON.stringify(manifestToJsonLd(toCore(m)), null, 2)); process.exit(0); }
if (args.includes('--to-so4ag')) { console.log(JSON.stringify(toCore(m), null, 2)); process.exit(0); }
if (args.includes('--to-0.2')) { console.log(JSON.stringify(compact02(toCore(m), { view: args.includes('--full') ? 'full' : 'current' }), null, 2)); process.exit(0); }
if (opt('--verify')) {
  if (!opt('--keys')) { console.error('--verify needs --keys <keys.json>'); process.exit(2); }
  const v = verifySignature(m, JSON.parse(readFileSync(opt('--verify'), 'utf8')), JSON.parse(readFileSync(opt('--keys'), 'utf8')));
  console.log(v.valid ? `SIGNATURE VALID  key ${v.key.key_id}` : `SIGNATURE INVALID  ${v.reasons.join(', ')}`);
  process.exit(v.valid ? 0 : 1);
}
if (is02(m)) form += ' 0.2';
const { expanded, ...r } = validateAny(m, { profiles });
if (args.includes('--json')) { console.log(JSON.stringify({ form, ...r }, null, 2)); process.exit(r.valid ? 0 : 1); }
console.log(`${r.valid ? (r.version ? 'VALID  SO4AG 0.2 (draft)' : 'VALID  SO4AG Core 0.1') : 'INVALID'}  (read as ${form})`);
for (const e of r.errors) console.log(`  error   ${e.path}  ${e.code}: ${e.message}`);
for (const w of r.warnings) console.log(`  warning ${w.path}  ${w.code}: ${w.message}`);
if (r.stats) console.log(`  claims ${r.stats.claims} · known ${r.stats.known} · unknown ${r.stats.unknown} · current ${r.stats.current} · expired ${r.stats.expired} · attested ${r.stats.attested}`);
process.exit(r.valid ? 0 : 1);
