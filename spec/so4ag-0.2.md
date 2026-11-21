# SO4AG 0.2 (working draft)

Status: working draft, 21 November 2026. Version 0.1 stays valid and is still what SOQVER publishes as the main file of every source. Version 0.2 is offered next to it so that it can be tried and criticised.

A 0.2 file says the same thing as a 0.1 file. Every 0.2 file expands to a 0.1 manifest whose claims have the same digests, so attestations issued for 0.1 claims stay valid and every 0.1 reader works after one mechanical step. Nothing in 0.2 changes the meaning of a claim.

## Why a second version

Two runs of the comparison test (online shops and vehicle rentals, three models, 639 tasks) showed two things the first version did not handle well:

1. Models made most of their errors where an old value, the current value and an announced value stood side by side. A source that carried only what is valid now was read correctly far more often.
2. Files grow quickly. A rental source with 90 claims repeats the same subject, basis and validity 90 times.

Version 0.2 answers both, and adds three things companies asked for: a statement of what the data may be used for, a pointer to live data, and a signature.

## What is new

| Key | Purpose |
|---|---|
| `so4ag` | `"0.2-draft"` |
| `view` | `"current"`: the file carries only claims that are valid or will become valid. `"full"`: every claim of the revision. Default when missing: `"full"`. |
| `defaults` | Values shared by most claims, written once. Allowed keys: `subject`, `assertion_basis`, `valid_from`, `valid_until`, `evidence`, `scope`. |
| `usage` | What the publisher allows the data to be used for. |
| `live` | Properties that must be asked live, and where. |
| `links.signature`, `links.keys` | Detached signature of the full revision file and the public keys. |
| `links.full`, `links.history` | The full revision file and the list of earlier revisions. |

Everything else (`id`, `revision`, `published_at`, `publisher`, `subjects`, `profiles`, `claims`, `extensions`) is as in 0.1.

### Defaults

A claim that does not have a key listed in `defaults` takes the default. A claim that has the key keeps its own value. A claim that must not have the key at all writes it as `null` (an "unknown" claim without evidence, for example). `scope` is replaced as a whole, never merged.

```json
{
  "so4ag": "0.2-draft",
  "view": "current",
  "defaults": {
    "subject": "https://shop.example/#org",
    "assertion_basis": "publisher_asserted",
    "valid_from": "2026-11-20T08:00:00Z",
    "valid_until": "2027-01-19T08:00:00Z"
  },
  "claims": [
    { "id": "https://shop.example/so4ag.json#C-001", "revision": "1", "property": "https://soqver.com/spec/so4ag/0.1/retail#returnPeriod",
      "knowledge_state": "known", "value": { "type": "quantity", "value": "14", "unit": "d" }, "scope": {},
      "evidence": [{ "url": "https://shop.example/terms", "observed_at": "2026-11-20T07:00:00Z", "kind": "webpage" }] }
  ]
}
```

**Expansion** (normative): copy every default into each claim that lacks the key; remove keys whose value is `null`; add `"scope": {}` where a claim still has none; move `usage` and `live` into `extensions` under `https://soqver.com/spec/so4ag/0.2/terms#usage` and `…#live` with `affects_use: false`; keep only the link keys 0.1 knows; set `so4ag` to `"0.1-draft"`. The result must be a valid 0.1 manifest.

### Current view

A file with `"view": "current"` MUST NOT carry a claim whose `valid_until` is not later than `published_at`. Announced claims (`valid_from` in the future) stay. A consumer still applies the validity rules of 0.1 at the time of use: a "current" file read a month later contains claims that have expired since.

History is not lost. It is in earlier revisions (`links.history`) and in the full file of the revision (`links.full`).

### Usage

```json
"usage": { "allowed": ["answer", "quote", "index", "cache"], "denied": ["train"], "attribution": "required", "terms": "https://shop.example/data-terms" }
```

Purposes: `answer` (use the value in an answer to a user), `quote` (reproduce the wording), `index` (include in a search index), `cache` (keep a copy), `train` (use for model training). A purpose that is listed nowhere is *not stated*; a consumer must not read it as permission or as prohibition. A purpose cannot be both allowed and denied. `attribution` is `required` or `none`.

This is a statement by the publisher. The format cannot enforce it and SOQVER does not claim to.

### Live sources

```json
"live": [{ "property": "https://soqver.com/spec/so4ag/0.1/rental#availability", "endpoint": "https://soqver.com/api/v1/sources/acme/claims?property=availability", "protocol": "so4ag-claims", "max_age": "PT1H" }]
```

For a listed property a stored claim older than `max_age` should be refreshed at `endpoint` before it is used. `protocol` is `so4ag-claims` (the SOQVER claims API: a JSON answer with evaluated claims) or `mcp`. A consumer that cannot reach the endpoint treats the property as unknown.

## Signature

A source can be signed. The signature is a separate small file, so the manifest itself does not change:

```json
{ "so4ag_signature": "0.2-draft", "source": "https://shop.example/so4ag.json", "revision": "20261121.1",
  "digest": "sha256:…", "algorithm": "Ed25519", "key_id": "shop-20261121-a1b2c3",
  "key_url": "https://shop.example/.well-known/so4ag-keys.json", "signed_at": "2026-11-21T08:00:00Z", "signature": "…" }
```

- `digest` is SHA-256 of the manifest in canonical JSON (RFC 8785), the same canonical form claim digests use.
- `signature` is Ed25519 over the canonical JSON of the signature document without the `signature` key, base64url.
- The key file lists public keys: `{ "so4ag_keys": "0.2-draft", "controller": "…", "keys": [{ "key_id", "algorithm": "Ed25519", "public_key", "created_at", "retired_at"? }] }`. `public_key` is the raw 32-byte key in base64url. A retired key still verifies what it signed before it was retired.

What a signature proves: the file has not changed since it was signed, and it was signed with the key in the key file. Whose key it is follows from where the key file lives. A key file on the company's own domain says the company controls the key. A key file on `soqver.com` says only that the revision was published through a SOQVER account of that company.

What it does not prove: that the facts are true.

The signature covers the full revision file (`so4ag.json`). A 0.2 file with `"view": "current"` is a shorter rendering of the same revision and points to the full file and its signature through `links.full` and `links.signature`.

## Validation

`validate02` checks the new keys and then validates the expanded file with the 0.1 rules. Codes: `view`, `defaults`, `usage`, `usage_conflict`, `live`, `links`, `expired_in_current_view`, `expand`, and every 0.1 code.

## Test files

`/spec/so4ag/0.2/conformance/`: the two 0.1 test sources written in 0.2 (`shop-0.2.json`, `rental-0.2.json`), a current view of each, the digests every claim must have after expansion, and validation cases for the new keys. Because expansion gives the same claims, the 32 evaluation cases of 0.1 apply to the expanded files unchanged.

## Open questions

- Should 0.2 become the main published form, with the "current" view as default? The test supports it; it would change what the self-hosting check compares.
- Is `usage` detailed enough, or should it reuse an existing vocabulary?
- Should a signature be required for sources with attestations?
