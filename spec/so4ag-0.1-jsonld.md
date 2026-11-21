# SO4AG 0.1 in JSON-LD (working draft)

Status: draft, 2026-11-20. This document does not change SO4AG 0.1. It defines a second, equivalent way to write the same source: JSON-LD with schema.org and a small `so4ag` vocabulary. A page for people with this JSON-LD inside is the recommended default; the `so4ag.json` file is the same information in another notation.

## Why

Search engines and crawlers already read JSON-LD in pages. A company should not have to choose between a notation today's tools read and one that keeps scope, validity and origin. Converting a manifest to JSON-LD and back yields the same publisher, subjects, profiles, links and claims, and **every claim keeps its digest**, so attestations stay valid in both notations. The order of claims carries no meaning and is not preserved.

## Shape

```json
{
  "@context": ["https://schema.org", {"so4ag": "https://soqver.com/spec/so4ag/0.1/terms#"}],
  "@graph": [
    { "@type": "CreativeWork", "additionalType": "so4ag:Source", "@id": "<manifest id>", "...": "..." },
    { "@type": "Store", "@id": "<subject>", "additionalProperty": [ { "@type": "PropertyValue", "...": "one claim" } ] }
  ]
}
```

A reader finds the node with `additionalType` `so4ag:Source`, then reads every `PropertyValue` in `additionalProperty` of the other nodes that carries `so4ag:knowledgeState`. The `@id` of the node that holds the claim is the claim subject.

### Source node

| Manifest | JSON-LD |
|---|---|
| `id` | `@id` |
| `so4ag` | `so4ag:version` |
| `revision` | `version` |
| `published_at` | `datePublished` |
| `publisher` | `publisher` (`Organization`): `@id`, `name`, `so4ag:role`, `so4ag:domain`, `identifier`, `so4ag:relatedTo`, `so4ag:contact` |
| `subjects` | `about` (list of `@id`); name, url, `identifier` and `so4ag:type` are on the subject node |
| `profiles` | `so4ag:profile` (list of `@id`) |
| `links` | `so4ag:links` (list of `PropertyValue`: `propertyID` = key, `value` = address) |
| `extensions` | `so4ag:extensions` (JSON literal) |

`mainEntity` is informative. The source node carries no `expires`: validity belongs to each claim (`validThrough`). The first draft put the earliest `valid_until` there; in the comparison test a model then treated the whole document as expired, so the property was removed on 21 November 2026.

### Claim

| Claim | JSON-LD (`PropertyValue`) |
|---|---|
| `id` | `@id` |
| `property` | `propertyID` (`name` repeats the short name, informative) |
| `value` | `value`, see below; absent when the state is not `known` |
| `valid_from`, `valid_until` | `validFrom`, `validThrough` (`validThrough` is exclusive, as `valid_until`) |
| `revision` | `so4ag:revision` |
| `knowledge_state` | `so4ag:knowledgeState` |
| `assertion_basis` | `so4ag:assertionBasis` |
| `scope` | `so4ag:scope`: list of `PropertyValue` (`propertyID` = key, `value` = value), always present |
| `evidence` | `so4ag:evidence`: `url`, `so4ag:observedAt`, `so4ag:kind`, `so4ag:issuer`, `so4ag:quote`, `so4ag:digest` |
| `note` | `so4ag:note` |
| `dispute` | `so4ag:dispute`: `so4ag:since`, `so4ag:conflictingClaim`, `so4ag:note` |
| `attestations` | `so4ag:attestation`: `@id`, `so4ag:issuer`, `so4ag:issuerRelation`, `so4ag:method`, `so4ag:claimDigest`, `so4ag:issuedAt`, `so4ag:expiresAt`, `so4ag:statusUrl`, `so4ag:credentialUrl` |
| `extensions` | `so4ag:extensions` (JSON literal) |

`description` is an optional human sentence and is ignored when reading.

### Values

| SO4AG value | JSON-LD |
|---|---|
| `money` | `MonetaryAmount`: `currency`, and `value` for an exact amount or **`minValue` for `bound: minimum`**; `so4ag:vatIncluded`; `so4ag:bound: exact` only when the manifest states it |
| `quantity` | `QuantitativeValue`: `value`, `unitText` (the SO4AG unit); `unitCode` is informative |
| `boolean` | JSON `true` / `false` |
| `text` | `{"@value": "...", "@language": "cs"}` |
| `enum` | `DefinedTerm` with `termCode` |
| `enum_set` | `ItemList` of `DefinedTerm` |
| `organization` | `Organization`: `name`, `identifier`, `url` |
| `place` | `Place`: `name`, `address` (`PostalAddress`: `streetAddress` = address line as published, `addressCountry`), `geo`, `openingHours` |

Amounts and quantities stay strings (`"99.00"`), exactly as in the manifest.

## Plain schema.org layer

For a `first_party` publisher the main subject may also carry plain schema.org properties that tools understand today: `hasMerchantReturnPolicy`, `hasShippingService`, `paymentAccepted`, `location`. This layer is derived, informative and ignored when reading. A claim enters it only when it is known, current at the time of rendering, not disputed, exact (not a starting amount) **and schema.org can express its whole scope**. A Saturday surcharge, a price for one vehicle or a payment method limited to business customers therefore stays only in `additionalProperty`, where its scope is not lost. A static copy of this layer does not expire by itself: re-export the page when facts change.

## Reading rules

The rules of SO4AG 0.1 apply unchanged: a claim outside its scope or validity is not used, `unknown` and `not_applicable` are never zero, a starting amount stays a minimum, and an attestation counts only when its digest matches the claim as read. The conformance suite runs the same cases against the file, the JSON-LD document and an HTML page with the JSON-LD inside.

## Vocabulary

Namespace `https://soqver.com/spec/so4ag/0.1/terms#`. Classes: `Source`, `Evidence`, `Attestation`. Properties: `version`, `revision`, `role`, `domain`, `relatedTo`, `contact`, `profile`, `links`, `type`, `knowledgeState`, `assertionBasis`, `scope`, `evidence`, `observedAt`, `kind`, `issuer`, `quote`, `digest`, `note`, `dispute`, `since`, `conflictingClaim`, `attestation`, `issuerRelation`, `method`, `claimDigest`, `issuedAt`, `expiresAt`, `statusUrl`, `credentialUrl`, `bound`, `vatIncluded`, `extensions`. Each has the meaning of the manifest member of the same name in SO4AG 0.1.
