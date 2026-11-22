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
export const GENERAL = JSON.parse(readFileSync(join(SPEC, 'profiles', 'general-0.1.json'), 'utf8'));
export const PROFILE_SCHEMA = JSON.parse(readFileSync(join(SPEC, 'schema', 'profile-0.1.schema.json'), 'utf8'));
const LEGACY_HOST = 'https://soqver.botrento.com';   // draft namespace until 2026-11-20, equivalent (spec §0)
const legacy = (p) => ({ ...p, id: p.id.replace('https://soqver.com', LEGACY_HOST), namespace: p.namespace.replace('https://soqver.com', LEGACY_HOST) });
export const BUILTIN_PROFILES = { [GENERAL.id]: GENERAL, [RENTAL.id]: RENTAL, [legacy(RENTAL).id]: legacy(RENTAL), [RETAIL.id]: RETAIL };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateStructure = ajv.compile(SCHEMA);
const validateProfileStructure = ajv.compile(PROFILE_SCHEMA);

/**
 * Check a profile document (the General profile, an industry profile or a publisher's own profile).
 * Returns { valid, errors }. Beyond the schema: required scope keys must be defined, units need the quantity type, enum needs enum or enum_set.
 */
export function validateProfile(profile) {
  const errors = [];
  if (!validateProfileStructure(profile)) {
    for (const e of validateProfileStructure.errors) errors.push({ path: e.instancePath || '/', code: 'schema', message: e.message });
    return { valid: false, errors };
  }
  for (const [name, def] of Object.entries(profile.properties)) {
    const at = `/properties/${name}`;
    for (const k of def.required_scope || []) if (!(k in profile.scope_keys)) errors.push({ path: `${at}/required_scope`, code: 'scope_key_undefined', message: `scope key ${k} is not defined in scope_keys` });
    if (def.units && !def.value_types.includes('quantity')) errors.push({ path: `${at}/units`, code: 'units_without_quantity', message: 'units are allowed only with the value type quantity' });
    if (def.enum && !def.value_types.some((t) => t === 'enum' || t === 'enum_set')) errors.push({ path: `${at}/enum`, code: 'enum_without_type', message: 'enum is allowed only with the value types enum or enum_set' });
    if (def.max_validity && durationMs(def.max_validity) === null) errors.push({ path: `${at}/max_validity`, code: 'duration', message: 'max_validity is not an ISO 8601 duration' });
  }
  return { valid: errors.length === 0, errors };
}

