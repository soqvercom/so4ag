import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest, evaluateClaim, selectClaims, checkVersion, claimDigest, canonicalize } from '../validator/index.mjs';

const base = JSON.parse(readFileSync(new URL('../examples/valid/rental-first-party.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-20T08:30:00Z');
const clone = () => structuredClone(base);
const codes = (r) => r.errors.map((e) => e.code);

test('valid example passes', () => {
  const r = validateManifest(base, { now: NOW });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.stats.unknown, 1);
});

test('unknown claim with value is rejected', () => {
  const m = clone(); m.claims[2].value = { type: 'boolean', value: true };
  assert.equal(validateManifest(m, { now: NOW }).valid, false);
});

test('known claim without evidence is rejected', () => {
  const m = clone(); delete m.claims[0].evidence;
  assert.equal(validateManifest(m, { now: NOW }).valid, false);
});

test('valid_until before valid_from is rejected', () => {
  const m = clone(); m.claims[0].valid_until = '2026-11-01T00:00:00Z';
  assert.deepEqual(codes(validateManifest(m, { now: NOW })), ['time_order']);
});

test('bad currency and amount format rejected by schema', () => {
  const m = clone(); m.claims[0].value.currency = 'Kc';
  assert.equal(validateManifest(m, { now: NOW }).valid, false);
  const m2 = clone(); m2.claims[0].value.amount = '10000';
  assert.equal(validateManifest(m2, { now: NOW }).valid, false);
});

test('profile rules: missing required scope, wrong type, unknown enum', () => {
  const m = clone(); delete m.claims[0].scope.vehicle_class;
  assert.ok(codes(validateManifest(m, { now: NOW })).includes('scope_missing'));
  const m2 = clone(); m2.claims[0].value = { type: 'text', value: 'deset tisíc' };
  assert.ok(codes(validateManifest(m2, { now: NOW })).includes('value_type'));
  const m3 = clone(); m3.claims[1].value.values.push('crypto');
  assert.ok(codes(validateManifest(m3, { now: NOW })).includes('enum'));
});

test('duplicate claim ids rejected', () => {
  const m = clone(); m.claims[1].id = m.claims[0].id;
  assert.ok(codes(validateManifest(m, { now: NOW })).includes('duplicate_id'));
});

test('independently_reviewed needs attestation; digest must match current claim', () => {
  const m = clone(); m.claims[0].assertion_basis = 'independently_reviewed';
  assert.ok(codes(validateManifest(m, { now: NOW })).includes('review_without_attestation'));
  const c = m.claims[0];
  c.attestations = [{ id: 'https://reviewer.example/a/1', issuer: 'https://reviewer.example/', issuer_relation: 'independent', method: 'document review', claim_digest: claimDigest(c), issued_at: '2026-11-20T08:00:00Z', expires_at: '2027-02-20T08:00:00Z' }];
  assert.equal(validateManifest(m, { now: NOW }).valid, true);
  c.value.amount = '5000.00';
  assert.ok(codes(validateManifest(m, { now: NOW })).includes('digest_mismatch'));
});

test('canonicalize sorts keys and digest ignores attestations', () => {
  assert.equal(canonicalize({ b: 1, a: [true, 'x'] }), '{"a":[true,"x"],"b":1}');
  const c = clone().claims[0];
  const d = claimDigest(c); c.attestations = []; assert.equal(claimDigest(c), d);
});

test('consumer: usable only with matching scope and current validity', () => {
  const c = base.claims[0];
  const task = { property: c.property, scope: { branch: c.scope.branch, vehicle_class: 'economy' } };
  assert.equal(evaluateClaim(c, task, { now: NOW }).usable, true);
  assert.equal(evaluateClaim(c, { ...task, scope: { ...task.scope, vehicle_class: 'suv' } }, { now: NOW }).usable, false);
  const exp = evaluateClaim(c, task, { now: new Date('2027-01-01T00:00:00Z') });
  assert.equal(exp.usable, false); assert.ok(exp.reasons.includes('expired'));
});

test('consumer: unknown stays unknown; a scope key outside the profile is comparable only when the task states it', () => {
  const u = evaluateClaim(base.claims[2], { property: base.claims[2].property, scope: base.claims[2].scope }, { now: NOW });
  assert.equal(u.usable, false); assert.ok(u.reasons.includes('unknown')); assert.equal(u.value, null);
  const c = structuredClone(base.claims[0]); c.scope.loyalty_level = 'gold';
  const silent = evaluateClaim(c, { property: c.property, scope: { branch: c.scope.branch, vehicle_class: 'economy' } }, { now: NOW });
  assert.ok(silent.reasons.includes('scope_not_comparable:loyalty_level'));
  const stated = evaluateClaim(c, { property: c.property, scope: { branch: c.scope.branch, vehicle_class: 'economy', loyalty_level: 'gold' } }, { now: NOW });
  assert.equal(stated.usable, true);
  const listed = evaluateClaim(c, { property: c.property, scope: { branch: c.scope.branch, vehicle_class: 'economy', loyalty_level: 'gold' }, understoodScopeKeys: ['branch', 'vehicle_class'] }, { now: NOW });
  assert.ok(listed.reasons.includes('scope_not_comparable:loyalty_level'));
});

test('consumer: requireReview rejects related-party or stale attestation', () => {
  const c = structuredClone(base.claims[0]);
  c.attestations = [{ id: 'https://x.example/a', issuer: 'https://x.example/', issuer_relation: 'related_party', method: 'm', claim_digest: claimDigest(c), issued_at: '2026-11-20T08:00:00Z', expires_at: '2027-01-01T00:00:00Z' }];
  const task = { property: c.property, scope: { branch: c.scope.branch, vehicle_class: 'economy' }, requireReview: true, trustedIssuers: ['https://x.example/'] };
  assert.ok(evaluateClaim(c, task, { now: NOW }).reasons.includes('no_valid_independent_attestation'));
});

test('consumer: an attestation the source wrote about itself is never accepted without the consumer\'s own trust policy', () => {
  const c = structuredClone(base.claims[0]);
  const attacker = { id: 'https://evil.example/a', issuer: 'https://evil.example/#self-made-reviewer', issuer_relation: 'independent', method: 'trust me', claim_digest: claimDigest(c), issued_at: '2026-11-01T08:00:00Z', expires_at: '2027-06-01T00:00:00Z' };
  c.attestations = [attacker];
  const task = { property: c.property, scope: { branch: c.scope.branch, vehicle_class: 'economy' }, requireReview: true };
  const none = evaluateClaim(c, task, { now: NOW });
  assert.equal(none.usable, false); assert.deepEqual(none.reasons, ['no_trust_policy']);
  assert.equal(evaluateClaim(c, { ...task, trustedIssuers: [] }, { now: NOW }).usable, false);
  assert.equal(evaluateClaim(c, { ...task, trustedIssuers: ['https://reviewer.example/#org'] }, { now: NOW }).usable, false, 'an issuer the consumer does not list');
  assert.equal(evaluateClaim(c, { ...task, trustedIssuers: [attacker.issuer] }, { now: NOW }).usable, true, 'only the consumer can decide to trust an issuer');
  c.attestations = [{ ...attacker, issued_at: '2027-01-01T00:00:00Z' }];
  assert.equal(evaluateClaim(c, { ...task, trustedIssuers: [attacker.issuer] }, { now: NOW }).usable, false, 'not issued yet');
});

test('consumer: an unsupported version and an unknown required extension never yield a usable claim', () => {
  const m = structuredClone(base);
  const c = m.claims[0]; const task = { property: c.property, scope: c.scope };
  assert.equal(selectClaims(m, task, { now: NOW })[0].result.usable, true);
  assert.deepEqual(selectClaims({ ...m, so4ag: '99.0-unsupported' }, task, { now: NOW })[0].result.reasons, ['unsupported_version']);
  assert.deepEqual(selectClaims({ ...m, so4ag: undefined }, task, { now: NOW })[0].result.reasons, ['missing_version']);
  assert.equal(checkVersion({ so4ag: '0.1-draft' }).ok, true);
  const ext = { 'https://x.example/ext/needs': { affects_use: true, value: 1 } };
  const withExt = structuredClone(m); withExt.claims[0].extensions = ext;
  assert.deepEqual(selectClaims(withExt, task, { now: NOW })[0].result.reasons, ['unknown_required_extension:https://x.example/ext/needs']);
  assert.equal(selectClaims(withExt, task, { now: NOW, knownExtensions: ['https://x.example/ext/needs'] })[0].result.usable, true);
  assert.equal(selectClaims({ ...m, extensions: ext }, task, { now: NOW })[0].result.usable, false, 'an extension of the whole source applies to every claim');
  assert.equal(selectClaims({ ...m, extensions: { 'https://x.example/ext/note': { affects_use: false, value: 1 } } }, task, { now: NOW })[0].result.usable, true);
});

test('retail profile: a shop manifest validates and an unknown unit is an error', () => {
  const m = JSON.parse(readFileSync(new URL('../examples/valid/retail-proposal.json', import.meta.url), 'utf8'));
  const ok = validateManifest(m);
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some((w) => ['property_unknown', 'profile_unknown', 'scope_key_unknown'].includes(w.code)));
  const bad = structuredClone(m);
  const ship = bad.claims.find((c) => c.property.endsWith('#shippingPrice'));
  ship.property = ship.property.replace('#shippingPrice', '#returnPeriod'); ship.value = { type: 'quantity', value: '14', unit: 'h' }; ship.scope = {};
  assert.ok(validateManifest(bad).errors.some((e) => e.code === 'unit'));
});
