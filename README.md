# SO4AG — Source Objects for AGents

[![test](https://github.com/soqvercom/so4ag/actions/workflows/test.yml/badge.svg)](https://github.com/soqvercom/so4ag/actions/workflows/test.yml)
[![code: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue)](LICENSE)
[![spec: CC BY 4.0](https://img.shields.io/badge/spec-CC%20BY%204.0-blue)](LICENSE-SPEC.md)
[![PyPI](https://img.shields.io/pypi/v/so4ag)](https://pypi.org/project/so4ag/)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24429989.svg)](https://doi.org/10.5281/zenodo.24429989)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-com.soqver%2Fso4ag-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=soqver)

SO4AG is an open format for business facts that AI agents can rely on. A fact is published together with
what it means, where it applies, where it comes from and until when it is valid. "Unknown" is a value of its own,
never zero and never a guess.

A reader answers one question: **may this fact be used for this task at this time, and if not, why not?**

- Guide for developers, step by step (in 30 languages): https://soqver.com/developers
- Specification 0.1: https://soqver.com/spec/so4ag/0.1/ (working draft 0.2: https://soqver.com/spec/so4ag/0.2/)
- Lossless JSON-LD mapping: https://soqver.com/spec/so4ag/0.1/jsonld
- Conformance suite: https://soqver.com/spec/so4ag/0.1/conformance/
- Online validator: https://soqver.com/validator
- What works today, in one table: https://soqver.com/status

Status: working draft. The format is free to use and needs no account. It is not a W3C, IETF or platform standard.
SOQVER (https://soqver.com) is one service that prepares, confirms and publishes SO4AG sources; anyone can publish
a source on their own domain without it.

## Install

The Python reader is on PyPI. The JavaScript package installs straight from this repository.

```bash
# JavaScript (Node 20 or newer): validator, reader, command so4ag-validate
npm install github:soqvercom/so4ag#v0.1.4
npx so4ag-validate https://example.com/so4ag.json

# Python (3.10 or newer, standard library only): reader, command so4ag
pip install so4ag
so4ag ask so4ag.json --property refundableDeposit --scope vehicle_class=economy
```

To follow the main branch instead of a release: `npm install github:soqvercom/so4ag` and
`pip install "git+https://github.com/soqvercom/so4ag.git#subdirectory=readers/python"`.

## Try it from a checkout

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
for (const { claim, result } of answers) console.log(claim.id, result.usable, result.reasons, result.warnings, result.value);
```

Every answer says whether the claim is `usable` and lists the `reasons` when it is not
(`expired`, `scope_mismatch:<key>`, `unknown`, `less_specific`, `conflicting_claims`, `needs_refresh`, `no_trust_policy` and others).
`warnings` are reported without blocking the use: a `disputed` claim stays usable unless the task sets `refuseDisputed`.
When a general claim and its exception both match, only the more specific one is usable.
`selectClaims` is the safe way to read: it checks the source first and refuses all of it when it is not valid.
Pass `{ now: new Date('2027-06-01') }` as the third argument to ask about another time.

## Use it in code (Python, standard library only)

```bash
python readers/python/so4ag_reader.py ask examples/valid/rental-first-party.json --property refundableDeposit --scope vehicle_class=economy \
  --scope branch=https://rental.example/branches/prague-airport
python readers/python/so4ag_reader.py conformance spec/conformance/0.1
```

The Python reader was written separately from the reference validator and shares no code with it.
Both pass the same conformance suite.

## Any industry

The format is not tied to an industry. What a fact means, its type, unit and conditions are set by a profile, and one
source may use several profiles together.

| Profile | For whom |
|---|---|
| [General](spec/profiles/general-0.1.json) | Any business or organisation: operator, places and opening hours, contacts, languages, what it offers and for how much, payment, booking, response and delivery times, cancellation, guarantee, accessibility, licences, availability (26 properties). |
| [Rental](spec/profiles/rental-0.1.json), [Retail](spec/profiles/retail-0.1.json) | What is specific to vehicle rental and to online shops. |
| Your own | Anything else: a JSON file of the same form on your domain ([schema](spec/schema/profile-0.1.schema.json)). You ask nobody and register nothing. |

```bash
node validator/cli.mjs --check-profile examples/profiles/dental-example-profile.json
node validator/cli.mjs examples/valid/general-dental.json --profile examples/profiles/dental-example-profile.json
```

`examples/valid/general-dental.json` is a dental practice described with the General profile plus two properties of its
own. A reader that does not know a profile still uses its claims when the task states their conditions, and refuses them
when it does not: the safety rules hold for every profile alike.

## Write your own reader

The conformance suite in `spec/conformance/0.1/` is plain JSON and needs none of our code: two valid sources in
three forms, expected digests, 46 evaluation cases, 31 validation cases, 20 whole-source cases and 25 vectors of the
canonical form (RFC 8785); `spec/conformance/0.2/reading.json` adds 4 cases for reading the 0.2 draft. The suite belongs
to edition 0.1.4 of the consumer rules; both readers report the edition they implement (`SPEC_EDITION`). `spec/conformance/0.1/README.md` says when a reader or a validator passes.

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
| `spec/` | specification text, JSON Schema, profiles (General, Rental, Retail), the schema for profiles and the conformance suite |
| `validator/` | reference validator and reader, JSON-LD mapping, 0.2 draft support, signature check |
| `readers/python/` | independent reader in Python (standard library only), packaged as `so4ag` |
| `examples/` | valid example sources and an example of a publisher's own profile |
| `test/` | tests of the reference code against the conformance suite |

## Contributing

Questions, errors in the specification and proposals for the format are welcome as issues. See `CONTRIBUTING.md`
for how the format changes and `SECURITY.md` for reporting a vulnerability.

## Cite

SOQVER. SO4AG: open format for business facts AI agents can rely on. Zenodo. https://doi.org/10.5281/zenodo.24429989
(the DOI always points to the latest release; each release has its own DOI on the same page).

## Licence

Code: Apache-2.0 (`LICENSE`). Specification text, schema, profiles and conformance suite: CC BY 4.0 (`LICENSE-SPEC.md`).

## Contact

info@soqver.com