/** The built-in profiles plus the given profile documents (a publisher's own profiles). Throws when one of them is not a valid profile. */
export function withProfiles(...extra) {
  const all = { ...BUILTIN_PROFILES };
  for (const p of extra.flat()) {
    const r = validateProfile(p);
    if (!r.valid) throw new Error(`not a valid SO4AG profile (${p && p.id}): ${r.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
    all[p.id] = p;
  }
  return all;
}

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

/** Edition of the rules this reader implements: the format version says how a document is written, the edition says how a
 *  reader decides. Every edition is an immutable tag of the public repository with its own conformance suite. */
export const SPEC_EDITION = '0.1.4';
/** The live rule of the 0.2 draft, carried as a source extension: listed properties must not be used older than max_age. */
export const LIVE_EXT = 'https://soqver.com/spec/so4ag/0.2/terms#live';
const instantOf = (x) => (x instanceof Date ? x.getTime() : Date.parse(x ?? ''));

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
  for (const p of declared) if (!profiles[p]) warnings.push({ path: '/profiles', code: 'profile_unknown', message: `profile ${p} is not known to this validator; pass its document (--profile) to check the claims against it` });

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
export function evaluateClaim(claim, task, { now = new Date(), profiles = BUILTIN_PROFILES, knownExtensions = [], sourceExtensions = null, sourcePublishedAt = null, liveCheckedAt = null } = {}) {
  // reasons block the use; warnings are reported and leave the decision to the consumer
  const out = { usable: false, reasons: [], warnings: [], value: null, state: claim?.knowledge_state };
  // This function expects a claim of a source that passed validateManifest (selectClaims checks that). A claim that is
  // visibly malformed is still never usable: no decision is made on dates or a scope that cannot be read.
  const wellFormed = claim && typeof claim === 'object' && claim.scope && typeof claim.scope === 'object' && !Array.isArray(claim.scope)
    && Number.isFinite(Date.parse(claim.valid_from)) && Number.isFinite(Date.parse(claim.valid_until))
    && ['known', 'unknown', 'not_applicable'].includes(claim.knowledge_state)
    && (claim.knowledge_state === 'known' ? claim.value != null && Array.isArray(claim.evidence) && claim.evidence.length > 0 : claim.value === undefined);
  if (!wellFormed) { out.reasons.push('invalid_claim'); return out; }
  if (task.property && claim.property !== task.property) out.reasons.push('property_mismatch');
  if (task.subject && claim.subject !== task.subject) out.reasons.push('subject_mismatch');
  const idx = propertyIndex(profiles);
  // Which scope keys the consumer can compare: the list it states, otherwise the keys of the profile that defines the property
  // plus every key the task itself gives a value for (asking with a key is saying what it means).
  const known = new Set(task.understoodScopeKeys || [...Object.keys(idx.get(claim.property)?.profile.scope_keys || {}), ...Object.keys(task.scope || {})]);
  for (const [k, v] of Object.entries(claim.scope)) {
    if (!known.has(k)) { out.reasons.push(`scope_not_comparable:${k}`); continue; }
    if (!(k in (task.scope || {}))) { out.reasons.push(`scope_not_in_task:${k}`); continue; }
    if (String(task.scope[k]) !== v && v !== 'any') out.reasons.push(`scope_mismatch:${k}`);
  }
  const t = now.getTime();
  if (t < Date.parse(claim.valid_from)) out.reasons.push('not_yet_valid');
  if (t >= Date.parse(claim.valid_until)) out.reasons.push('expired');
  // A disputed claim is reported. It blocks the use only when the task says so (a decision, not a quotation with a caveat).
  if (claim.dispute) (task.refuseDisputed ? out.reasons : out.warnings).push('disputed');
  if (claim.knowledge_state !== 'known') out.reasons.push(claim.knowledge_state);
  for (const [uri, ext] of [...Object.entries(sourceExtensions || {}), ...Object.entries(claim.extensions || {})]) {
    if (ext && ext.affects_use === true && uri !== LIVE_EXT && !knownExtensions.includes(uri)) out.reasons.push(`unknown_required_extension:${uri}`);
  }
  // Live rule: a property the publisher lists as live is usable only while the copy in hand is younger than max_age.
  // The age runs from the publication of the source, or from the moment the consumer says it asked the live endpoint.
  // Fetching is not done here: without a fresh copy the answer is needs_refresh, never a stale value.
  const liveRules = sourceExtensions?.[LIVE_EXT]?.value;
  const liveRule = Array.isArray(liveRules) ? liveRules.find((l) => l && l.property === claim.property) : null;
  if (liveRule) {
    const max = durationMs(liveRule.max_age);
    const asOf = instantOf(liveCheckedAt ?? sourcePublishedAt);
    if (!(max > 0) || !Number.isFinite(asOf) || asOf > t + 5 * 60e3 || t - asOf > max) out.reasons.push('needs_refresh');
  }
  if (task.requireReview) {
    if (!Array.isArray(task.trustedIssuers)) out.reasons.push('no_trust_policy');
    else {
      const digest = claimDigest(claim);
      // a matching digest only ties the attestation to this wording; whether the issuer is trusted is the consumer's own list
      const matching = (claim.attestations || []).filter((a) => a.claim_digest === digest && a.issuer_relation === 'independent' && task.trustedIssuers.includes(a.issuer)
        && Date.parse(a.issued_at) <= t && Date.parse(a.expires_at) > t);
      // The attestation sits in the publisher's own file, so its issuer field proves nothing: anyone can write a trusted
      // name there. It counts only when the consumer has authenticated it with the issuer (a verified credential or the
      // issuer's own status record) and lists its id in authenticatedAttestations.
      const authenticated = Array.isArray(task.authenticatedAttestations) ? task.authenticatedAttestations : [];
      if (!matching.length) out.reasons.push('no_valid_independent_attestation');
      else if (!matching.some((a) => authenticated.includes(a.id))) out.reasons.push('attestation_not_authenticated');
    }
  }
  out.usable = out.reasons.length === 0;
  if (out.usable) out.value = claim.value;
  return out;
}

/**
 * The safe way to read a source: pick the claims for a property and a task scope; returns the evaluated list, usable first.
 * The source is checked first (version, then validateManifest); a source that fails yields no usable claim (invalid_source).
 * When several usable claims answer the same subject and property with different values, the most specific one wins
 * (its scope limits every key the others limit, and more); the others get less_specific. When no claim is the most
 * specific, or the most specific ones disagree, all of them are refused (conflicting_claims): no silent winner.
 * opts.validated = true skips the check for a source the caller has validated already.
 */
export function selectClaims(manifest, task, opts = {}) {
  const version = checkVersion(manifest);
  const claims = Array.isArray(manifest?.claims) ? manifest.claims : [];
  const refuse = (code) => claims.filter((c) => !task.property || c?.property === task.property)
    .map((c) => ({ claim: c, result: { usable: false, reasons: [code], warnings: [], value: null, state: c?.knowledge_state } }));
  // a source of a version this reader does not know is never evaluated by the rules of another version
  if (!version.ok) return refuse(version.code);
  if (!opts.validated && !validateManifest(manifest, { profiles: opts.profiles || BUILTIN_PROFILES, now: opts.now || new Date() }).valid) return refuse('invalid_source');
  const out = claims
    .filter((c) => !task.property || c.property === task.property)
    .map((c) => ({ claim: c, result: evaluateClaim(c, task, { ...opts, sourceExtensions: manifest.extensions || null, sourcePublishedAt: manifest.published_at ?? null }) }));
  const groups = new Map();
  for (const x of out.filter((y) => y.result.usable)) {
    const key = canonicalize([x.claim.subject, x.claim.property]);
    groups.set(key, [...(groups.get(key) || []), x]);
  }
  const refuse1 = (x, code) => { x.result = { ...x.result, usable: false, value: null, reasons: [...x.result.reasons, code] }; };
  for (const g of groups.values()) {
    if (new Set(g.map((x) => canonicalize(x.claim.value))).size < 2) continue;      // they all say the same
    // the keys a claim really limits ("any" limits nothing); every usable claim agrees with the task on them
    const limits = g.map((x) => Object.entries(x.claim.scope).filter(([, v]) => v !== 'any').map(([k]) => k));
    const within = (a, b) => a.every((k) => b.includes(k));
    const top = g.filter((_, i) => !g.some((__, j) => j !== i && limits[j].length > limits[i].length && within(limits[i], limits[j])));
    const ordered = new Set(top.map((x) => canonicalize(x.claim.value))).size === 1
      && g.every((x, i) => top.includes(x) || top.every((y) => within(limits[i], limits[g.indexOf(y)])));
    for (const x of g) { if (!ordered) refuse1(x, 'conflicting_claims'); else if (!top.includes(x)) refuse1(x, 'less_specific'); }
  }
  return out.sort((a, b) => Number(b.result.usable) - Number(a.result.usable));
}
