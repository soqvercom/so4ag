// SO4AG Worker: serves https://<your domain>/so4ag.json in front of any website whose domain goes through Cloudflare.
//
// Two modes, chosen by the SOURCE_URL variable:
//   embedded  SOURCE_URL is empty: the Worker serves the file so4ag.json that sits next to wrangler.jsonc.
//   remote    SOURCE_URL is an https address: the Worker reads the source from there (for example a source kept at
//             SOQVER, https://soqver.com/s/<slug>/own/so4ag.json), keeps the last good copy and serves it.
//
// The Worker never serves a source whose identifiers are on a different domain than the one it runs on.
// Every other address is passed to the website untouched.
//
// Counting (optional, COUNT_URL and COUNT_KEY set, route domain/*): for a request of a known AI crawler or a visit that
// came from the link of an AI assistant, the Worker sends one small event to the counter after the website answered.
// It sends only the crawler name or the assistant host: never an address, a cookie, a path or anything about the visitor.
import embeddedSource from '../so4ag.json' with { type: 'json' };

const VERSION = '0.2.0';
const SOURCE_FILE = 'so4ag.json';
// Address on the company domain -> file name next to the source.
const PATHS = { '/so4ag.json': SOURCE_FILE, '/so4ag.sig.json': 'so4ag.sig.json', '/.well-known/so4ag-keys.json': 'so4ag-keys.json' };
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 5 * 1024 * 1024;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.workers\.dev$/;

/** Names AI crawlers send in their user agent (the same list SOQVER counts). */
export const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'meta-externalagent', 'CCBot', 'Bytespider', 'Amazonbot', 'DuckAssistBot', 'MistralAI-User'];
/** Hosts of AI assistants whose links bring people to a website. */
export const ASSISTANT_HOSTS = ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai', 'chat.deepseek.com', 'duck.ai', 'you.com', 'meta.ai', 'grok.com', 'chat.mistral.ai'];

const memory = new Map(); // per isolate: remote address -> { body, at, etag }

const bare = (host) => String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
const num = (v, fallback, min) => { const n = Number(v); return Number.isFinite(n) && n >= min ? n : fallback; };

