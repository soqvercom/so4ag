// Runs in plain Node: the handler takes its fetch, cache and embedded source as arguments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../src/index.js';

const example = JSON.parse(readFileSync(new URL('../so4ag.json', import.meta.url), 'utf8'));
const onDomain = (domain) => JSON.parse(JSON.stringify(example).replaceAll('example.com', domain));

/** A website behind the Worker and a remote source, both counted. */
function world({ source, sig, keys, status = 200 } = {}) {
  const w = { origin: 0, upstream: 0, status, source, sig, keys, down: false, store: new Map() };
  w.fetch = async (input) => {
    if (input instanceof Request) { w.origin++; return new Response('the website', { status: 200, headers: { 'x-from': 'origin' } }); }
    w.upstream++;
    if (w.down) throw new Error('connection refused');
    if (w.status !== 200) return new Response('no', { status: w.status });
    const u = String(input);
    const doc = u.endsWith('/so4ag.sig.json') ? w.sig : u.endsWith('/so4ag-keys.json') ? w.keys : w.source;
    if (doc === undefined) return new Response('not found', { status: 404 });
    return new Response(typeof doc === 'string' ? doc : JSON.stringify(doc), { status: 200 });
  };
  w.caches = { default: {
    match: async (req) => { const hit = w.store.get(req.url); return hit ? new Response(hit.body, { headers: hit.headers }) : undefined; },
    put: async (req, res) => { w.store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) }); },
  } };
  return w;
}
const ask = async (w, url, env = {}, init = {}) => {
  const pending = [];
  const r = await handle(new Request(url, init), env, { waitUntil: (p) => pending.push(p) }, { fetch: w.fetch, caches: w.caches, embedded: w.embedded });
  await Promise.all(pending);                                      // what the runtime finishes after the response
  return r;
};
let n = 0;
const remoteEnv = (extra = {}) => ({ SOURCE_URL: `https://soqver.com/s/firma-${++n}/own/so4ag.json`, ...extra });   // a new address per test: the memory of the module is shared

test('embedded: the file is served on its own domain, with and without www, and nothing else is touched', async () => {
  const w = world();
  const r = await ask(w, 'https://example.com/so4ag.json');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('x-so4ag-worker'), /embedded$/);
  assert.deepEqual(await r.json(), example);
  assert.equal((await ask(w, 'https://www.example.com/so4ag.json?x=1')).status, 200);
  assert.equal(w.origin, 0);
  const other = await ask(w, 'https://example.com/kontakt');
  assert.equal(other.headers.get('x-from'), 'origin');
  assert.equal((await ask(w, 'https://example.com/so4ag.sig.json')).headers.get('x-from'), 'origin');
  assert.equal(w.origin, 2);
});

