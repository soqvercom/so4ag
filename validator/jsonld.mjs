// SO4AG 0.1 <-> JSON-LD (schema.org + so4ag terms). Apache-2.0.
// The JSON-LD rendition carries the same information as the manifest: converting a manifest to JSON-LD and back
// yields the same publisher, subjects, profiles, links and claims, and every claim keeps its digest.
// The order of claims is not significant and is not preserved (claims are grouped by subject).
import { claimDigest } from './index.mjs';

export const TERMS = 'https://soqver.com/spec/so4ag/0.1/terms#';
export const JSONLD_CONTEXT = ['https://schema.org', { so4ag: TERMS }];
const SOURCE_TYPE = 'so4ag:Source';

const def = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const idRef = (id) => ({ '@id': id });
const identOut = (list) => (list === undefined ? undefined : list.map((i) => ({ '@type': 'PropertyValue', propertyID: i.scheme, value: i.value })));
const identIn = (list) => (list === undefined ? undefined : list.map((i) => ({ scheme: i.propertyID, value: i.value })));
const propName = (uri) => { const i = String(uri).lastIndexOf('#'); return i >= 0 ? uri.slice(i + 1) : uri; };
const UNIT_CODE = { d: 'DAY', mo: 'MON', a: 'ANN', h: 'HUR', km: 'KMT' };   // UN/CEFACT, informative only

// ---------- values ----------
export function valueToJsonLd(v) {
  switch (v.type) {
    case 'money': return def({
      '@type': 'MonetaryAmount', currency: v.currency,
      ...(v.bound === 'minimum' ? { minValue: v.amount } : { value: v.amount }),
      'so4ag:bound': v.bound === 'exact' ? 'exact' : undefined,
      'so4ag:vatIncluded': v.vat_included,
    });
    case 'quantity': return def({ '@type': 'QuantitativeValue', value: v.value, unitText: v.unit, unitCode: UNIT_CODE[v.unit] });
    case 'boolean': return v.value;
    case 'text': return def({ '@value': v.value, '@language': v.lang });
    case 'enum': return { '@type': 'DefinedTerm', termCode: v.value };
    case 'enum_set': return { '@type': 'ItemList', itemListElement: v.values.map((x) => ({ '@type': 'DefinedTerm', termCode: x })) };
    case 'organization': return def({ '@type': 'Organization', name: v.name, identifier: identOut(v.identifiers), url: v.url });
    case 'place': return def({
      '@type': 'Place', name: v.name,
      address: v.address !== undefined || v.country !== undefined ? def({ '@type': 'PostalAddress', streetAddress: v.address, addressCountry: v.country }) : undefined,
      geo: v.geo ? { '@type': 'GeoCoordinates', latitude: v.geo.lat, longitude: v.geo.lon } : undefined,
      openingHours: v.opening_hours,
    });
    default: throw new Error(`unknown value type ${v.type}`);
  }
}

export function valueFromJsonLd(n) {
  if (typeof n === 'boolean') return { type: 'boolean', value: n };
  if (n && typeof n === 'object' && '@value' in n) return def({ type: 'text', value: n['@value'], lang: n['@language'] });
  switch (n?.['@type']) {
    case 'MonetaryAmount': return def({
      type: 'money', amount: 'minValue' in n ? n.minValue : n.value, currency: n.currency,
      vat_included: n['so4ag:vatIncluded'],
      bound: 'minValue' in n ? 'minimum' : n['so4ag:bound'],
    });
    case 'QuantitativeValue': return { type: 'quantity', value: n.value, unit: n.unitText };
    case 'DefinedTerm': return { type: 'enum', value: n.termCode };
    case 'ItemList': return { type: 'enum_set', values: n.itemListElement.map((x) => x.termCode) };
    case 'Organization': return def({ type: 'organization', name: n.name, identifiers: identIn(n.identifier), url: n.url });
    case 'Place': return def({
      type: 'place', name: n.name, address: n.address?.streetAddress, country: n.address?.addressCountry,
      geo: n.geo ? { lat: n.geo.latitude, lon: n.geo.longitude } : undefined,
      opening_hours: n.openingHours,
    });
    default: throw new Error('value node is not a known SO4AG value');
  }
}