function settings(env = {}) {
  const src = String(env.SOURCE_URL || '').trim();
  return {
    sourceUrl: src,
    domain: bare(String(env.DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')),
    refresh: num(env.REFRESH_SECONDS, 300, 60),
    maxStale: num(env.MAX_STALE_SECONDS, 7 * 86400, 0),
  };
}

async function etagOf(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return '"' + [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('') + '"';
}

function problem(status, error, message, extra = {}) {
  return new Response(JSON.stringify({ error, message }, null, 2) + '\n', {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-so4ag-worker': `${VERSION}; error`, ...extra },
  });
}

function reply(request, body, etag, state, maxAge) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${maxAge}`,
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'x-so4ag-worker': `${VERSION}; ${state}`,
    etag,
  };
  const seen = request.headers.get('if-none-match');
  if (seen && seen.split(',').map((s) => s.trim().replace(/^W\//, '')).includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
}

/** Why this document must not be served from this domain; null when it may. */
function refusal(file, doc, expected) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'the document is not a JSON object';
  if (file === 'so4ag-keys.json') return Array.isArray(doc.keys) ? null : 'the key document has no "keys" list';
  if (file === 'so4ag.sig.json') return typeof doc.signature === 'string' ? null : 'the signature document has no "signature"';
  if (typeof doc.so4ag !== 'string' || !Array.isArray(doc.claims) || typeof doc.id !== 'string') return 'the document is not a SO4AG source (it needs "so4ag", "id" and "claims")';
  if (!expected) return null;
  let host;
  try { host = bare(new URL(doc.id).hostname); } catch { return 'the "id" of the source is not an address'; }
  if (host !== expected) return `the identifiers of the source are on ${host}, this Worker serves ${expected}`;
  const pub = doc.publisher && typeof doc.publisher.id === 'string' ? doc.publisher.id : null;
  if (pub) { try { if (bare(new URL(pub).hostname) !== expected) return `the publisher of the source is on ${bare(new URL(pub).hostname)}, this Worker serves ${expected}`; } catch { return 'the "id" of the publisher is not an address'; } }
  return null;
}

async function fetchText(fetcher, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': `so4ag-worker/${VERSION} (+https://soqver.com/developers)` }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) return { status: r.status };
    const text = await r.text();
    if (text.length > MAX_BYTES) return { status: 0, reason: 'the source is larger than 5 MB' };
    return { status: 200, text };
  } catch (e) {
    return { status: 0, reason: String(e && e.message || e).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

/** The remote file with two layers of the last good copy: the memory of this isolate and the Cloudflare cache. */
async function remote(file, cfg, expected, request, ctx, deps) {
  const base = new URL(cfg.sourceUrl);
  if (file !== SOURCE_FILE) {
    if (!base.pathname.endsWith('/' + SOURCE_FILE)) return null;       // no sibling files to offer: let the website answer
    base.pathname = base.pathname.slice(0, -SOURCE_FILE.length) + file;
  }
  const url = base.toString();
  const now = Date.now();
  const cache = deps.caches && deps.caches.default;
  const key = new Request(`https://${new URL(request.url).hostname}/__so4ag-worker/${file}?from=${encodeURIComponent(url)}`);

  let copy = memory.get(url) || null;
  if (!copy && cache) {
    try {
      const hit = await cache.match(key);
      if (hit) copy = { body: await hit.text(), at: Number(hit.headers.get('x-fetched-at')) || 0, etag: hit.headers.get('etag') || '' };
    } catch { /* the cache is a convenience, never a reason to fail */ }
  }
  // A kept copy is checked again: the settings of the Worker may have changed since it was stored.
  if (copy) { try { if (refusal(file, JSON.parse(copy.body), expected)) copy = null; } catch { copy = null; } }
  const age = copy ? (now - copy.at) / 1000 : Infinity;
  if (copy && age < cfg.refresh) { memory.set(url, copy); return reply(request, copy.body, copy.etag, 'cached', cfg.refresh); }

  const got = await fetchText(deps.fetch, url);
  let why = got.status === 200 ? null : got.reason || `the source answered ${got.status}`;
  if (!why) {
    let doc;
    try { doc = JSON.parse(got.text); } catch { why = 'the source is not valid JSON'; }
    if (!why) why = refusal(file, doc, expected);
    if (!why) {
      const fresh = { body: got.text, at: now, etag: await etagOf(got.text) };
      memory.set(url, fresh);
      if (cache && cfg.maxStale > 0) {
        const keep = new Response(fresh.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${Math.max(cfg.maxStale, cfg.refresh)}`, 'x-fetched-at': String(now), etag: fresh.etag } });
        const put = cache.put(key, keep).catch(() => {});
        if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
      }
      return reply(request, fresh.body, fresh.etag, 'fresh', cfg.refresh);
    }
  }
  // A wrong document is never served, and a source that was withdrawn stops being served.
  // A copy that was good earlier is served only while the source cannot be reached (no answer, 429, 5xx).
  const down = got.status === 0 || got.status === 429 || got.status >= 500;
  if (copy && down && age < cfg.maxStale) return reply(request, copy.body, copy.etag, 'stale', 60);
  memory.delete(url);
  if (got.status === 200) return problem(502, 'source_refused', `The Worker did not serve ${file}: ${why}.`);
  if (!down) return problem(got.status === 404 || got.status === 410 ? 404 : 502, 'source_missing', `The source has no ${file} (${why}).`);
  return problem(503, 'source_unreachable', `The Worker could not read ${file} from its source: ${why}.`, { 'retry-after': '60' });
}

/** The one event a request is worth counting for, or null. Only a name or a host, nothing about the visitor. */
export function countEvent(request) {
  const ua = String(request.headers.get('user-agent') || '').toLowerCase();
  const bot = ua ? AI_CRAWLERS.find((b) => ua.includes(b.toLowerCase())) : null;
  if (bot) return { t: 'bot', n: bot };
  let ref = '';
  try { ref = bare(new URL(request.headers.get('referer') || '').hostname); } catch { /* no referrer */ }
  const host = ref && ASSISTANT_HOSTS.find((h) => ref === h || ref.endsWith('.' + h));
  if (host) return { t: 'ref', h: host };
  let utm = '';
  try { utm = bare(new URL(request.url).searchParams.get('utm_source') || ''); } catch { /* none */ }
  const tagged = utm && ASSISTANT_HOSTS.find((h) => utm === h);  // ChatGPT adds utm_source=chatgpt.com to its links
  return tagged ? { t: 'ref', h: tagged } : null;
}

function counting(request, env, ctx, d) {
  const url = String(env.COUNT_URL || '').trim(); const key = String(env.COUNT_KEY || '').trim();
  if (!/^https:\/\//i.test(url) || !key || !ctx || !ctx.waitUntil) return;
  const e = countEvent(request);
  if (!e) return;
  const post = Promise.resolve().then(() => d.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-soqver-key': key, 'user-agent': `so4ag-worker/${VERSION}` }, body: JSON.stringify({ events: [e] }) })).catch(() => {});
  ctx.waitUntil(post);                                                   // after the answer: counting never slows the website down
}

export async function handle(request, env, ctx, deps = {}) {
  const d = { fetch: deps.fetch || ((...a) => fetch(...a)), caches: deps.caches || (typeof caches !== 'undefined' ? caches : null), embedded: deps.embedded || embeddedSource };
  const url = new URL(request.url);
  counting(request, env || {}, ctx, d);
  const file = PATHS[url.pathname];
  const host = bare(url.hostname);
  // Not ours: the website answers as before. A preview address has no website behind it, so it says so.
  const pass = () => (LOCAL.test(host) ? problem(404, 'not_found', 'This Worker serves /so4ag.json. On your own domain every other address is answered by your website.') : d.fetch(request));
  if (!file) return pass();
  if (request.method !== 'GET' && request.method !== 'HEAD') return problem(405, 'method_not_allowed', 'Only GET and HEAD are served here.', { allow: 'GET, HEAD' });

  const cfg = settings(env);
  const expected = cfg.domain || (LOCAL.test(host) ? '' : host);       // on a preview address nothing can be compared unless DOMAIN is set

  if (cfg.sourceUrl) {
    if (!/^https:\/\//i.test(cfg.sourceUrl)) return problem(500, 'bad_configuration', 'SOURCE_URL must be an https address.');
    const r = await remote(file, cfg, expected, request, ctx, d);
    return r || pass();
  }
  if (file !== SOURCE_FILE) return pass();                              // the embedded mode has one file
  const why = refusal(file, d.embedded, expected);
  if (why) return problem(500, 'source_refused', `The Worker did not serve so4ag.json: ${why}. Replace so4ag.json in the Worker with the source of this domain and deploy again.`);
  const body = JSON.stringify(d.embedded, null, 2) + '\n';
  return reply(request, body, await etagOf(body), 'embedded', cfg.refresh);
}

export default { fetch: (request, env, ctx) => handle(request, env, ctx) };
