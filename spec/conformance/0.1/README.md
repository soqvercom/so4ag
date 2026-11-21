# SO4AG 0.1 conformance suite

Version 0.1.2, 2026-11-22. Plain JSON files for anyone who writes a validator or a reader. Nothing here needs SOQVER, an account or our code.

| File | What it is |
|---|---|
| `shop.json`, `rental.json` | Two valid sources. Together they use every value type, an unknown and a not-applicable claim, an expired and a future claim, a dispute, attestations and an extension. |
| `shop.jsonld`, `rental.jsonld` | The same sources in JSON-LD ([mapping](../../so4ag-0.1-jsonld.md)). |
| `digests.json` | Claim id to digest (`sha256:` of the canonical JSON of the claim without `attestations`, RFC 8785). |
| `evaluation.json` | 43 cases for readers: a claim, a task, a time and the expected answer. |
| `sources.json` | 6 cases about a whole source: the version of the format and the extensions of the source. |
| `canonical.json` | 25 vectors of the canonical form (RFC 8785): numbers, strings, key order. Digests and signatures are computed from these bytes. |
| `validation.json` | 31 cases for validators: a manifest and whether it is valid, with the error or warning codes that must be reported. |

## A reader passes when

1. For every claim in `shop.json` and `rental.json` it computes the digest in `digests.json`.
2. Reading `shop.jsonld` and `rental.jsonld` gives claims with the same digests. The same holds when the JSON-LD sits in a `<script type="application/ld+json">` block of an HTML page.
3. For every case in `evaluation.json` it returns the expected `usable`, the expected set of `reasons` and, when usable, the expected `value`. The answer must be the same whichever of the three forms the claim was read from.
4. For every case in `sources.json` it either refuses the document with the expected `error` (`unsupported_version`, `missing_version`) or evaluates each claim of the source with the expected `usable` and at least the listed `reasons`. A refused source yields no usable claim.
5. For every vector in `canonical.json` it writes exactly the expected `canonical` text.

`task` has `property`, optional `subject`, `scope` (key to value), optional `understoodScopeKeys` (defaults to the scope keys of the profile that defines the property plus every key the task states in `scope`), optional `requireReview` and `trustedIssuers`. `now` is the time of the question. A case may carry `knownExtensions`: the URIs of the extensions the consumer implements (none by default).

`requireReview` needs a trust policy. Without `trustedIssuers` the answer is `no_trust_policy`: a digest that matches ties an attestation to the wording of the claim and says nothing about who issued it. With the list, an attestation counts when its digest matches, its relation is `independent`, its issuer is on the list and `issued_at <= now < expires_at`. Checking a signature or a revocation list of the issuer is outside 0.1 and is the consumer's own step.

Reasons: `property_mismatch`, `subject_mismatch`, `scope_not_comparable:<key>`, `scope_not_in_task:<key>`, `scope_mismatch:<key>`, `not_yet_valid`, `expired`, `disputed`, `unknown`, `not_applicable`, `no_valid_independent_attestation`, `no_trust_policy`, `unknown_required_extension:<uri>`, and for a whole source `unsupported_version`, `missing_version`. `disputed` is reported but does not make the claim unusable; every other reason does.

## A validator passes when

For every case in `validation.json` it agrees on `valid` and reports at least the listed `errors` and `warnings` codes (it may report more warnings). `schema` means the manifest breaks the JSON schema.

## Implementations checked against this suite

| Implementation | Language | Covers |
|---|---|---|
| `validator/` (reference) | JavaScript | validation, reading, JSON-LD both ways, canonical form |
| `readers/python/so4ag_reader.py` | Python, standard library | reading from all three forms, digests, canonical form |

The two implementations share no code. If you write another one, tell us at info@soqver.com and we will list it, including cases where you disagree with the expected answer.

Licence: Apache-2.0 for code, CC BY 4.0 for the cases.
