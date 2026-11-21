# SO4AG — Source Objects for AGents

SO4AG is an open format for business facts that AI agents can rely on. A fact is published together with
what it means, where it applies, where it comes from and until when it is valid. "Unknown" is a value of its own,
never zero and never a guess.

A reader answers one question: **may this fact be used for this task at this time, and if not, why not?**

- Specification 0.1: https://soqver.com/spec/so4ag/0.1/ (working draft 0.2: https://soqver.com/spec/so4ag/0.2/)
- Lossless JSON-LD mapping: https://soqver.com/spec/so4ag/0.1/jsonld
- Conformance suite: https://soqver.com/spec/so4ag/0.1/conformance/
- Online validator: https://soqver.com/validator
- What works today, in one table: https://soqver.com/status

Status: working draft. The format is free to use and needs no account. It is not a W3C, IETF or platform standard.
SOQVER (https://soqver.com) is one service that prepares, confirms and publishes SO4AG sources; anyone can publish
a source on their own domain without it.

## Try it

```bash
git clone https://github.com/soqvercom/so4ag.git
cd so4ag
npm install
node validator/cli.mjs examples/valid/rental-first-party.json
node validator/cli.mjs https://example.com/so4ag.json
node validator/cli.mjs examples/valid/rental-first-party.json --to-jsonld
```

The validator reads SO4AG JSON, its JSON-LD form, or an HTML page with the JSON-LD embedded.

## Use it in code (JavaScript, Node 20 or newer)

```js
import { readFileSync } from 'node:fs';
import { validateManifest, selectClaims } from './validator/index.mjs';

const source = JSON.parse(readFileSync('examples/valid/rental-first-party.json', 'utf8'));
const check = validateManifest(source);          // { valid, errors, warnings, stats }

// May the deposit for an economy car at the airport branch be used now?
const answers = selectClaims(source, {
  property: 'https://soqver.com/spec/so4ag/0.1/rental#refundableDeposit',
  scope: { branch: 'https://rental.example/branches/prague-airport', vehicle_class: 'economy' },
});
for (const { claim, result } of answers) console.log(claim.id, result.usable, result.reasons, result.value);
```

Every answer says whether the claim is `usable` and lists the `reasons` when it is not
(`expired`, `scope_mismatch:<key>`, `unknown`, `disputed`, `no_trust_policy` and others).
Pass `{ now: new Date('2027-06-01') }` as the third argument to ask about another time.

## Use it in code (Python, standard library only)

```bash
python readers/python/so4ag_reader.py ask examples/valid/rental-first-party.json --property refundableDeposit --scope vehicle_class=economy \
  --scope branch=https://rental.example/branches/prague-airport
python readers/python/so4ag_reader.py conformance spec/conformance/0.1
```

The Python reader was written separately from the reference validator and shares no code with it.
Both pass the same conformance suite.

## Write your own reader

The conformance suite in `spec/conformance/0.1/` is plain JSON and needs none of our code: two valid sources in
three forms, expected digests, 38 evaluation cases, 31 validation cases, 6 whole-source cases and 25 vectors of the
canonical form (RFC 8785). `spec/conformance/0.1/README.md` says when a reader or a validator passes.

## Hosted read-only endpoints

| What | Address |
|---|---|
| MCP server (Streamable HTTP, read-only, no account) | `https://soqver.com/mcp` |
| List of published sources | `https://soqver.com/api/v1/sources` |
| Claims of one source for a task | `https://soqver.com/api/v1/sources/<slug>/claims?property=<name>&scope.<key>=<value>` |

The MCP server is listed in the official MCP Registry as `com.soqver/so4ag` (`mcp/server.json`). Its tools:
`list_sources`, `get_source`, `get_claims`, `check_claim`.

## What is in this repository

| Folder | Content |
|---|---|
| `spec/` | specification text, JSON Schema, profiles (Rental, Retail) and the conformance suite |
| `validator/` | reference validator and reader, JSON-LD mapping, 0.2 draft support, signature check |
| `readers/python/` | independent reader in Python (standard library only), packaged as `so4ag` |
| `examples/` | valid example sources |
| `test/` | tests of the reference code against the conformance suite |

## Contributing

Questions, errors in the specification and proposals for the format are welcome as issues. See `CONTRIBUTING.md`
for how the format changes and `SECURITY.md` for reporting a vulnerability.

## Licence

Code: Apache-2.0 (`LICENSE`). Specification text, schema, profiles and conformance suite: CC BY 4.0 (`LICENSE-SPEC.md`).

## Contact

info@soqver.com
