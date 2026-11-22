import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest, evaluateClaim, selectClaims, checkVersion, claimDigest, canonicalize } from '../validator/index.mjs';
import { manifestToJsonLd, manifestFromJsonLd, manifestsFromHtml, jsonLdScript, comparable, diffClaims, nativeLayer } from '../validator/jsonld.mjs';

const read = (f) => JSON.parse(readFileSync(new URL('../spec/conformance/0.1/' + f, import.meta.url), 'utf8'));
const manifests = { 'shop.json': read('shop.json'), 'rental.json': read('rental.json') };

test('conformance: evaluation cases', () => {
  for (const c of read('evaluation.json').cases) {
    const claim = manifests[c.manifest].claims.find((x) => x.id === c.claim);
    const r = evaluateClaim(claim, c.task, { now: new Date(c.now), knownExtensions: c.knownExtensions || [] });
    assert.equal(r.usable, c.expect.usable, `${c.id} ${c.title}: usable`);
    assert.deepEqual([...r.reasons].sort(), c.expect.reasons, `${c.id} ${c.title}: reasons`);
    assert.deepEqual([...r.warnings].sort(), c.expect.warnings || [], `${c.id} ${c.title}: warnings`);
    assert.deepEqual(r.value, c.expect.value, `${c.id} ${c.title}: value`);
  }
});

test('conformance: whole sources (version of the format, extensions of the source)', () => {
  for (const c of read('sources.json').cases) {
    if (c.task) {                                   // one task, the expected result of every claim
      const found = selectClaims(c.document, c.task, { now: new Date(c.now), knownExtensions: c.knownExtensions || [], liveCheckedAt: c.liveCheckedAt || null });
      for (const [end, want] of Object.entries(c.claims)) {
        const r = found.find((x) => x.claim.id.endsWith(end)).result;
        assert.equal(r.usable, want.usable, `${c.id} ${c.title}: ${end} ${r.reasons}`);
        assert.deepEqual([...r.reasons].sort(), [...(want.reasons || [])].sort(), `${c.id} ${c.title}: ${end}`);
        if (!r.usable) assert.equal(r.value, null, `${c.id}: a refused claim gives no value`);
      }
      assert.equal(new Set(found.filter((x) => x.result.usable).map((x) => JSON.stringify(x.claim.value))).size <= 1, true, `${c.id}: never two usable answers with different values`);
      continue;
    }
    const version = checkVersion(c.document);
    const items = selectClaims(c.document, {}, { now: new Date(c.now), knownExtensions: c.knownExtensions || [] })
      .map(({ claim }) => selectClaims(c.document, { property: claim.property, scope: claim.scope }, { now: new Date(c.now), knownExtensions: c.knownExtensions || [] }).find((x) => x.claim.id === claim.id).result);
    if (c.expect.error) {
      if (c.expect.error === 'invalid_source') assert.equal(version.ok, true, `${c.id} ${c.title}`);
      else { assert.equal(version.ok, false, `${c.id} ${c.title}`); assert.equal(version.code, c.expect.error, `${c.id} ${c.title}`); }
      assert.ok(items.length > 0 && items.every((r) => !r.usable && r.reasons.includes(c.expect.error) && r.value === null), `${c.id}: no claim of a refused source may be usable`);
      continue;
    }
    assert.equal(version.ok, true, `${c.id} ${c.title}`);
    for (const r of items) {
      assert.equal(r.usable, c.expect.usable, `${c.id} ${c.title}: ${r.reasons}`);
      for (const reason of c.expect.reasons || []) assert.ok(r.reasons.includes(reason), `${c.id}: reason ${reason} expected, got ${r.reasons}`);
    }
  }
});

test('conformance: reading a 0.2 file keeps the live rule (a stored value older than max_age is not used)', async () => {
  const { toCore, validate02 } = await import('../validator/v02.mjs');
  const cases = JSON.parse(readFileSync(new URL('../spec/conformance/0.2/reading.json', import.meta.url), 'utf8')).cases;
  assert.ok(cases.length >= 4);
  for (const c of cases) {
    assert.equal(validate02(c.document, { now: new Date(c.now) }).valid, true, c.id);
    const found = selectClaims(toCore(c.document), c.task, { now: new Date(c.now), liveCheckedAt: c.liveCheckedAt || null });
    for (const [end, want] of Object.entries(c.claims)) {
      const r = found.find((x) => x.claim.id.endsWith(end)).result;
      assert.equal(r.usable, want.usable, `${c.id} ${c.title}: ${r.reasons}`);
      assert.deepEqual([...r.reasons].sort(), [...(want.reasons || [])].sort(), `${c.id} ${c.title}`);
    }
    // a 0.1 reader that does not implement the live rule must refuse the expanded file instead of using a stale value
    const core = toCore(c.document);
    assert.equal(core.extensions['https://soqver.com/spec/so4ag/0.2/terms#live'].affects_use, true, c.id);
  }
});

