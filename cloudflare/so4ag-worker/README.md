# SO4AG Worker for Cloudflare

Serves `https://your-domain/so4ag.json` in front of any website whose domain goes through Cloudflare.

Use it when the platform your website runs on cannot place a file at the root of the domain (hosted shops and site
builders usually cannot), or when you do not want to touch the website at all. The Worker answers one address,
`/so4ag.json`. Every other address is answered by your website exactly as before.

SO4AG is an open format (working draft) for the facts of a business: prices, opening hours, payment, delivery and terms,
each with its scope, validity and the page that states it. Specification: https://soqver.com/spec/so4ag/0.1/

## What you need

- A domain whose DNS record is **proxied by Cloudflare** (orange cloud). A Worker route does not run on a record
  that is "DNS only". Some hosted platforms ask for a record without the proxy, so check this with your platform first.
- A Cloudflare account. The free plan is enough: it allows 100,000 requests a day.
- Node.js 20 or newer.
- A SO4AG source for the domain, with identifiers on that domain (`"id": "https://your-domain/so4ag.json"`).

## Two ways to give the Worker your source

**1. The file lives in the Worker (embedded).** Replace `so4ag.json` in this folder with your source and deploy.
To change a fact you edit the file and deploy again. Nothing outside your Cloudflare account is involved.

**2. The source is read from an address (remote).** Set `SOURCE_URL` to an https address that returns your source.
The Worker reads it, keeps the last good copy and serves it. A source you manage at SOQVER has such an address:

```
https://soqver.com/s/<your-source>/own/so4ag.json
```

It returns the published revision with identifiers on your domain. It exists once the company has confirmed the
source and filled in its domain in the settings of the source. With this mode a fact you approve and publish in the
administration reaches your domain within five minutes, without a deploy.

In the remote mode the Worker also answers `/so4ag.sig.json` and `/.well-known/so4ag-keys.json` when the source has
a signature and a key next to it (same address, file names `so4ag.sig.json` and `so4ag-keys.json`).

## Deploy

With the button Cloudflare copies this folder into a repository of your own, asks for the four settings below and
deploys it from there:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/soqvercom/so4ag/tree/main/cloudflare/so4ag-worker)

Or from a checkout of this folder:

```
npm install
npx wrangler login
npx wrangler deploy
```

Either way the first deploy gives you a preview address on `workers.dev`. Open `/so4ag.json` there and check what it
returns: until you replace `so4ag.json` or set `SOURCE_URL`, it is the example source of `example.com`.

Then put the Worker on your domain. In `wrangler.jsonc` uncomment `routes` and write your domain:

```jsonc
"routes": [
  { "pattern": "example.com/so4ag.json", "zone_name": "example.com" },
  { "pattern": "www.example.com/so4ag.json", "zone_name": "example.com" }
]
```

A route matches exactly the host you write, so `www` needs its own line. Add two more lines per host if you serve
the signature and the key. Deploy again.

## Settings

Set them in `wrangler.jsonc` under `vars`, or in the Cloudflare dashboard (Worker → Settings → Variables).

| Variable | Default | Meaning |
|---|---|---|
| `SOURCE_URL` | empty | Empty: serve `so4ag.json` from this folder. An https address: read the source from there. |
| `DOMAIN` | empty | The domain the source belongs to. Empty: the domain the Worker runs on. |
| `REFRESH_SECONDS` | `300` | Remote mode: how long one copy is served before the source is read again. At least 60. |
| `MAX_STALE_SECONDS` | `604800` | Remote mode: how long the last good copy is served while the source cannot be reached. `0` turns it off. |

## What the Worker checks

- The document is a SO4AG source (`so4ag`, `id`, `claims`).
- **The identifiers of the source and its publisher are on the domain the Worker serves** (`www.` is ignored).
  A source of another domain is never served; the Worker answers with an error that says which domains did not match.
  On a `workers.dev` preview address there is nothing to compare with, so set `DOMAIN` if you want the check there too.
- Remote mode: a wrong document is never served, even when an older copy exists. When the source stops existing
  (404, 410), the Worker stops serving it. The last good copy is used only while the source cannot be reached
  (no answer, 429, 5xx), and for no longer than `MAX_STALE_SECONDS`.

The Worker does not validate every claim. Validate the source before you publish it:

```
npm install github:soqvercom/so4ag#v0.1.4
npx so4ag-validate https://example.com/so4ag.json
```

or paste the address into https://soqver.com/validator.

The response header `x-so4ag-worker` says how the answer was made: `embedded`, `fresh` (just read from the source),
`cached`, `stale` (the source could not be reached) or `error`.

## What it does not do

- It does not put JSON-LD into your pages. Add the Facts and terms page or the JSON-LD block to the website yourself.
- It does not make assistants or search engines use your facts. It makes the file available on your domain in a
  form that is hard to read wrongly. Nothing more.
- It does not prove the facts are true. The business that publishes them is responsible for them.

## Development

```
npm test          # the handler in plain Node, no Cloudflare account needed
npx wrangler dev  # the Worker in the local Cloudflare runtime, http://127.0.0.1:8787/so4ag.json
```

For local settings create a file `.dev.vars` (not committed), for example `SOURCE_URL="https://…/so4ag.json"`.
On `localhost` and `workers.dev` there is no website behind the Worker, so every other address answers 404.

## License

Apache-2.0, the same as the SO4AG reference code.