test('embedded: a source of another domain is refused with an explanation, never served', async () => {
  const w = world();
  const r = await ask(w, 'https://jina-firma.cz/so4ag.json');
  assert.equal(r.status, 500);
  const b = await r.json();
  assert.equal(b.error, 'source_refused');
  assert.match(b.message, /identifiers of the source are on example\.com, this Worker serves jina-firma\.cz/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  // DOMAIN says which domain the source belongs to, for example while the Worker runs on a subdomain
  assert.equal((await ask(w, 'https://shop.example.com/so4ag.json', { DOMAIN: 'https://Example.com/' })).status, 200);
  // a preview address has nothing to compare with unless DOMAIN is set
  assert.equal((await ask(w, 'https://so4ag-worker.someone.workers.dev/so4ag.json')).status, 200);
  assert.equal((await ask(w, 'https://so4ag-worker.someone.workers.dev/so4ag.json', { DOMAIN: 'jina-firma.cz' })).status, 500);
  assert.equal((await ask(w, 'http://localhost:8787/so4ag.json')).status, 200);
  // a preview address has no website behind it: other addresses answer 404 instead of calling the Worker again
  const before = w.origin;
  assert.equal((await ask(w, 'https://so4ag-worker.someone.workers.dev/kontakt')).status, 404);
  assert.equal((await ask(w, 'http://localhost:8787/so4ag.sig.json')).status, 404);
  assert.equal(w.origin, before);
});

test('embedded: a file that is not a source is refused', async () => {
  const w = world(); w.embedded = { hello: 'world' };
  const r = await ask(w, 'https://example.com/so4ag.json');
  assert.equal(r.status, 500);
  assert.match((await r.json()).message, /not a SO4AG source/);
});

test('methods and conditional requests', async () => {
  const w = world();
  assert.equal((await ask(w, 'https://example.com/so4ag.json', {}, { method: 'POST' })).status, 405);
  const head = await ask(w, 'https://example.com/so4ag.json', {}, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const etag = head.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  assert.equal((await ask(w, 'https://example.com/so4ag.json', {}, { headers: { 'if-none-match': etag } })).status, 304);
  assert.equal((await ask(w, 'https://example.com/so4ag.json', {}, { headers: { 'if-none-match': 'W/' + etag } })).status, 304);
  assert.equal((await ask(w, 'https://example.com/so4ag.json', {}, { headers: { 'if-none-match': '"other"' } })).status, 200);
  // a POST to any other address belongs to the website
  assert.equal((await ask(w, 'https://example.com/kontakt', {}, { method: 'POST', body: 'a=1' })).headers.get('x-from'), 'origin');
});

test('remote: the source is read once, then served from the copy until it is due', async () => {
  const w = world({ source: onDomain('firma.cz') });
  const env = remoteEnv();
  const a = await ask(w, 'https://firma.cz/so4ag.json', env);
  assert.equal(a.status, 200);
  assert.match(a.headers.get('x-so4ag-worker'), /fresh$/);
  assert.equal((await a.json()).id, 'https://firma.cz/so4ag.json');
  const b = await ask(w, 'https://www.firma.cz/so4ag.json', env);
  assert.match(b.headers.get('x-so4ag-worker'), /cached$/);
  assert.equal(w.upstream, 1);
  assert.equal(a.headers.get('etag'), b.headers.get('etag'));
  assert.equal(w.store.size, 1);
});

test('remote: a source of another company or another domain is refused', async () => {
  const w = world({ source: onDomain('cizi-firma.cz') });
  const r = await ask(w, 'https://firma.cz/so4ag.json', remoteEnv());
  assert.equal(r.status, 502);
  assert.match((await r.json()).message, /identifiers of the source are on cizi-firma\.cz, this Worker serves firma\.cz/);
  assert.equal(w.store.size, 0);
  const mixed = onDomain('firma.cz'); mixed.publisher.id = 'https://soqver.com/#org';
  assert.equal((await ask(world({ source: mixed }), 'https://firma.cz/so4ag.json', remoteEnv())).status, 502);
  assert.equal((await ask(world({ source: 'this is not json' }), 'https://firma.cz/so4ag.json', remoteEnv())).status, 502);
  assert.equal((await ask(world({ source: onDomain('firma.cz') }), 'https://firma.cz/so4ag.json', { SOURCE_URL: 'http://insecure.example/so4ag.json' })).status, 500);
});

test('remote: a kept copy is not served after the settings change to another domain', async () => {
  const w = world({ source: onDomain('firma.cz') });
  const env = remoteEnv();
  assert.equal((await ask(w, 'https://firma.cz/so4ag.json', env)).status, 200);
  const r = await ask(w, 'https://firma.cz/so4ag.json', { ...env, DOMAIN: 'jina-firma.cz' });
  assert.equal(r.status, 502);
  assert.match((await r.json()).message, /this Worker serves jina-firma\.cz/);
  w.down = true;                                                  // and not as a stale copy either
  assert.equal((await ask(w, 'https://firma.cz/so4ag.json', { ...env, DOMAIN: 'jina-firma.cz' })).status, 503);
});

test('remote: while the source cannot be reached the last good copy is served; a withdrawn source stops', async () => {
  const w = world({ source: onDomain('firma.cz') });
  const env = remoteEnv({ REFRESH_SECONDS: '60' });
  const realNow = Date.now;
  try {
    let t = realNow();
    Date.now = () => t;
    assert.equal((await ask(w, 'https://firma.cz/so4ag.json', env)).status, 200);
    t += 61e3; w.down = true;                                     // due, and the source is down
    const stale = await ask(w, 'https://firma.cz/so4ag.json', env);
    assert.equal(stale.status, 200);
    assert.match(stale.headers.get('x-so4ag-worker'), /stale$/);
    assert.equal(stale.headers.get('cache-control'), 'public, max-age=60');
    t += 8 * 86400e3;                                             // longer than MAX_STALE_SECONDS
    const gone = await ask(w, 'https://firma.cz/so4ag.json', env);
    assert.equal(gone.status, 503);
    assert.equal(gone.headers.get('retry-after'), '60');
    w.down = false; w.status = 500; t += 1;
    assert.equal((await ask(w, 'https://firma.cz/so4ag.json', env)).status, 503);
    w.status = 200;                                               // back: served again
    assert.match((await ask(w, 'https://firma.cz/so4ag.json', env)).headers.get('x-so4ag-worker'), /fresh$/);
    t += 61e3; w.status = 404;                                    // the company withdrew the source: no stale copy
    const withdrawn = await ask(w, 'https://firma.cz/so4ag.json', env);
    assert.equal(withdrawn.status, 404);
    assert.equal((await withdrawn.json()).error, 'source_missing');
  } finally { Date.now = realNow; }
});

test('remote: the copy in the Cloudflare cache survives a new isolate', async () => {
  const w = world({ source: onDomain('firma.cz') });
  const env = remoteEnv();
  await ask(w, 'https://firma.cz/so4ag.json', env);
  // a new isolate has an empty memory: simulate it by asking under an address the memory has not seen, with the same cache entry
  const [[key, val]] = [...w.store];
  const env2 = remoteEnv();
  w.store.set(key.replace(encodeURIComponent(env.SOURCE_URL), encodeURIComponent(env2.SOURCE_URL)), val);
  w.down = true;
  const r = await ask(w, 'https://firma.cz/so4ag.json', env2);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-so4ag-worker'), /cached$/);
  assert.equal(w.upstream, 1);
});

test('remote: signature and key are served next to the source; without them the address answers 404', async () => {
  const sig = { digest: 'sha256:abc', signature: 'AAAA', key_url: 'https://firma.cz/.well-known/so4ag-keys.json' };
  const keys = { controller: 'https://firma.cz/', keys: [{ id: 'k1' }] };
  const w = world({ source: onDomain('firma.cz'), sig, keys });
  const env = remoteEnv();
  assert.deepEqual(await (await ask(w, 'https://firma.cz/so4ag.sig.json', env)).json(), sig);
  assert.deepEqual(await (await ask(w, 'https://firma.cz/.well-known/so4ag-keys.json', env)).json(), keys);
  const none = world({ source: onDomain('firma.cz') });
  assert.equal((await ask(none, 'https://firma.cz/so4ag.sig.json', remoteEnv())).status, 404);
  // a source that is not named so4ag.json has no sibling files: the website answers
  const odd = world({ source: onDomain('firma.cz') });
  assert.equal((await ask(odd, 'https://firma.cz/so4ag.sig.json', { SOURCE_URL: `https://files.example/${++n}/facts` })).headers.get('x-from'), 'origin');
  assert.equal((await ask(odd, 'https://firma.cz/so4ag.json', { SOURCE_URL: `https://files.example/${n}/facts` })).status, 200);
});

test('counting: one event for a known AI crawler or a visit from an assistant, sent after the answer, nothing else', async () => {
  const { countEvent } = await import('../src/index.js');
  const req = (url, h = {}) => new Request(url, { headers: h });
  assert.deepEqual(countEvent(req('https://example.com/', { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)' })), { t: 'bot', n: 'GPTBot' });
  assert.deepEqual(countEvent(req('https://example.com/', { referer: 'https://www.perplexity.ai/search?q=x' })), { t: 'ref', h: 'perplexity.ai' });
  assert.deepEqual(countEvent(req('https://example.com/?utm_source=chatgpt.com')), { t: 'ref', h: 'chatgpt.com' });
  assert.equal(countEvent(req('https://example.com/', { 'user-agent': 'Mozilla/5.0 Firefox/140', referer: 'https://www.google.com/' })), null);
  const sent = [];
  const w = world();
  const inner = w.fetch;
  w.fetch = async (input, init) => { if (!(input instanceof Request) && init?.method === 'POST') { sent.push({ url: String(input), init }); return new Response('{}'); } return inner(input, init); };
  const env = { COUNT_URL: 'https://soqver.com/api/count/firma', COUNT_KEY: 'k'.repeat(32) };
  const page = await ask(w, 'https://example.com/cenik', env, { headers: { 'user-agent': 'ClaudeBot/1.0' } });
  assert.equal(await page.text(), 'the website');                  // the website answers as before
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, env.COUNT_URL);
  assert.equal(sent[0].init.headers['x-soqver-key'], env.COUNT_KEY);
  assert.deepEqual(JSON.parse(sent[0].init.body), { events: [{ t: 'bot', n: 'ClaudeBot' }] });
  assert.doesNotMatch(sent[0].init.body, /cenik|example/);         // never the path or the domain of the visit
  await ask(w, 'https://example.com/', env, { headers: { 'user-agent': 'Mozilla/5.0 Firefox/140' } });
  await ask(w, 'https://example.com/', { COUNT_URL: 'http://plain.example/count', COUNT_KEY: 'x' }, { headers: { 'user-agent': 'GPTBot' } });
  await ask(w, 'https://example.com/', {}, { headers: { 'user-agent': 'GPTBot' } });
  assert.equal(sent.length, 1);                                    // a person, an http address or no settings: nothing is sent
  const file = await ask(w, 'https://example.com/so4ag.json', env, { headers: { 'user-agent': 'OAI-SearchBot/1.0' } });
  assert.equal(file.status, 200);                                  // the file of the source is still served, and the read is counted
  assert.equal(sent.length, 2);
  w.fetch = async (input, init) => { if (init?.method === 'POST') throw new Error('counter down'); return inner(input, init); };
  assert.equal(await (await ask(w, 'https://example.com/', env, { headers: { 'user-agent': 'GPTBot' } })).text(), 'the website');   // a broken counter never breaks the website
});
