# Changelog

Changes of the specification are also listed at the end of `spec/so4ag-0.1.md`.

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