// ---------- claims ----------
export function claimToJsonLd(c, { describe } = {}) {
  return def({
    '@type': 'PropertyValue',
    '@id': c.id,
    propertyID: c.property,
    name: propName(c.property),
    description: describe ? describe(c) || undefined : undefined,
    value: c.value !== undefined ? valueToJsonLd(c.value) : undefined,
    validFrom: c.valid_from,
    validThrough: c.valid_until,
    'so4ag:revision': c.revision,
    'so4ag:knowledgeState': c.knowledge_state,
    'so4ag:assertionBasis': c.assertion_basis,
    'so4ag:scope': Object.keys(c.scope).sort().map((k) => ({ '@type': 'PropertyValue', propertyID: k, value: c.scope[k] })),
    'so4ag:evidence': c.evidence?.map((e) => def({
      '@type': 'so4ag:Evidence', url: e.url, 'so4ag:observedAt': e.observed_at, 'so4ag:kind': e.kind,
      'so4ag:issuer': e.issuer, 'so4ag:quote': e.quote, 'so4ag:digest': e.digest,
    })),
    'so4ag:note': c.note,
    'so4ag:dispute': c.dispute ? def({
      'so4ag:since': c.dispute.since, 'so4ag:conflictingClaim': c.dispute.conflicting_claims?.map(idRef), 'so4ag:note': c.dispute.note,
    }) : undefined,
    'so4ag:attestation': c.attestations?.map((a) => def({
      '@type': 'so4ag:Attestation', '@id': a.id, 'so4ag:issuer': idRef(a.issuer), 'so4ag:issuerRelation': a.issuer_relation,
      'so4ag:method': a.method, 'so4ag:claimDigest': a.claim_digest, 'so4ag:issuedAt': a.issued_at, 'so4ag:expiresAt': a.expires_at,
      'so4ag:statusUrl': a.status_url, 'so4ag:credentialUrl': a.credential_url,
    })),
    'so4ag:extensions': c.extensions ? { '@type': '@json', '@value': c.extensions } : undefined,
  });
}

export function claimFromJsonLd(n, subject) {
  return def({
    id: n['@id'],
    revision: n['so4ag:revision'],
    subject,
    property: n.propertyID,
    knowledge_state: n['so4ag:knowledgeState'],
    scope: Object.fromEntries((n['so4ag:scope'] || []).map((s) => [s.propertyID, s.value])),
    assertion_basis: n['so4ag:assertionBasis'],
    valid_from: n.validFrom,
    valid_until: n.validThrough,
    value: n.value !== undefined ? valueFromJsonLd(n.value) : undefined,
    evidence: n['so4ag:evidence']?.map((e) => def({
      url: e.url, observed_at: e['so4ag:observedAt'], kind: e['so4ag:kind'], issuer: e['so4ag:issuer'], quote: e['so4ag:quote'], digest: e['so4ag:digest'],
    })),
    note: n['so4ag:note'],
    dispute: n['so4ag:dispute'] ? def({
      since: n['so4ag:dispute']['so4ag:since'], conflicting_claims: n['so4ag:dispute']['so4ag:conflictingClaim']?.map((x) => x['@id']), note: n['so4ag:dispute']['so4ag:note'],
    }) : undefined,
    attestations: n['so4ag:attestation']?.map((a) => def({
      id: a['@id'], issuer: a['so4ag:issuer']?.['@id'], issuer_relation: a['so4ag:issuerRelation'], method: a['so4ag:method'],
      claim_digest: a['so4ag:claimDigest'], issued_at: a['so4ag:issuedAt'], expires_at: a['so4ag:expiresAt'],
      status_url: a['so4ag:statusUrl'], credential_url: a['so4ag:credentialUrl'],
    })),
    extensions: n['so4ag:extensions']?.['@value'],
  });
}

// ---------- native schema.org layer (derived, informative) ----------
const PAY_TEXT = {
  card_online: 'Card online', credit_card: 'Credit card', debit_card: 'Debit card', bank_transfer: 'Bank transfer', cash_on_delivery: 'Cash on delivery',
  cash: 'Cash', apple_pay: 'Apple Pay', google_pay: 'Google Pay', invoice: 'Invoice', installments: 'Instalments',
};
const isCurrentKnown = (c, t) => c.knowledge_state === 'known' && !c.dispute && t >= Date.parse(c.valid_from) && t < Date.parse(c.valid_until);

