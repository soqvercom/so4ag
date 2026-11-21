import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest, validateProfile, withProfiles, selectClaims, GENERAL, RENTAL, RETAIL } from '../validator/index.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const source = read('../examples/valid/general-dental.json');
const own = read('../examples/profiles/dental-example-profile.json');
const NOW = new Date('2026-11-25T00:00:00Z');
const G = 'https://soqver.com/spec/so4ag/0.1/general#';

test('profiles: the built-in profile documents and the example profile are valid profiles', () => {
  for (const p of [GENERAL, RENTAL, RETAIL, own]) assert.deepEqual(validateProfile(p).errors, [], p.id);
  assert.equal(validateProfile({ ...own, properties: { x: { label: { en: 'X' }, value_types: ['boolean'], units: ['h'], description: 'd' } } }).valid, false);
  assert.equal(validateProfile({ ...own, properties: { x: { label: { en: 'X' }, value_types: ['boolean'], required_scope: ['nowhere'], description: 'd' } } }).valid, false);
  assert.throws(() => withProfiles({ id: 'x' }));
});

test('any industry: a dental practice with the General profile and its own profile validates without warnings', () => {
  const alone = validateManifest(source, { now: NOW });
  assert.equal(alone.valid, true);
  assert.deepEqual([...new Set(alone.warnings.map((w) => w.code))].sort(), ['profile_unknown', 'property_unknown']);
  const full = validateManifest(source, { now: NOW, profiles: withProfiles(own) });
  assert.equal(full.valid, true);
  assert.deepEqual(full.warnings, []);
});

test('any industry: the own profile is enforced once the validator knows it', () => {
  const bad = structuredClone(source);
  bad.claims.find((c) => c.property.endsWith('#contractedInsurers')).value.values = ['unknown_insurer'];
  delete bad.claims.find((c) => c.property.endsWith('#emergencySlot')).scope.day_type;
  const r = validateManifest(bad, { now: NOW, profiles: withProfiles(own) });
  assert.deepEqual(r.errors.map((e) => e.code).sort(), ['enum', 'scope_missing']);
});

test('any industry: General profile facts answer a task; a price needs its item', () => {
  const ask = (property, scope) => selectClaims(source, { property, scope }, { now: NOW });
  const hygiene = ask(G + 'price', { item: 'dental-hygiene', per: 'session', customer: 'private' });
  assert.equal(hygiene[0].result.usable, true);
  assert.equal(hygiene[0].result.value.amount, '1500.00');
  assert.ok(hygiene[1].result.reasons.includes('scope_mismatch:item'));
  assert.ok(ask(G + 'price', {}).every((x) => !x.result.usable));
  assert.deepEqual(ask(G + 'responseTime', { channel: 'email' })[0].result.reasons, ['unknown']);
  // a property of a profile the reader was not given: usable when the task states the scope key
  assert.equal(ask('https://dental.example/so4ag-profile#emergencySlot', { day_type: 'weekday' })[0].result.usable, true);
  assert.deepEqual(ask('https://dental.example/so4ag-profile#emergencySlot', {})[0].result.reasons, ['scope_not_comparable:day_type']);
});
