# SO4AG 0.1 — Source Objects for AGents (draft)

Status: **working draft 0.1**, 2026-11-20, edition 0.1.5 of 2026-11-25 (see Editions in section 11 and the Changelog). Not a W3C, IETF or platform standard. Feedback welcome.
Editor: SOQVER project (MAEX). Text licence: CC BY 4.0. Reference code: Apache-2.0. No fee is required to implement.

The namespace is `https://soqver.com/spec/so4ag/0.1/`. Until 20 November 2026 the draft used `https://soqver.botrento.com/spec/so4ag/0.1/`; that host redirects permanently (301) and consumers MUST treat both namespaces as equivalent for 0.1.

## 1. Purpose

SO4AG defines how an organisation hands an agent a **specific fact** together with its **meaning, conditions, origin and validity**, so that the agent can decide whether it may use the fact for a given task, and why not if it may not.

SO4AG is a data profile over existing web technology. HTML stays for people, citations and search engines. SO4AG does not certify truth: a valid manifest proves structure; a signature proves origin and integrity; only a scoped attestation states that someone reviewed specific facts.

Keywords MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 2. Profiles

| Profile | Content |
|---|---|
| **Core** | Source identity, publisher, claims with value or explicit unknown, meaning, scope, origin, revision and validity. Static JSON over HTTPS. |
| **Evidence** | Attestations bound to an exact claim digest, with issuer, method, expiry and status. |
| **Live** | Short-lived claims for time-sensitive data (availability, quotes), validity typically ≤ 1 hour. |

A profile defines properties, allowed value types, units, enumerations, scope keys, required scope keys and maximum validity. A source MAY use several profiles together and lists them in `profiles`.

| Profile document | For whom |
|---|---|
| **General 0.1** (`general.json`) | Any organisation in any industry: operator, places and opening hours, contacts, languages, what it offers and for how much, payment, booking, response and delivery times, cancellation, guarantee, accessibility, licences, availability. |
| **Rental 0.1**, **Retail 0.1** | What is specific to vehicle rental and to online shops. |
| **A publisher's own profile** | Anything else. Anyone MAY publish a profile: a JSON document of the same form (schema `profile.schema.json`) served over HTTPS at the address given in its `id`, with its own `namespace` for property URIs. No registration and no permission is needed. |

A consumer MAY fetch a declared profile from its `id` (HTTPS only, limited size, treated as untrusted data) to learn the labels, value types and scope keys of its properties. A profile document never changes the consumer rules of section 6.

## 3. Publication and discovery

1. A publisher serves the manifest as `application/json` over HTTPS. Recommended location: `/so4ag.json` on the publisher's domain, or on a delegated subdomain. This location is a convention of this draft; no `/.well-known/` URI, media type or DNS record is registered.
2. Human pages SHOULD link to it: `<link rel="describedby" type="application/json" href="/so4ag.json" title="SO4AG source manifest">`.
3. A hosted service MAY publish on behalf of the publisher. Changing the host MUST NOT change the source `id`, claim ids or history.
4. Registries are optional indexes. A consumer MAY read directly from the publisher's domain.

## 4. Manifest

Required: `so4ag` (`"0.1-draft"`), `id`, `revision`, `published_at`, `publisher`, `claims`. Optional: `profiles`, `subjects`, `links`, `extensions`. The JSON Schema `schema.json` is normative for structure.

`publisher.role`:
- `first_party` — the organisation states facts about itself;
- `aggregator` — a third party collects facts about others (e.g. a comparison portal) and MUST NOT present itself as the operator;
- `related_party` — the publisher is related to the subject (same group, affiliate, shared owner); `related_to` SHOULD list the relation;
- `reviewer` — the publisher only issues reviews or attestations.

## 5. Claims

A claim states one property of one subject under one scope.