/** Plain schema.org properties a search engine already understands, taken only from claims that are known and current at `now`. */
export function nativeLayer(claims, now = new Date()) {
  const t = now.getTime();
  const cur = claims.filter((c) => isCurrentKnown(c, t));
  // A claim enters the native layer only when schema.org can carry its whole scope; otherwise the condition would be lost.
  const by = (name, keys = []) => cur.filter((c) => propName(c.property) === name && Object.keys(c.scope).every((k) => keys.includes(k)));
  const out = {};
  const ret = by('returnPeriod', ['country']).filter((c) => c.value.type === 'quantity' && c.value.unit === 'd');
  if (ret.length) {
    out.hasMerchantReturnPolicy = ret.map((c) => def({
      '@type': 'MerchantReturnPolicy', applicableCountry: c.scope.country, returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: Number(c.value.value),
    }));
  }
  const pay = [...by('paymentMethods'), ...by('acceptedPaymentMethods', ['payment_purpose']).filter((c) => c.scope.payment_purpose === 'payment')].filter((c) => c.value.type === 'enum_set');
  if (pay.length) out.paymentAccepted = [...new Set(pay.flatMap((c) => c.value.values))].map((x) => PAY_TEXT[x] || x).join(', ');
  const ship = [];
  for (const c of by('shippingPrice', ['country', 'delivery_method']).filter((x) => x.value.type === 'money' && x.value.bound !== 'minimum' && x.scope.country)) {
    ship.push(def({
      '@type': 'ShippingService', name: c.scope.delivery_method && c.scope.delivery_method !== 'any' ? c.scope.delivery_method : undefined,
      shippingConditions: { '@type': 'ShippingConditions', shippingDestination: { '@type': 'DefinedRegion', addressCountry: c.scope.country },
        shippingRate: { '@type': 'MonetaryAmount', value: Number(c.value.amount), currency: c.value.currency } },
    }));
  }
  for (const c of by('freeShippingFrom', ['country']).filter((x) => x.value.type === 'money' && x.value.bound !== 'minimum' && x.scope.country)) {
    ship.push({
      '@type': 'ShippingService',
      shippingConditions: { '@type': 'ShippingConditions', shippingDestination: { '@type': 'DefinedRegion', addressCountry: c.scope.country },
        orderValue: { '@type': 'MonetaryAmount', minValue: Number(c.value.amount), currency: c.value.currency },
        shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: c.value.currency } },
    });
  }
  if (ship.length) out.hasShippingService = ship;
  return out;
}

// ---------- manifest ----------
const SUBJECT_BY_PROFILE = [[/\/rental$/, 'AutoRental'], [/\/retail$/, 'Store']];
const SCHEMA_TYPE = /^[A-Z][A-Za-z]{1,60}$/;

/**
 * Manifest -> JSON-LD document.
 * options: now (Date) for the native layer; native (default: only for first_party publishers); describe(claim) -> short human text.
 */
export function manifestToJsonLd(m, { now = new Date(), native, describe } = {}) {
  const withNative = native ?? m.publisher.role === 'first_party';
  const profileType = SUBJECT_BY_PROFILE.find(([re]) => (m.profiles || []).some((p) => re.test(p)))?.[1];
  const declared = new Map((m.subjects || []).map((s) => [s.id, s]));
  const order = [];
  const claimsBy = new Map();
  for (const s of m.subjects || []) { order.push(s.id); claimsBy.set(s.id, []); }
  for (const c of m.claims) {
    if (!claimsBy.has(c.subject)) { order.push(c.subject); claimsBy.set(c.subject, []); }
    claimsBy.get(c.subject).push(c);
  }
  const isBranch = (list) => list.length > 0 && list.every((c) => propName(c.property) === 'branch');
  const main = (m.subjects || [])[0]?.id || (claimsBy.has(m.publisher.id) ? m.publisher.id : order.find((id) => !isBranch(claimsBy.get(id))));
  const t = now.getTime();
  const nodes = order.map((id) => {
    const s = declared.get(id);
    const list = claimsBy.get(id);
    const branch = isBranch(list);
    const type = s?.type && SCHEMA_TYPE.test(s.type) ? s.type : branch ? (profileType || 'Place') : id === main ? (profileType || 'Organization') : 'Thing';
    const node = { '@type': type, '@id': id };
    if (s) Object.assign(node, def({ 'so4ag:type': s.type, name: s.name, url: s.url, identifier: identOut(s.identifiers) }));
    else if (id === m.publisher.id) Object.assign(node, def({ name: m.publisher.name, url: m.publisher.domain ? `https://${m.publisher.domain}/` : undefined }));
    if (branch && !s) {
      const place = list.find((c) => isCurrentKnown(c, t) && c.value.type === 'place');
      if (place) { const { '@type': _t, ...rest } = valueToJsonLd(place.value); Object.assign(node, rest); }
    }
    if (withNative && id === main) {
      Object.assign(node, nativeLayer(list, now));
      const branches = order.filter((x) => x !== id && isBranch(claimsBy.get(x)));
      if (branches.length) node.location = branches.map(idRef);
    }
    node.additionalProperty = list.map((c) => claimToJsonLd(c, { describe }));
    return node;
  });
  const source = def({
    '@type': 'CreativeWork',
    '@id': m.id,
    additionalType: SOURCE_TYPE,
    'so4ag:version': m.so4ag,
    version: m.revision,
    datePublished: m.published_at,     // no `expires` on the source: validity belongs to each claim (validThrough)
    publisher: def({
      '@type': 'Organization', '@id': m.publisher.id, name: m.publisher.name, 'so4ag:role': m.publisher.role, 'so4ag:domain': m.publisher.domain,
      identifier: identOut(m.publisher.identifiers), 'so4ag:relatedTo': m.publisher.related_to?.map(idRef), 'so4ag:contact': m.publisher.contact,
    }),
    'so4ag:profile': m.profiles?.map(idRef),
    about: m.subjects?.map((s) => idRef(s.id)),
    mainEntity: main ? idRef(main) : undefined,
    'so4ag:links': m.links ? Object.keys(m.links).sort().map((k) => ({ '@type': 'PropertyValue', propertyID: k, value: m.links[k] })) : undefined,
    'so4ag:extensions': m.extensions ? { '@type': '@json', '@value': m.extensions } : undefined,
  });
  return { '@context': JSONLD_CONTEXT, '@graph': [source, ...nodes] };
}

