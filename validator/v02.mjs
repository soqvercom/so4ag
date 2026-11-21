// SO4AG 0.2 (draft): the same claims as 0.1 in a shorter file, plus three things 0.1 could not say:
//   defaults  – values shared by most claims are written once
//   usage     – what the publisher allows the data to be used for
//   live      – which properties must be asked live and where
//   view      – "current" files carry only claims that are valid or announced; history lives in revisions
// A 0.2 file expands to a 0.1 manifest with identical claims, so claim digests and attestations stay valid.
import { validateManifest, durationMs, claimDigest } from './index.mjs';

export const V02 = '0.2-draft';
export const EXT = 'https://soqver.com/spec/so4ag/0.2/terms#';
export const USAGE_PURPOSES = ['answer', 'quote', 'index', 'cache', 'train'];
export const LIVE_PROTOCOLS = ['so4ag-claims', 'mcp'];
const DEFAULT_KEYS = ['subject', 'assertion_basis', 'valid_from', 'valid_until', 'evidence', 'scope'];
const LINKS_01 = ['html', 'markdown', 'mcp', 'terms', 'corrections'];
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

export const is02 = (m) => m && typeof m === 'object' && m.so4ag === V02;

/** 0.2 -> 0.1 manifest with every claim written out in full. Does not validate. */
export function expand02(m) {
  const d = m.defaults || {};
  const claims = (m.claims || []).map((c) => {
    const out = { ...c };
    for (const k of DEFAULT_KEYS) {
      if (out[k] === null) delete out[k];                       // null = this claim has no such field, the default does not apply
      else if (!(k in out) && k in d) out[k] = structuredClone(d[k]);
    }
    if (!('scope' in out)) out.scope = {};
    // key order of a 0.1 claim, so the two files read the same; the digest does not depend on it
    const { id, revision, subject, property, knowledge_state, value, scope, assertion_basis, evidence, valid_from, valid_until, ...rest } = out;
    return { id, revision, subject, property, knowledge_state, ...(value !== undefined ? { value } : {}), scope, assertion_basis, ...(evidence !== undefined ? { evidence } : {}), valid_from, valid_until, ...rest };
  });
  const ext = { ...(m.extensions || {}) };
  if (m.usage) ext[EXT + 'usage'] = { affects_use: false, value: m.usage };
  if (m.live?.length) ext[EXT + 'live'] = { affects_use: false, value: m.live };
  const links = m.links ? Object.fromEntries(Object.entries(m.links).filter(([k]) => LINKS_01.includes(k))) : null;
  return {
    so4ag: '0.1-draft', id: m.id, revision: m.revision, published_at: m.published_at, publisher: m.publisher,
    ...(m.subjects ? { subjects: m.subjects } : {}), ...(m.profiles ? { profiles: m.profiles } : {}), claims,
    ...(links && Object.keys(links).length ? { links } : {}), ...(Object.keys(ext).length ? { extensions: ext } : {}),
  };
}

const mostCommon = (values) => {
  const n = new Map();
  for (const v of values) { const k = JSON.stringify(v); n.set(k, (n.get(k) || 0) + 1); }
  let best = null;
  for (const [k, c] of n) if (c >= 2 && (!best || c > best[1])) best = [k, c];
  return best ? JSON.parse(best[0]) : undefined;
};

/** 0.1 -> 0.2. view "current" drops claims that are no longer valid at `now` (announced ones stay). */
export function compact02(m, { view = 'current', now = new Date(), usage, live, links } = {}) {
  const t = now.getTime();
  const kept = m.claims.filter((c) => view !== 'current' || Date.parse(c.valid_until) > t);
  const defaults = {};
  for (const k of DEFAULT_KEYS) {
    const v = mostCommon(kept.filter((c) => k in c).map((c) => c[k]));
    if (v !== undefined) defaults[k] = v;
  }
  const claims = kept.map((c) => {
    const out = {};
    for (const [k, v] of Object.entries(c)) if (!(k in defaults && JSON.stringify(defaults[k]) === JSON.stringify(v))) out[k] = v;
    for (const k of Object.keys(defaults)) if (!(k in c)) out[k] = null;
    return out;
  });
  const ext = { ...(m.extensions || {}) };
  const u = usage ?? ext[EXT + 'usage']?.value; const l = live ?? ext[EXT + 'live']?.value;
  delete ext[EXT + 'usage']; delete ext[EXT + 'live'];
  return {
    so4ag: V02, id: m.id, revision: m.revision, published_at: m.published_at, publisher: m.publisher,
    ...(m.subjects ? { subjects: m.subjects } : {}), ...(m.profiles ? { profiles: m.profiles } : {}),
    view, ...(Object.keys(defaults).length ? { defaults } : {}), ...(u ? { usage: u } : {}), ...(l?.length ? { live: l } : {}),
    claims, ...(m.links || links ? { links: { ...(m.links || {}), ...(links || {}) } } : {}), ...(Object.keys(ext).length ? { extensions: ext } : {}),
  };
}