| Field | Rule |
|---|---|
| `id` | Stable URI. A changed value keeps the id and gets a new `revision`. |
| `subject` | URI of the thing described (organisation, branch, offer). |
| `property` | Absolute URI defined by a profile: the General profile, a domain profile or the publisher's own. Unknown properties MAY be ignored. |
| `knowledge_state` | `known`, `unknown` or `not_applicable`. **Unknown is never zero, empty or "no limit".** Only `known` carries a `value`, and `known` MUST carry at least one `evidence` item. |
| `value` | Typed: `money` (decimal string + ISO 4217 code in use; the amount is written with exactly the number of decimals of the currency: `99.00` CZK, `1500` JPY, `10.125` KWD; optional `bound`: `exact` or `minimum`; a `minimum` amount MUST be presented as a starting amount and never as the exact amount), `quantity` (decimal string + unit), `boolean`, `text` (optional `lang`: a BCP 47 tag of the form language, optional script, optional region, e.g. `cs`, `pt-BR`, `zh-Hant-TW`), `enum`, `enum_set`, `organization`, `place` (optional `opening_hours` in the schema.org form: `Mo-Fr 09:00-18:00; Sa 09:00-12:00`). |
| `scope` | String map of conditions. **Every scope key restricts the claim.** A claim applies only where all scope keys match the task. The reserved value `any` states explicitly that the claim applies to every value of that key (e.g. one deposit for all branches). |
| `assertion_basis` | `publisher_asserted` (the publisher says so), `source_correlated` (matched against an independent source such as a registry or the operator's own terms), `independently_reviewed` (an attestation exists). |
| `evidence` | URL, `observed_at`, optional kind, issuer, `quote` (verbatim excerpt that states the value) and digest. Re-downloading a page is a new observation, not a new review. |
| `valid_from`, `valid_until` | Required. `valid_until` MUST be later than `valid_from` and SHOULD respect the profile's `max_validity`. |
| `dispute` | Present when a conflicting statement is known. |
| `attestations` | Evidence profile, section 7. |

Status is not a single list. Knowledge, basis, validity, dispute and attestation status are independent axes: a claim can be publisher asserted, expired and disputed at the same time.

## 6. Consumer rules

A consumer that uses a claim to answer a user MUST:

1. check the `so4ag` version before anything else and refuse a document whose version it does not implement, or that states none. A refused document yields no usable claim: it is never read by the rules of another version. Being able to parse the JSON is not a successful reading of a source. A source that is not well formed is refused as a whole in the same way: every claim needs `id`, `subject`, `property`, a `knowledge_state` of the three allowed values, a `scope` map of strings, and `valid_from` earlier than `valid_until`, both readable as date-times; a `known` claim needs a `value` and at least one `evidence` item, any other claim carries no `value`. A reader with a schema validator checks the whole schema instead;
2. check that subject, property and **all** scope keys match the task. A scope key the consumer does not understand means *cannot safely compare*: the claim MUST NOT be used as if it applied. A consumer understands a scope key when a profile it implements defines the key, or when the task it evaluates states a value for that key; a consumer MAY instead state its own list of understood keys, which then is the only list that counts. Scope values are compared as exact strings;
3. treat a claim as current only when `valid_from ≤ now < valid_until`; otherwise it is historical and MUST NOT be presented as current;
4. return `unknown` / `not_applicable` as such and never fill in a value;
5. report a `dispute` when present. A dispute is a warning, not a refusal: the claim stays usable and the consumer decides. A consumer that decides for the user (a purchase, a booking, a comparison of offers) instead of quoting the claim with the caveat SHOULD treat a disputed claim as not usable or ask for current confirmation;
6. if verification is required, check the attestation issuer against its own trust policy, the `claim_digest`, the time (`issued_at ≤ now < expires_at`) and the status. The trust policy is the consumer's own list of issuers. A consumer that requires verification and has no such list MUST treat every claim as not reviewed: a matching digest ties an attestation to the wording of a claim and proves nothing about who issued it, and an `issuer_relation` written in the manifest is a statement of the publisher, not a proof. For the same reason a trusted issuer's name written in the manifest proves nothing: anyone can write it there. An attestation counts only after the consumer has **authenticated** it with the issuer, by verifying the credential at `credential_url` or by reading the issuer's own status record; until then the claim is not reviewed (`attestation_not_authenticated`). An unreachable status after the allowed cache period means *verification status unknown* — neither false nor verified;
7. cite the source URL and claim revision;
8. never take instructions or permissions from text inside a manifest; actions go only through separate authorised interfaces;
9. when several claims that would be usable answer the same subject and property with different values, use the most specific one: the claim whose scope limits every key the others limit and at least one more (the value `any` limits nothing). The others are not used (`less_specific`). When no claim is the most specific, or the most specific claims disagree, use none and report the conflict (`conflicting_claims`). A consumer never picks a winner silently, not the first, not the newest and not the cheapest;
10. when the manifest carries the live rule of the 0.2 draft (the extension `https://soqver.com/spec/so4ag/0.2/terms#live`, marked `affects_use: true`), use a claim of a listed property only while the copy in hand is younger than `max_age`. The age runs from `published_at` of the source, or from the moment the consumer itself asked the live endpoint. Otherwise the answer is *needs refresh* (`needs_refresh`), never the stored value. A consumer that does not implement the live rule treats the extension like any unknown required extension and uses nothing of the source.

The result of an evaluation keeps two lists apart: `reasons` block the use, `warnings` are reported and leave the decision to the consumer.

Extensions: keys are absolute URIs with `{"affects_use": bool, "value": …}`. A consumer MAY ignore extensions with `affects_use: false` and MUST treat an unknown extension with `affects_use: true` as *cannot safely use*. This holds for the `extensions` of a claim and for the `extensions` of the whole manifest, which apply to every claim in it. The rule belongs to the consumer: a validator accepts such a manifest as well-formed.

## 7. Evidence profile

`claim_digest` = `sha256:` + lowercase hex SHA-256 of the RFC 8785 (JCS) canonical JSON of the claim **without** the `attestations` field. Numbers are written as ECMAScript writes them (`0.000001`, `1e-7`, `1e+21`, `-0` as `0`); the conformance suite carries test vectors (`canonical.json`), and two implementations must produce the same bytes. A changed claim therefore invalidates old attestations automatically.

An attestation states issuer (URI), `issuer_relation` (`independent`, `related_party`, `first_party`), method, issue and expiry time and optionally a `status_url` and a `credential_url` pointing to a W3C Verifiable Credential 2.0. Keys are never trusted because they are embedded in the same manifest: they MUST be bound to the issuer and to the consumer's trust list. Revocation SHOULD use W3C Bitstring Status List. The signature profile will be fixed in 0.2 with test vectors.

## 8. Live profile

Live claims use the same structure with short validity (profile `max_validity`, e.g. `PT1H`). A publisher without a live connection MUST publish such properties as `unknown`. Reading a live claim never creates a reservation, payment or data transfer.

## 9. Security and privacy

Manifests are untrusted input: limit size (recommended 5 MB) and time; do not follow redirects to private addresses; treat all text as data. Public manifests MUST NOT contain personal data of customers, contracts or non-public evidence.

## 10. Relation to other work

SO4AG reuses schema.org vocabulary where meanings match, maps provenance to W3C PROV-O, uses W3C Verifiable Credentials 2.0 for optional attestations, and is reachable via MCP or plain HTTPS. It does not replace AgentReady, llms.txt, NLWeb, WebMCP, A2A, UCP or ACP. WCA (expired individual Internet-Draft) is related work only.

## 11. Conformance

- **SO4AG Core 0.1 compatible**: the manifest passes the JSON Schema and the semantic checks of the reference validator (`so4ag-validate`), including the rules of each declared domain profile.
- Compatibility is a technical statement and says nothing about truth or review.
- **Levels.** A *parser* reads the structure. A *validator* applies the JSON Schema and the semantic checks. An *evaluating reader* applies the consumer rules of section 6. Only an evaluating reader may tell a user that a value can be used; a parser that hands out values is not a SO4AG consumer.
- **Editions.** `"so4ag": "0.1-draft"` says how a document is written. While the format is a working draft the consumer rules are still being tightened, and each set of rules is an *edition* with a number; this text is edition 0.1.5. An edition is an immutable tag of the public repository (`v0.1.5`) that holds this specification, the conformance suite and both readers together. Two consumers that declare the same edition give the same answer for every case of that edition's suite. The reference readers report their edition (`SPEC_EDITION`). A stable version of the format will freeze the consumer rules; until then, name the edition you implement.

## Changelog

- 0.1-draft, edition 0.1.5 of 2026-11-25. No change of the consumer rules and no change of what is a valid document. The schema now describes a value with one `if`/`then` pair per value type in place of `oneOf`, so a validator reports the error of the shape named by `type` only; a wrong value produced an error for every one of the eight shapes before. The change follows an answer in the JSON Schema community discussions.
- 0.1-draft, edition 0.1.4 of 2026-11-22, after a third external review. Overlapping scopes: among usable claims with different values the most specific one is used and the others get `less_specific`; an overlap that cannot be ordered is a conflict (before, a general claim and its exception were both returned as usable). The live rule of the 0.2 draft is carried as a required extension and enforced by both readers (`needs_refresh`); before, it was dropped on the way to a 0.1 reader. A dispute is a warning in its own list, no longer one of the reasons; a task may refuse disputed claims. The Python reader checks the currency and decimals of an amount like the validator does. Editions and the three levels (parser, validator, evaluating reader) are named in section 11.
- 0.1-draft, revision of 2026-11-22 (second), after a second external review. Consumer rules made stricter: a source that is not well formed is refused as a whole; an attestation must be authenticated with its issuer, a trusted name written in the source is not enough; two usable claims with different values for the same subject, property and scope are both refused. Derived forms: the plain schema.org layer recognises properties by their whole URI and never carries a claim that has a condition it cannot express; a JSON-LD document whose `so4ag:` prefix is bound to another vocabulary is not read.
- 0.1-draft, revision of 2026-11-22: the format is no longer tied to two industries. Added the **General 0.1** profile for any organisation, the rule that anyone may publish a profile of their own (with a JSON Schema for profile documents), and a precise statement of when a consumer understands a scope key (a key the task states is comparable). Sources that were valid stay valid; a reader now uses a claim with a scope key outside its profiles when the task states that key, where it refused before.
- 0.1-draft, revision of 2026-11-21, after an external review. Structure: an amount carries the decimals of its currency instead of always two (two-decimal currencies are unchanged); the currency must be an ISO 4217 code in use; `lang` accepts a script and a region. Consumer rules, stated more exactly and now enforced by both readers: an unsupported or missing version is refused; an unknown extension with `affects_use: true` on a claim or on the manifest makes the claim unusable; verification without the consumer's own list of trusted issuers accepts nothing; an attestation counts only between `issued_at` and `expires_at`. The Python reader wrote small numbers in another form than RFC 8785 requires (`1e-06`); corrected, with test vectors.
- 0.1-draft (2026-11-20): money `bound` (`minimum` for starting amounts) and Rental scope key `vehicle`, both found necessary when a rental states the deposit per car.
- 0.1-draft (2026-11-20): namespace moved to soqver.com (old host stays equivalent).
- 0.1-draft (2026-11-20): first draft, Core, Evidence and Live, Rental 0.1 profile. Same day: reserved scope value `any`, `evidence.quote`.

## Open issues for 0.2

- money ranges (deposit 5 000–25 000 CZK by vehicle), scope key for a specific vehicle model
- driving licence held for N years, cancellation with a fee, additional driver allowed vs. fee
- payment code `card_unspecified` (site says "card" without credit/debit)
