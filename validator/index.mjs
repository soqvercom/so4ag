// SO4AG 0.1 reference validator and consumer helpers (Apache-2.0).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = join(here, '..', 'spec');
export const SCHEMA = JSON.parse(readFileSync(join(SPEC, 'schema', 'so4ag-0.1.schema.json'), 'utf8'));
export const RENTAL = JSON.parse(readFileSync(join(SPEC, 'profiles', 'rental-0.1.json'), 'utf8'));
export const RETAIL = JSON.parse(readFileSync(join(SPEC, 'profiles', 'retail-0.1.json'), 'utf8'));
const LEGACY_HOST = 'https://soqver.botrento.com';   // draft namespace until 2026-11-20, equivalent (spec §0)
const legacy = (p) => ({ ...p, id: p.id.replace('https://soqver.com', LEGACY_HOST), namespace: p.namespace.replace('https://soqver.com', LEGACY_HOST) });
export const BUILTIN_PROFILES = { [RENTAL.id]: RENTAL, [legacy(RENTAL).id]: legacy(RENTAL), [RETAIL.id]: RETAIL };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateStructure = ajv.compile(SCHEMA);

// RFC 8785 (JCS) canonical JSON for the value types used by SO4AG.
export function canonicalize(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
}

export function claimDigest(claim) {
  const { attestations, ...rest } = claim;
  return 'sha256:' + createHash('sha256').update(canonicalize(rest), 'utf8').digest('hex');
}

