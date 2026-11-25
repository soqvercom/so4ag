# Changelog

Changes of the specification are also listed at the end of `spec/so4ag-0.1.md`.

## 0.1.5 (2026-11-25)

Edition 0.1.5. No change of the consumer rules and no change of what is a valid document; both readers answer every
conformance case as in 0.1.4. Update when you want shorter validation errors.

- Schema: a value is described with one `if`/`then` pair per value type in place of `oneOf`. A validator now reports
  the error of the shape named by `type` only. With Ajv 8.20.0 a numeric `amount` gave 31 errors and gives 2; a missing
  currency gave 24 and gives 2; an unknown `type` gave 20 and gives 1.
- Checked: the old and the new schema accept exactly the same documents on the examples, the conformance sources and
  20,000 mutated documents.
- The idea comes from an answer in the JSON Schema community discussions (json-schema-org/community#1051).

## Cloudflare Worker (2026-11-25)

No change of the format, the readers or the conformance suite.

- New folder `cloudflare/so4ag-worker/`: a Cloudflare Worker that serves `/so4ag.json` on your own domain in front of any
  website, for platforms that cannot place a file at the root of the domain. The source is a file kept in the Worker or
  is read from an https address, with the last good copy served while that address cannot be reached. A source whose
  identifiers are on another domain is never served.

## 0.1.4 (2026-11-22)

Edition 0.1.4 of the consumer rules, after a third external review. Update if you use 0.1.3 or older.

- **Stale live values:** the live rule of the 0.2 draft (`live`, `max_age`) was dropped when a 0.2 file was read. It is now a
  required extension and both readers refuse a value older than `max_age` (`needs_refresh`). Pass `liveCheckedAt`
  (`--live-checked-at`) when you asked the live endpoint yourself.
- **Overlapping scopes:** a general claim and its exception were both returned as usable. Now the most specific claim is used
  and the others get `less_specific`; an overlap that cannot be ordered is refused (`conflicting_claims`).
- **Disputed claims:** `disputed` moved from `reasons` to the new list `warnings`. `reasons` only holds what blocks the use.
  A task with `refuseDisputed` (`--refuse-disputed`) makes a dispute a reason.
- **Amounts in Python:** the Python reader refuses a source with an unknown currency or wrong decimals, like the validator.
- **Signatures:** verification refuses an unreadable signing time or key date and reports `integrity` apart from `valid`.
- **Editions:** readers export `SPEC_EDITION`; the specification names editions and the levels parser, validator, evaluating reader.
- Conformance suite 0.1.4: 46 evaluation cases, 20 whole-source cases, 4 reading cases for the 0.2 draft.

## 0.1.3 (2026-11-22)

Safety fixes after a second external review. Update if you use 0.1.2 or older.

- **Reading an invalid source:** `selectClaims` (JavaScript) and `read_source` (Python) check the source first; a source
  that is not well formed yields no usable claim (`invalid_source`). The low-level `evaluateClaim` refuses a malformed claim.
- **Forged review:** an attestation counts only when the consumer has authenticated it with the issuer and passes its id
  (`authenticatedAttestations`, `--authenticated`). A trusted issuer's name written in the source is not a proof.
- **Conflicts:** two usable claims with different values for the same subject, property and scope are both refused
  (`conflicting_claims`).
- **Look-alike vocabularies:** the plain schema.org layer recognises properties by their whole URI, never by the name after `#`;
  a JSON-LD document that binds `so4ag:` to another vocabulary is not read.
- **Conditions in derived output:** a claim or a source with an extension marked `affects_use` never enters the plain schema.org layer.
- Conformance suite 0.1.3: 45 evaluation cases, 10 whole-source cases.

## 0.1.2 (2026-11-22)

The format is no longer tied to two industries.

- **General profile** (`spec/profiles/general-0.1.json`): 26 properties any organisation can state.
- **Your own profile**: anyone may publish a profile on their own domain. Schema `spec/schema/profile-0.1.schema.json`,
  check with `so4ag-validate --check-profile`, use with `--profile` (JavaScript and Python).
- **Scope keys outside the reader's profiles**: a claim is comparable when the task states the key (it was refused before);
  an explicit `understoodScopeKeys` list still wins. Sources that were valid stay valid.
- Conformance suite 0.1.2: 43 evaluation cases (5 new, 1 changed).
- Example: a dental practice with the General profile and its own profile.

## 0.1.1 (2026-11-22)

- Both packages install straight from the repository and from the release files (no registry account needed).
- The Python reader is a package (`so4ag`, command `so4ag`) that carries the profiles of the format.
- Guide for developers: https://soqver.com/developers
- No change of the specification, the schema or the conformance suite.

## 0.1.0 (2026-11-21)

First public release of the repository.

- Specification SO4AG 0.1 (working draft, revision of 2026-11-21), JSON Schema, profiles Rental 0.1 and Retail 0.1.
- Lossless mapping to JSON-LD, including sources embedded in an HTML page.
- Conformance suite 0.1.1: 38 evaluation cases, 31 validation cases, 6 whole-source cases, 25 vectors of the
  canonical form.
- Reference validator and reader in JavaScript, independent reader in Python.
- Working draft of the short form 0.2 with conversion to 0.1.

Revision of 2026-11-21 of the specification:

- a reader refuses a document of a version it does not know;
- a claim that depends on an extension the reader does not understand is not used;
- a review counts only with a trust policy of the consumer (`no_trust_policy` otherwise);
- an amount carries the decimals of its currency (ISO 4217); `lang` accepts a script and a region;
- canonical form of numbers follows RFC 8785 exactly.