test('conformance: canonical form of numbers, strings and key order (RFC 8785)', () => {
  for (const v of read('canonical.json').vectors) assert.equal(canonicalize(v.value), v.canonical);
  assert.equal(canonicalize(0.000001), '0.000001');
  assert.equal(canonicalize(1e-7), '1e-7');
  assert.equal(canonicalize(-0), '0');
});

test('conformance: validation cases', () => {
  for (const c of read('validation.json').cases) {
    const r = validateManifest(c.manifest, { now: new Date(c.now) });
    assert.equal(r.valid, c.expect.valid, `${c.id} ${c.title}: ${JSON.stringify(r.errors)}`);
    for (const code of c.expect.errors) assert.ok(r.errors.some((e) => e.code === code), `${c.id}: error ${code} expected, got ${r.errors.map((e) => e.code)}`);
    for (const code of c.expect.warnings) assert.ok(r.warnings.some((e) => e.code === code), `${c.id}: warning ${code} expected, got ${r.warnings.map((e) => e.code)}`);
  }
});

test('conformance: claim digests', () => {
  const digests = read('digests.json');
  for (const m of Object.values(manifests)) for (const c of m.claims) assert.equal(claimDigest(c), digests[c.id], c.id);
});

test('JSON-LD: manifest -> JSON-LD -> manifest keeps every field and every claim digest', () => {
  const examples = ['../examples/valid/rental-first-party.json', '../examples/valid/retail-proposal.json'].map((f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')));
  for (const m of [...Object.values(manifests), ...examples]) {
    const ld = JSON.parse(JSON.stringify(manifestToJsonLd(m, { now: new Date('2026-12-01T12:00:00Z'), describe: (c) => `about ${c.id}` })));
    const back = manifestFromJsonLd(ld);
    assert.equal(canonicalize(comparable(back)), canonicalize(comparable(m)), m.id);
    assert.equal(diffClaims(m, back).same, true);
    assert.equal(validateManifest(back, { now: new Date('2026-12-01T12:00:00Z') }).valid, true);
  }
});

test('JSON-LD: stored rendition equals the generated one and reads back from an HTML page', () => {
  for (const name of ['shop', 'rental']) {
    const m = manifests[name + '.json'];
    const stored = read(name + '.jsonld');
    assert.deepEqual(stored, JSON.parse(JSON.stringify(manifestToJsonLd(m, { now: new Date('2026-12-01T12:00:00Z') }))));
    const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"x"}</script>${jsonLdScript(stored)}</head><body></body></html>`;
    const found = manifestsFromHtml(html);
    assert.equal(found.length, 1);
    assert.equal(diffClaims(m, found[0]).same, true);
  }
});

test('JSON-LD: an unknown claim has no value; a starting amount is minValue; native layer only uses current known claims', () => {
  const shop = manifests['shop.json'];
  const ld = manifestToJsonLd(shop, { now: new Date('2026-12-01T12:00:00Z') });
  const org = ld['@graph'].find((n) => n['@id'] === 'https://shop.example/#org');
  const pv = (id) => org.additionalProperty.find((p) => p['@id'].endsWith('/' + id));
  assert.equal('value' in pv('warranty'), false);
  assert.equal(pv('warranty')['so4ag:knowledgeState'], 'unknown');
  assert.equal(pv('ship-cz-pickup-min').value.minValue, '59.00');
  assert.equal('value' in pv('ship-cz-pickup-min').value, false);
  assert.equal(org.hasMerchantReturnPolicy, undefined, 'the old return period expired and the next one is not valid yet');
  assert.equal(org.paymentAccepted, 'Card online, Bank transfer, Cash on delivery', 'methods limited to business customers are not merged in');
  assert.equal(org.hasShippingService.length, 2, 'courier price and the free-shipping threshold; the starting price and the Saturday price (scope schema.org cannot carry) are left out');
  const later = nativeLayer(shop.claims, new Date('2026-12-20T00:00:00Z'));
  assert.equal(later.hasMerchantReturnPolicy[0].merchantReturnDays, 14);
  const agg = manifestToJsonLd({ ...shop, publisher: { ...shop.publisher, role: 'aggregator' } }, { now: new Date('2026-12-01T12:00:00Z') });
  assert.equal(agg['@graph'][1].paymentAccepted, undefined, 'no native markup for a third-party publisher');
});

test('JSON-LD: a changed value breaks the attestation after reading back', () => {
  const ld = JSON.parse(JSON.stringify(manifestToJsonLd(manifests['shop.json'], { now: new Date('2026-12-01T12:00:00Z') })));
  const org = ld['@graph'].find((n) => n['@id'] === 'https://shop.example/#org');
  org.additionalProperty.find((p) => p['@id'].endsWith('/payment-methods')).value.itemListElement.push({ '@type': 'DefinedTerm', termCode: 'cash' });
  const back = manifestFromJsonLd(ld);
  const r = validateManifest(back, { now: new Date('2026-12-01T12:00:00Z') });
  assert.ok(r.errors.some((e) => e.code === 'digest_mismatch'));
  assert.deepEqual(diffClaims(manifests['shop.json'], back).changed, ['https://shop.example/claims/payment-methods']);
});