// ISO 8601 duration (subset: PnYnMnDTnHnMnS) to milliseconds, months = 30 d, years = 365 d.
export function durationMs(d) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d || '');
  if (!m) return null;
  const [, y, mo, w, da, h, mi, s] = m.map((x) => Number(x || 0));
  return ((((y * 365 + mo * 30 + w * 7 + da) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

function propertyIndex(profiles) {
  const idx = new Map();
  for (const p of Object.values(profiles)) {
    for (const [name, def] of Object.entries(p.properties)) idx.set(p.namespace + name, { name, def, profile: p });
  }
  return idx;
}

// opening hours in the schema.org form: Mo-Fr 09:00-18:00; Sa 09:00-12:00
const OPENING_HOURS = /^(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)* (?:[01]\d|2[0-4]):[0-5]\d-(?:[01]\d|2[0-4]):[0-5]\d(?:; (?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)* (?:[01]\d|2[0-4]):[0-5]\d-(?:[01]\d|2[0-4]):[0-5]\d)*$/;

/** Versions of the format this implementation reads. A document with any other version is not evaluated at all. */
export const SUPPORTED_VERSIONS = ['0.1-draft'];
/** Is this a version the reader may evaluate? Reading the JSON alone is not a successful reading of a source. */
export function checkVersion(doc) {
  const version = doc && typeof doc === 'object' ? doc.so4ag : undefined;
  if (version === undefined) return { ok: false, code: 'missing_version', version: null };
  return SUPPORTED_VERSIONS.includes(version) ? { ok: true, version } : { ok: false, code: 'unsupported_version', version: String(version) };
}

// ISO 4217 codes in use and the number of decimals of each currency. An amount is written with exactly that many decimals.
const CUR = 'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UYW UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG'.split(' ');
const CUR_DECIMALS = { ...Object.fromEntries(CUR.map((c) => [c, 2])), ...Object.fromEntries('BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF'.split(' ').map((c) => [c, 0])),
  ...Object.fromEntries('BHD IQD JOD KWD LYD OMR TND'.split(' ').map((c) => [c, 3])), CLF: 4, UYW: 4 };
/** Number of decimals of an ISO 4217 currency, or null when the code is not a currency in use. */
export const currencyDecimals = (code) => (Object.hasOwn(CUR_DECIMALS, code) ? CUR_DECIMALS[code] : null);

/**
 * Validate a manifest. Returns {valid, errors[], warnings[], stats}.
 * errors: structure or semantic violations; warnings: allowed but risky.
 */
export function validateManifest(manifest, { profiles = BUILTIN_PROFILES, now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  if (!validateStructure(manifest)) {
    for (const e of validateStructure.errors.slice(0, 50)) {
      errors.push({ path: e.instancePath || '/', code: 'schema', message: `${e.message}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}` });
    }
    return { valid: false, errors, warnings, stats: null };
  }
  const idx = propertyIndex(profiles);
  const declared = new Set(manifest.profiles || []);
  const ids = new Set();
  const stats = { claims: manifest.claims.length, known: 0, unknown: 0, not_applicable: 0, current: 0, expired: 0, future: 0, attested: 0, disputed: 0 };
  for (const p of declared) if (!profiles[p]) warnings.push({ path: '/profiles', code: 'profile_unknown', message: `profile ${p} is not known to this validator` });

  manifest.claims.forEach((c, i) => {
    const at = `/claims/${i}`;
    if (ids.has(c.id)) errors.push({ path: at + '/id', code: 'duplicate_id', message: `duplicate claim id ${c.id}` });
    ids.add(c.id);
    stats[c.knowledge_state]++;
    const from = Date.parse(c.valid_from), until = Date.parse(c.valid_until);
    if (!(until > from)) errors.push({ path: at + '/valid_until', code: 'time_order', message: 'valid_until must be later than valid_from' });
    const t = now.getTime();
    if (t < from) stats.future++; else if (t >= until) stats.expired++; else stats.current++;
    if (c.dispute) stats.disputed++;
    if (c.attestations?.length) stats.attested++;
    if (c.assertion_basis === 'independently_reviewed' && !c.attestations?.length) {
      errors.push({ path: at + '/assertion_basis', code: 'review_without_attestation', message: 'independently_reviewed requires at least one attestation' });
    }
    for (const [j, ev] of (c.evidence || []).entries()) {
      if (Date.parse(ev.observed_at) > t + 5 * 60e3) errors.push({ path: `${at}/evidence/${j}/observed_at`, code: 'future_observation', message: 'evidence observed in the future' });
    }
    if (c.value?.type === 'place' && c.value.opening_hours && !OPENING_HOURS.test(c.value.opening_hours)) warnings.push({ path: at + '/value/opening_hours', code: 'opening_hours_format', message: 'opening_hours should use the schema.org form, e.g. Mo-Fr 09:00-18:00; Sa 09:00-12:00' });
    if (c.value?.type === 'money') {
      const dec = currencyDecimals(c.value.currency);
      if (dec === null) errors.push({ path: at + '/value/currency', code: 'currency', message: 'currency must be an ISO 4217 code in use' });
      else if ((c.value.amount.split('.')[1] || '').length !== dec) errors.push({ path: at + '/value/amount', code: 'amount_precision', message: `${c.value.currency} amounts are written with exactly ${dec} decimals` });
    }

    const digest = claimDigest(c);
    for (const [j, a] of (c.attestations || []).entries()) {
      if (a.claim_digest !== digest) errors.push({ path: `${at}/attestations/${j}/claim_digest`, code: 'digest_mismatch', message: 'attestation does not match the current claim (claim changed after review)' });
      if (!(Date.parse(a.expires_at) > Date.parse(a.issued_at))) errors.push({ path: `${at}/attestations/${j}/expires_at`, code: 'time_order', message: 'expires_at must be later than issued_at' });
      if (Date.parse(a.issued_at) > t + 5 * 60e3) errors.push({ path: `${at}/attestations/${j}/issued_at`, code: 'future_attestation', message: 'attestation issued in the future' });
      if (manifest.publisher.role === 'related_party' && a.issuer_relation === 'independent' && a.issuer === manifest.publisher.id) {
        errors.push({ path: `${at}/attestations/${j}`, code: 'self_independent', message: 'publisher cannot attest itself as independent' });
      }
    }

    const p = idx.get(c.property);
    if (!p) {
      warnings.push({ path: at + '/property', code: 'property_unknown', message: `property ${c.property} is not defined by a known profile` });
      return;
    }
    if (!declared.has(p.profile.id)) warnings.push({ path: at + '/property', code: 'profile_not_declared', message: `property belongs to ${p.profile.id} which is not listed in profiles` });
    const def = p.def;
    for (const k of def.required_scope || []) {
      if (!(k in c.scope)) errors.push({ path: at + '/scope', code: 'scope_missing', message: `${p.name} requires scope key ${k}` });
    }
    for (const k of Object.keys(c.scope)) {
      if (!(k in (p.profile.scope_keys || {}))) warnings.push({ path: `${at}/scope/${k}`, code: 'scope_key_unknown', message: `scope key ${k} is not defined by the profile; consumers will treat the claim as not comparable` });
    }
    if (c.value) {
      if (!def.value_types.includes(c.value.type)) errors.push({ path: at + '/value/type', code: 'value_type', message: `${p.name} allows ${def.value_types.join(', ')}` });
      if (c.value.type === 'quantity' && def.units && !def.units.includes(c.value.unit)) errors.push({ path: at + '/value/unit', code: 'unit', message: `${p.name} allows units ${def.units.join(', ')}` });
      if (c.value.type === 'enum' && def.enum && !def.enum.includes(c.value.value)) errors.push({ path: at + '/value/value', code: 'enum', message: `${p.name} allows ${def.enum.join(', ')}` });
      if (c.value.type === 'enum_set' && def.enum) {
        const bad = c.value.values.filter((v) => !def.enum.includes(v));
        if (bad.length) errors.push({ path: at + '/value/values', code: 'enum', message: `unknown codes ${bad.join(', ')}` });
      }
    }
    const max = durationMs(def.max_validity);
    if (max && until - from > max) warnings.push({ path: at + '/valid_until', code: 'validity_too_long', message: `${p.name} should be valid at most ${def.max_validity}` });
  });
  return { valid: errors.length === 0, errors, warnings, stats };
}

/**
 * Consumer helper: may this claim be used for a task now?
 * task = { property, subject?, scope: {key: value}, understoodScopeKeys?: string[], requireReview?: bool, trustedIssuers?: string[] }
 * options: knownExtensions = URIs of the extensions this consumer implements; sourceExtensions = `extensions` of the whole source.
 * An extension marked affects_use that the consumer does not implement makes the claim unusable.
 * requireReview needs an explicit list of trusted issuers: without that policy nothing counts as independently reviewed.
 */
export function evaluateClaim(claim, task, { now = new Date(), profiles = BUILTIN_PROFILES, knownExtensions = [], sourceExtensions = null } = {}) {
  const out = { usable: false, reasons: [], value: null, state: claim.knowledge_state };
  if (task.property && claim.property !== task.property) out.reasons.push('property_mismatch');
  if (task.subject && claim.subject !== task.subject) out.reasons.push('subject_mismatch');
  const idx = propertyIndex(profiles);
  const known = new Set(task.understoodScopeKeys || Object.keys(idx.get(claim.property)?.profile.scope_keys || {}));
  for (const [k, v] of Object.entries(claim.scope)) {
    if (!known.has(k)) { out.reasons.push(`scope_not_comparable:${k}`); continue; }
    if (!(k in (task.scope || {}))) { out.reasons.push(`scope_not_in_task:${k}`); continue; }
    if (String(task.scope[k]) !== v && v !== 'any') out.reasons.push(`scope_mismatch:${k}`);
  }
  const t = now.getTime();
  if (t < Date.parse(claim.valid_from)) out.reasons.push('not_yet_valid');
  if (t >= Date.parse(claim.valid_until)) out.reasons.push('expired');
  if (claim.dispute) out.reasons.push('disputed');
  if (claim.knowledge_state !== 'known') out.reasons.push(claim.knowledge_state);
  for (const [uri, ext] of [...Object.entries(sourceExtensions || {}), ...Object.entries(claim.extensions || {})]) {
    if (ext && ext.affects_use === true && !knownExtensions.includes(uri)) out.reasons.push(`unknown_required_extension:${uri}`);
  }
  if (task.requireReview) {
    if (!Array.isArray(task.trustedIssuers)) out.reasons.push('no_trust_policy');
    else {
      const digest = claimDigest(claim);
      // a matching digest only ties the attestation to this wording; whether the issuer is trusted is the consumer's own list
      const ok = (claim.attestations || []).some((a) => a.claim_digest === digest && a.issuer_relation === 'independent' && task.trustedIssuers.includes(a.issuer)
        && Date.parse(a.issued_at) <= t && Date.parse(a.expires_at) > t);
      if (!ok) out.reasons.push('no_valid_independent_attestation');
    }
  }
  const blocking = out.reasons.filter((r) => r !== 'disputed');
  out.usable = blocking.length === 0;
  if (out.usable) out.value = claim.value;
  return out;
}

/** Pick claims for a property and task scope; returns evaluated list, usable first. */
export function selectClaims(manifest, task, opts = {}) {
  const version = checkVersion(manifest);
  return (Array.isArray(manifest.claims) ? manifest.claims : [])
    .filter((c) => !task.property || c.property === task.property)
    .map((c) => {
      // a source of a version this reader does not know is never evaluated by the rules of another version
      if (!version.ok) return { claim: c, result: { usable: false, reasons: [version.code], value: null, state: c.knowledge_state } };
      return { claim: c, result: evaluateClaim(c, task, { ...opts, sourceExtensions: manifest.extensions || null }) };
    })
    .sort((a, b) => Number(b.result.usable) - Number(a.result.usable));
}