/** JSON-LD document (as produced by manifestToJsonLd) -> manifest. Throws when the document is not a SO4AG source. */
export function manifestFromJsonLd(doc) {
  const graph = Array.isArray(doc?.['@graph']) ? doc['@graph'] : null;
  if (!graph) throw new Error('document has no @graph');
  const src = graph.find((n) => n.additionalType === SOURCE_TYPE || n.additionalType === TERMS + 'Source');
  if (!src) throw new Error('no so4ag:Source node');
  const byId = new Map(graph.filter((n) => n !== src && n['@id']).map((n) => [n['@id'], n]));
  const p = src.publisher || {};
  const subjects = src.about?.map((r) => {
    const n = byId.get(r['@id']) || {};
    return def({ id: r['@id'], type: n['so4ag:type'], name: n.name, url: n.url, identifiers: identIn(n.identifier) });
  });
  const claims = [];
  for (const n of graph) {
    if (n === src || !Array.isArray(n.additionalProperty)) continue;
    for (const pv of n.additionalProperty) if (pv['so4ag:knowledgeState'] !== undefined) claims.push(claimFromJsonLd(pv, n['@id']));
  }
  return def({
    so4ag: src['so4ag:version'],
    id: src['@id'],
    revision: src.version,
    published_at: src.datePublished,
    publisher: def({
      id: p['@id'], name: p.name, role: p['so4ag:role'], domain: p['so4ag:domain'], identifiers: identIn(p.identifier),
      related_to: p['so4ag:relatedTo']?.map((x) => x['@id']), contact: p['so4ag:contact'],
    }),
    subjects,
    profiles: src['so4ag:profile']?.map((x) => x['@id']),
    claims,
    links: src['so4ag:links'] ? Object.fromEntries(src['so4ag:links'].map((l) => [l.propertyID, l.value])) : undefined,
    extensions: src['so4ag:extensions']?.['@value'],
  });
}

/** Extract SO4AG manifests from an HTML page: every <script type="application/ld+json"> block that holds a so4ag:Source. */
export function manifestsFromHtml(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let doc;
    try { doc = JSON.parse(m[1]); } catch { continue; }
    for (const d of Array.isArray(doc) ? doc : [doc]) {
      try { out.push(manifestFromJsonLd(d)); } catch { /* not a SO4AG source */ }
    }
  }
  return out;
}

/** Safe text for embedding a JSON-LD document into HTML. */
export const jsonLdScript = (doc) => `<script type="application/ld+json">${JSON.stringify(doc).replace(/</g, '\\u003c')}</script>`;

/** Claims sorted by id then revision: the comparable form of a manifest (claim order carries no meaning). */
export function comparable(m) {
  return { ...m, claims: [...m.claims].sort((a, b) => (a.id + '\u0000' + (a.revision || '')).localeCompare(b.id + '\u0000' + (b.revision || ''))) };
}

/** Compare two manifests claim by claim. Returns {same, added[], removed[], changed[]} keyed by claim id. */
export function diffClaims(ours, theirs) {
  const dig = (m) => new Map(m.claims.map((c) => [c.id, claimDigest(c)]));
  const a = dig(ours); const b = dig(theirs);
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const added = [...b.keys()].filter((k) => !a.has(k));
  const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k));
  return { same: !removed.length && !added.length && !changed.length, added, removed, changed };
}