/** Structure of the parts 0.2 adds, then the full 0.1 validation of the expanded file. */
export function validate02(m, opts = {}) {
  const errors = []; const warnings = [];
  const err = (path, code, message) => errors.push({ path, code, message });
  if (m.view !== undefined && !['current', 'full'].includes(m.view)) err('/view', 'view', 'view must be "current" or "full"');
  if (m.defaults !== undefined) {
    if (!m.defaults || typeof m.defaults !== 'object' || Array.isArray(m.defaults)) err('/defaults', 'defaults', 'defaults must be an object');
    else for (const k of Object.keys(m.defaults)) if (!DEFAULT_KEYS.includes(k)) err(`/defaults/${k}`, 'defaults', `"${k}" cannot be a file default (allowed: ${DEFAULT_KEYS.join(', ')})`);
  }
  if (m.usage !== undefined) {
    const u = m.usage;
    if (!u || typeof u !== 'object' || Array.isArray(u)) err('/usage', 'usage', 'usage must be an object');
    else {
      for (const k of Object.keys(u)) if (!['terms', 'allowed', 'denied', 'attribution', 'note'].includes(k)) err(`/usage/${k}`, 'usage', `unknown key "${k}"`);
      for (const k of ['allowed', 'denied']) if (u[k] !== undefined && (!Array.isArray(u[k]) || u[k].some((x) => !USAGE_PURPOSES.includes(x)))) err(`/usage/${k}`, 'usage', `${k} must list purposes from: ${USAGE_PURPOSES.join(', ')}`);
      if (Array.isArray(u.allowed) && Array.isArray(u.denied) && u.allowed.some((x) => u.denied.includes(x))) err('/usage', 'usage_conflict', 'a purpose cannot be both allowed and denied');
      if (u.terms !== undefined && !isHttps(u.terms)) err('/usage/terms', 'usage', 'terms must be an https address');
      if (u.attribution !== undefined && !['required', 'none'].includes(u.attribution)) err('/usage/attribution', 'usage', 'attribution must be "required" or "none"');
      if (u.note !== undefined && (typeof u.note !== 'string' || u.note.length > 500)) err('/usage/note', 'usage', 'note must be a text of at most 500 characters');
    }
  }
  if (m.live !== undefined) {
    if (!Array.isArray(m.live)) err('/live', 'live', 'live must be a list');
    else m.live.forEach((l, i) => {
      if (!l || typeof l !== 'object') return err(`/live/${i}`, 'live', 'each entry must be an object');
      if (typeof l.property !== 'string' || !/^https?:/.test(l.property)) err(`/live/${i}/property`, 'live', 'property must be the URI of a property');
      if (!isHttps(l.endpoint)) err(`/live/${i}/endpoint`, 'live', 'endpoint must be an https address');
      if (!LIVE_PROTOCOLS.includes(l.protocol)) err(`/live/${i}/protocol`, 'live', `protocol must be one of: ${LIVE_PROTOCOLS.join(', ')}`);
      if (typeof l.max_age !== 'string' || !(durationMs(l.max_age) > 0)) err(`/live/${i}/max_age`, 'live', 'max_age must be an ISO 8601 duration such as PT1H');
    });
  }
  for (const k of ['signature', 'keys', 'history']) if (m.links?.[k] !== undefined && !isHttps(m.links[k])) err(`/links/${k}`, 'links', `${k} must be an https address`);
  let expanded = null; let core = { valid: false, errors: [], warnings: [], stats: undefined };
  try { expanded = expand02(m); core = validateManifest(expanded, opts); } catch (e) { err('', 'expand', String(e.message || e)); }
  if (m.view === 'current' && Array.isArray(m.claims) && m.published_at) {
    const t = Date.parse(m.published_at);
    (expanded?.claims || []).forEach((c, i) => { if (Date.parse(c.valid_until) <= t) err(`/claims/${i}`, 'expired_in_current_view', 'a file with view "current" must not carry a claim that was no longer valid when it was published'); });
  }
  const all = [...errors, ...core.errors];
  return { valid: all.length === 0, version: V02, errors: all, warnings: [...warnings, ...core.warnings], stats: core.stats, expanded };
}

/** One entry point for both versions. */
export function validateAny(m, opts = {}) {
  if (is02(m)) return validate02(m, opts);
  return validateManifest(m, opts);
}
/** The manifest in the 0.1 shape readers work with, whatever version came in. */
export const toCore = (m) => (is02(m) ? expand02(m) : m);

/** 'allowed' | 'denied' | 'not_stated' for a purpose (answer, quote, index, cache, train). */
export function usageFor(m, purpose) {
  const u = is02(m) ? m.usage : m.extensions?.[EXT + 'usage']?.value;
  if (!u) return 'not_stated';
  if (u.denied?.includes(purpose)) return 'denied';
  if (u.allowed?.includes(purpose)) return 'allowed';
  return 'not_stated';
}
/** Where to ask live for a property, or null. A stored claim older than max_age should be refreshed there before use. */
export function liveFor(m, property) {
  const l = is02(m) ? m.live : m.extensions?.[EXT + 'live']?.value;
  return (l || []).find((x) => x.property === property) || null;
}
export const sameClaims = (a, b) => { const d = (m) => toCore(m).claims.map((c) => `${c.id} ${claimDigest(c)}`).sort().join('\n'); return d(a) === d(b); };
