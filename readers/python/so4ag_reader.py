#!/usr/bin/env python3
"""Second SO4AG 0.1 reader (Python, standard library only, Apache-2.0).

Written separately from the reference implementation in validator/ and shares no code with it.
It reads a source from SO4AG JSON, from a JSON-LD document or from an HTML page with embedded JSON-LD,
and answers one question: may this claim be used for this task at this time?

  python so4ag_reader.py conformance <dir>      run the conformance suite
  python so4ag_reader.py ask <file> --property <uri-or-name> [--scope k=v ...] [--now ISO]
                                   [--review --trust <issuer-uri> ... --authenticated <attestation-id> ...]
                                   [--extension <uri> ...]
                                   [--profile <file> ...]   (your own profile documents)
                                   [--refuse-disputed] [--live-checked-at ISO]

A document of a version this reader does not know is refused, never read by the rules of another version.
--review without --trust accepts nothing: a matching digest ties an attestation to the wording of a claim,
it says nothing about who issued it. Whom to trust is the decision of the consumer, and a trusted name written in
the source is not a proof: an attestation counts only when the consumer has authenticated it with the issuer and
passes its id with --authenticated. A source with a malformed claim is refused as a whole. When several usable claims
answer one question with different values, the most specific one is used; when none is the most specific, all are
refused. A property the publisher lists as live is not used from a copy older than its max_age (needs_refresh).
A disputed claim is reported as a warning; a task with refuseDisputed makes it a reason.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SOURCE_TYPES = ("so4ag:Source", "https://soqver.com/spec/so4ag/0.1/terms#Source")
SUPPORTED_VERSIONS = ("0.1-draft", "0.2-draft")
# Edition of the rules this reader implements: the format version says how a document is written, the edition says how a
# reader decides. Every edition is an immutable tag of the public repository with its own conformance suite.
SPEC_EDITION = "0.1.5"
LIVE_EXT = "https://soqver.com/spec/so4ag/0.2/terms#live"
USAGE_EXT = "https://soqver.com/spec/so4ag/0.2/terms#usage"

# ISO 4217 codes in use and the number of decimals an amount is written with
_CUR = "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UYW UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG"
CURRENCY_DECIMALS = {c: 2 for c in _CUR.split()}
CURRENCY_DECIMALS.update({c: 0 for c in "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF".split()})
CURRENCY_DECIMALS.update({c: 3 for c in "BHD IQD JOD KWD LYD OMR TND".split()})
CURRENCY_DECIMALS.update({"CLF": 4, "UYW": 4})


def duration_seconds(text):
    """ISO 8601 duration such as PT1H or P30D -> seconds, or None."""
    m = re.fullmatch(r"P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", text or "")
    if not m:
        return None
    y, mo, w, d, h, mi, sec = (int(x or 0) for x in m.groups())
    return ((((y * 365 + mo * 30 + w * 7 + d) * 24 + h) * 60 + mi) * 60) + sec


class UnsupportedVersion(ValueError):
    """The document says it is another version of the format (or says no version at all)."""

    def __init__(self, code, version):
        super().__init__(code + (": " + str(version) if version is not None else ""))
        self.code, self.version = code, version


class InvalidSource(ValueError):
    """The document breaks a structural rule of the format; no claim of it may be used."""
    code = "invalid_source"


VOCABULARIES = ("https://soqver.com/spec/so4ag/0.1/terms#", "https://soqver.botrento.com/spec/so4ag/0.1/terms#")
STATES = ("known", "unknown", "not_applicable")


def well_formed(claim):
    """The structural rules a reader checks itself before it decides anything about a claim."""
    try:
        if not isinstance(claim, dict) or not isinstance(claim.get("scope"), dict):
            return False
        if claim.get("knowledge_state") not in STATES:
            return False
        if not all(isinstance(claim.get(k), str) and claim.get(k) for k in ("id", "subject", "property", "valid_from", "valid_until")):
            return False
        if not all(isinstance(v, str) and v for v in claim["scope"].values()):
            return False
        if not instant(claim["valid_until"]) > instant(claim["valid_from"]):
            return False
        if claim["knowledge_state"] == "known":
            value = claim.get("value")
            if value is None or not isinstance(claim.get("evidence"), list) or len(claim["evidence"]) == 0:
                return False
            if isinstance(value, dict) and value.get("type") == "money":
                # an amount in a currency that does not exist, or with other decimals than the currency has, is not a price
                decimals = CURRENCY_DECIMALS.get(value.get("currency"))
                amount = value.get("amount")
                if decimals is None or not isinstance(amount, str) or not re.fullmatch(r"\d+(?:\.\d+)?", amount):
                    return False
                if len(amount.partition(".")[2]) != decimals:
                    return False
            return True
        return "value" not in claim
    except (ValueError, TypeError, KeyError):
        return False


def check_source(source):
    """Refuses a source with a claim that is not well formed. This reader has no JSON Schema validator; it checks the rules
    the conformance suite lists. A full check against the schema is the job of a validator."""
    if not isinstance(source.get("claims"), list) or not all(well_formed(c) for c in source["claims"]):
        raise InvalidSource("invalid_source")
    return source


# ---------- canonical JSON (RFC 8785 for the values SO4AG uses) and claim digest ----------
def canonical(v):
    if isinstance(v, dict):
        keys = sorted(v, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical(v[k]) for k in keys) + "}"
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (int, float)):
        return es_number(v)
    raise ValueError("value cannot be canonicalised")


def es_number(x):
    """A number written the way ECMAScript writes it, which is what RFC 8785 requires (0.000001, 1e-7, 1e+21)."""
    if isinstance(x, int) and abs(x) < 2 ** 53:
        return str(x)
    x = float(x)
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError("non-finite number")
    if x == 0:
        return "0"
    sign, x = ("-" if x < 0 else ""), abs(x)
    mantissa, _, exponent = repr(x).partition("e")
    whole, _, frac = mantissa.partition(".")
    digits = whole + frac
    point = len(whole) + (int(exponent) if exponent else 0)          # value = 0.digits * 10 ** point
    lead = len(digits) - len(digits.lstrip("0"))
    digits, point = digits[lead:].rstrip("0"), point - lead
    k = len(digits)
    if k <= point <= 21:
        return sign + digits + "0" * (point - k)
    if 0 < point <= 21:
        return sign + digits[:point] + "." + digits[point:]
    if -6 < point <= 0:
        return sign + "0." + "0" * (-point) + digits
    e = point - 1
    return sign + digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def claim_digest(claim):
    body = {k: v for k, v in claim.items() if k != "attestations"}
    return "sha256:" + hashlib.sha256(canonical(body).encode("utf-8")).hexdigest()


# ---------- time ----------
def instant(text):
    t = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


# ---------- the consumer rules ----------
def scope_keys_of(property_uri, profiles):
    for p in profiles:
        ns = p["namespace"]
        if property_uri.startswith(ns) and property_uri[len(ns):] in p["properties"]:
            return set(p.get("scope_keys", {}))
    return set()


def warnings_of(claim, task=None):
    """What is reported about a claim without blocking its use. A dispute is a warning unless the task refuses disputed claims."""
    return ["disputed"] if claim.get("dispute") and not (task or {}).get("refuseDisputed") else []


def evaluate(claim, task, now, profiles, source_extensions=None, known_extensions=(), published_at=None, live_checked_at=None):
    """Returns (usable, reasons, value). Every reason blocks the use; see warnings_of() for what is only reported.
    known_extensions: URIs of the extensions this consumer implements; source_extensions: `extensions` of the whole source.
    published_at: when the source in hand was published; live_checked_at: when the consumer asked the live endpoint."""
    if not well_formed(claim):
        return False, ["invalid_claim"], None
    reasons = []
    for uri, ext in list((source_extensions or {}).items()) + list((claim.get("extensions") or {}).items()):
        if isinstance(ext, dict) and ext.get("affects_use") is True and uri != LIVE_EXT and uri not in known_extensions:
            reasons.append("unknown_required_extension:" + uri)
    # Live rule: a property the publisher lists as live is usable only while the copy in hand is younger than max_age.
    # No fetching happens here: without a fresh copy the answer is needs_refresh, never a stale value.
    live = ((source_extensions or {}).get(LIVE_EXT) or {}).get("value")
    rule = next((l for l in live if isinstance(l, dict) and l.get("property") == claim["property"]), None) if isinstance(live, list) else None
    if rule is not None:
        limit = duration_seconds(rule.get("max_age"))
        try:
            as_of = live_checked_at or published_at
            as_of = instant(as_of) if isinstance(as_of, str) else as_of
            age = (now - as_of).total_seconds()
            fresh = bool(limit) and -300 <= age <= limit
        except (TypeError, ValueError, AttributeError):
            fresh = False
        if not fresh:
            reasons.append("needs_refresh")
    if task.get("property") and task["property"] != claim["property"]:
        reasons.append("property_mismatch")
    if task.get("subject") and task["subject"] != claim["subject"]:
        reasons.append("subject_mismatch")
    asked = task.get("scope") or {}
    # the keys the consumer can compare: its own list, otherwise the keys of the profile that defines the property
    # plus every key the task gives a value for
    understood = set(task["understoodScopeKeys"]) if "understoodScopeKeys" in task else scope_keys_of(claim["property"], profiles) | set(asked)
    for key, limit in claim["scope"].items():
        if key not in understood:
            reasons.append("scope_not_comparable:" + key)
        elif key not in asked:
            reasons.append("scope_not_in_task:" + key)
        elif limit != "any" and scope_text(asked[key]) != limit:
            reasons.append("scope_mismatch:" + key)
    if now < instant(claim["valid_from"]):
        reasons.append("not_yet_valid")
    if now >= instant(claim["valid_until"]):
        reasons.append("expired")
    if claim.get("dispute") and task.get("refuseDisputed"):
        reasons.append("disputed")
    if claim["knowledge_state"] != "known":
        reasons.append(claim["knowledge_state"])
    if task.get("requireReview"):
        trusted = task.get("trustedIssuers")
        if not isinstance(trusted, list):
            reasons.append("no_trust_policy")          # without the consumer's own list nothing is independently reviewed
        else:
            digest = claim_digest(claim)
            matching = [
                a for a in claim.get("attestations", [])
                if a.get("claim_digest") == digest
                and a.get("issuer_relation") == "independent"
                and a.get("issuer") in trusted
                and instant(a["issued_at"]) <= now < instant(a["expires_at"])
            ]
            # The attestation sits in the publisher's own file: a trusted name written there proves nothing. It counts only
            # when the consumer has authenticated it with the issuer and lists its id.
            authenticated = task.get("authenticatedAttestations") or []
            if not matching:
                reasons.append("no_valid_independent_attestation")
            elif not any(a.get("id") in authenticated for a in matching):
                reasons.append("attestation_not_authenticated")
    usable = not reasons
    return usable, sorted(reasons), (claim.get("value") if usable else None)


def select(claims, task, now, profiles, source_extensions=None, known_extensions=(), published_at=None, live_checked_at=None):
    """Evaluates every claim that matches the property of the task. When several usable claims answer the same subject and
    property with different values, the most specific one wins (its scope limits every key the others limit, and more) and
    the others get less_specific; when no claim is the most specific, or the most specific ones disagree, all are refused
    (conflicting_claims). Returns [(claim, usable, reasons, value)], usable first."""
    prop = task.get("property")
    rows = []
    for c in claims:
        if prop and c.get("property") != prop:
            continue
        usable, reasons, value = evaluate(c, task, now, profiles, source_extensions, known_extensions, published_at, live_checked_at)
        rows.append([c, usable, reasons, value])
    groups = {}
    for row in rows:
        if row[1]:
            c = row[0]
            groups.setdefault(canonical([c["subject"], c["property"]]), []).append(row)
    for group in groups.values():
        if len({canonical(r[0]["value"]) for r in group}) < 2:
            continue                                           # they all say the same
        # the keys a claim really limits ("any" limits nothing); every usable claim agrees with the task on them
        limits = [{k for k, v in r[0]["scope"].items() if v != "any"} for r in group]
        top = [i for i in range(len(group)) if not any(j != i and limits[i] < limits[j] for j in range(len(group)))]
        ordered = len({canonical(group[i][0]["value"]) for i in top}) == 1 and all(
            i in top or all(limits[i] <= limits[j] for j in top) for i in range(len(group)))
        for i, r in enumerate(group):
            if not ordered:
                r[1], r[2], r[3] = False, sorted(r[2] + ["conflicting_claims"]), None
            elif i not in top:
                r[1], r[2], r[3] = False, sorted(r[2] + ["less_specific"]), None
    rows.sort(key=lambda r: not r[1])
    return [tuple(r) for r in rows]


def scope_text(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v)


# ---------- reading JSON-LD ----------
def identifiers(node_list):
    return [{"scheme": i["propertyID"], "value": i["value"]} for i in node_list]


def value_from_node(n):
    if isinstance(n, bool):
        return {"type": "boolean", "value": n}
    if "@value" in n:
        out = {"type": "text", "value": n["@value"]}
        if "@language" in n:
            out["lang"] = n["@language"]
        return out
    kind = n.get("@type")
    if kind == "MonetaryAmount":
        out = {"type": "money", "amount": n["minValue"] if "minValue" in n else n["value"], "currency": n["currency"]}
        if "so4ag:vatIncluded" in n:
            out["vat_included"] = n["so4ag:vatIncluded"]
        if "minValue" in n:
            out["bound"] = "minimum"
        elif "so4ag:bound" in n:
            out["bound"] = n["so4ag:bound"]
        return out
    if kind == "QuantitativeValue":
        return {"type": "quantity", "value": n["value"], "unit": n["unitText"]}
    if kind == "DefinedTerm":
        return {"type": "enum", "value": n["termCode"]}
    if kind == "ItemList":
        return {"type": "enum_set", "values": [x["termCode"] for x in n["itemListElement"]]}
    if kind == "Organization":
        out = {"type": "organization", "name": n["name"]}
        if "identifier" in n:
            out["identifiers"] = identifiers(n["identifier"])
        if "url" in n:
            out["url"] = n["url"]
        return out
    if kind == "Place":
        out = {"type": "place", "name": n["name"]}
        address = n.get("address") or {}
        if "streetAddress" in address:
            out["address"] = address["streetAddress"]
        if "addressCountry" in address:
            out["country"] = address["addressCountry"]
        if "geo" in n:
            out["geo"] = {"lat": n["geo"]["latitude"], "lon": n["geo"]["longitude"]}
        if "openingHours" in n:
            out["opening_hours"] = n["openingHours"]
        return out
    raise ValueError("unknown value node")


def copy_fields(src, pairs):
    return {to: src[frm] for frm, to in pairs if frm in src}


def claim_from_node(pv, subject):
    c = {"id": pv["@id"], "subject": subject, "property": pv["propertyID"],
         "knowledge_state": pv["so4ag:knowledgeState"], "assertion_basis": pv["so4ag:assertionBasis"],
         "valid_from": pv["validFrom"], "valid_until": pv["validThrough"],
         "scope": {s["propertyID"]: s["value"] for s in pv.get("so4ag:scope", [])}}
    if "so4ag:revision" in pv:
        c["revision"] = pv["so4ag:revision"]
    if "value" in pv:
        c["value"] = value_from_node(pv["value"])
    if "so4ag:evidence" in pv:
        c["evidence"] = [copy_fields(e, [("url", "url"), ("so4ag:observedAt", "observed_at"), ("so4ag:kind", "kind"),
                                         ("so4ag:issuer", "issuer"), ("so4ag:quote", "quote"), ("so4ag:digest", "digest")])
                         for e in pv["so4ag:evidence"]]
    if "so4ag:note" in pv:
        c["note"] = pv["so4ag:note"]
    if "so4ag:dispute" in pv:
        d = pv["so4ag:dispute"]
        c["dispute"] = copy_fields(d, [("so4ag:since", "since"), ("so4ag:note", "note")])
        if "so4ag:conflictingClaim" in d:
            c["dispute"]["conflicting_claims"] = [x["@id"] for x in d["so4ag:conflictingClaim"]]
    if "so4ag:attestation" in pv:
        c["attestations"] = []
        for a in pv["so4ag:attestation"]:
            item = copy_fields(a, [("@id", "id"), ("so4ag:issuerRelation", "issuer_relation"), ("so4ag:method", "method"),
                                   ("so4ag:claimDigest", "claim_digest"), ("so4ag:issuedAt", "issued_at"),
                                   ("so4ag:expiresAt", "expires_at"), ("so4ag:statusUrl", "status_url"),
                                   ("so4ag:credentialUrl", "credential_url")])
            if "so4ag:issuer" in a:
                item["issuer"] = a["so4ag:issuer"]["@id"]
            c["attestations"].append(item)
    if "so4ag:extensions" in pv:
        c["extensions"] = pv["so4ag:extensions"]["@value"]
    return c


def check_version(version):
    if version is None:
        raise UnsupportedVersion("missing_version", None)
    if version not in SUPPORTED_VERSIONS:
        raise UnsupportedVersion("unsupported_version", version)
    return version


def source_from_jsonld(doc):
    """JSON-LD -> {"version", "claims", "extensions"}; refuses a source of another version."""
    graph = doc.get("@graph")
    if not isinstance(graph, list):
        raise ValueError("not a SO4AG source")
    # the prefix so4ag: must mean our vocabulary; a document that binds it to anything else only looks alike
    context = doc.get("@context")
    bound = [c.get("so4ag") for c in (context if isinstance(context, list) else [context]) if isinstance(c, dict) and "so4ag" in c]
    if not bound or not all(b in VOCABULARIES for b in bound):
        raise ValueError("the @context does not bind so4ag: to the SO4AG 0.1 vocabulary")
    head = next((n for n in graph if n.get("additionalType") in SOURCE_TYPES), None)
    if head is None:
        raise ValueError("not a SO4AG source")
    version = check_version(head.get("so4ag:version"))
    extensions = (head.get("so4ag:extensions") or {}).get("@value")
    return check_source({"version": version, "claims": claims_from_jsonld(doc), "extensions": extensions, "published_at": head.get("datePublished")})


def claims_from_jsonld(doc):
    graph = doc.get("@graph")
    if not isinstance(graph, list) or not any(n.get("additionalType") in SOURCE_TYPES for n in graph):
        raise ValueError("not a SO4AG source")
    claims = []
    for node in graph:
        if node.get("additionalType") in SOURCE_TYPES:
            continue
        for pv in node.get("additionalProperty", []):
            if "so4ag:knowledgeState" in pv:
                claims.append(claim_from_node(pv, node["@id"]))
    return claims


DEFAULT_KEYS = ("subject", "assertion_basis", "valid_from", "valid_until", "evidence", "scope")


def expand02(doc):
    """SO4AG 0.2 -> claims written out in full: file defaults applied, null = the claim has no such field."""
    defaults = doc.get("defaults") or {}
    out = []
    for claim in doc.get("claims", []):
        c = dict(claim)
        for k in DEFAULT_KEYS:
            if k in c and c[k] is None:
                del c[k]
            elif k not in c and k in defaults:
                c[k] = json.loads(json.dumps(defaults[k]))
        c.setdefault("scope", {})
        out.append(c)
    return out


def read_source(text):
    """SO4AG JSON (0.1 or 0.2), JSON-LD, or an HTML page with JSON-LD blocks -> {"version", "claims", "extensions", "published_at"}.
    Raises UnsupportedVersion when the document is of a version this reader does not implement."""
    stripped = text.lstrip()
    if stripped.startswith("{"):
        doc = json.loads(text)
        if "@graph" in doc:
            return source_from_jsonld(doc)
        version = check_version(doc.get("so4ag"))
        claims = expand02(doc) if version == "0.2-draft" else doc["claims"]
        extensions = doc.get("extensions")
        if version == "0.2-draft":
            # usage is information; the live rule decides whether a stored value may be used, so it is carried as required
            extensions = dict(extensions or {})
            if doc.get("usage"):
                extensions[USAGE_EXT] = {"affects_use": False, "value": doc["usage"]}
            if doc.get("live"):
                extensions[LIVE_EXT] = {"affects_use": True, "value": doc["live"]}
        return check_source({"version": version, "claims": claims, "extensions": extensions, "published_at": doc.get("published_at")})
    for block in re.findall(r'<script\b[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>', text, re.S | re.I):
        try:
            doc = json.loads(block)
        except ValueError:
            continue
        for d in doc if isinstance(doc, list) else [doc]:
            try:
                return source_from_jsonld(d)
            except (UnsupportedVersion, InvalidSource):
                raise
            except (ValueError, AttributeError):
                pass
    raise ValueError("no SO4AG source found")


def claims_from_text(text):
    """The claims of a source of a supported version (see read_source for the extensions of the source)."""
    return read_source(text)["claims"]


# ---------- command line ----------
def load_profiles(root):
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(Path(root).glob("*.json"))]


def builtin_profiles():
    """Profiles of the format: from the repository when run from a checkout, otherwise the copies installed with the package."""
    here = Path(__file__).resolve().parent
    for root in (here.parent.parent / "spec" / "profiles", here / "so4ag_profiles"):
        found = load_profiles(root)
        if found:
            return found
    return []


def run_conformance(folder):
    folder = Path(folder)
    profiles = load_profiles(folder.parent.parent / "profiles")
    failed = total = 0

    def check(ok, label):
        nonlocal failed, total
        total += 1
        if not ok:
            failed += 1
            print("FAIL", label)

    digests = json.loads((folder / "digests.json").read_text(encoding="utf-8"))
    sources = {}
    for name in ("shop", "rental"):
        native = json.loads((folder / f"{name}.json").read_text(encoding="utf-8"))["claims"]
        from_ld = claims_from_text((folder / f"{name}.jsonld").read_text(encoding="utf-8"))
        html = '<html><head><script type="application/ld+json">' + (folder / f"{name}.jsonld").read_text(encoding="utf-8") + "</script></head></html>"
        from_html = claims_from_text(html)
        sources[name + ".json"] = {"so4ag": native, "jsonld": from_ld, "html": from_html}
        for form, claims in sources[name + ".json"].items():
            check(len(claims) == len(native), f"{name} {form}: number of claims")
            for c in claims:
                check(claim_digest(c) == digests.get(c["id"]), f"{name} {form}: digest of {c['id']}")
    cases = json.loads((folder / "evaluation.json").read_text(encoding="utf-8"))["cases"]
    for case in cases:
        for form, claims in sources[case["manifest"]].items():
            claim = next(c for c in claims if c["id"] == case["claim"])
            usable, reasons, value = evaluate(claim, case["task"], instant(case["now"]), profiles,
                                              known_extensions=case.get("knownExtensions", ()))
            want = case["expect"]
            check(usable == want["usable"] and reasons == want["reasons"] and value == want["value"]
                  and warnings_of(claim, case["task"]) == want.get("warnings", []),
                  f"{case['id']} ({form}) {case['title']}: got {usable} {reasons} {warnings_of(claim, case['task'])}")
    # whole sources: version of the format and extensions of the source; canonical form of numbers and strings
    extra = folder / "sources.json"
    n_sources = n_vectors = 0
    if extra.exists():
        for case in json.loads(extra.read_text(encoding="utf-8"))["cases"]:
            n_sources += 1
            want = case.get("expect") or {}
            try:
                src = read_source(json.dumps(case["document"]))
            except (UnsupportedVersion, InvalidSource) as err:
                check(want.get("error") == err.code, f"{case['id']} {case['title']}: got {err.code}")
                continue
            if "task" in case:                     # one task, the expected result of every claim
                found = select(src["claims"], case["task"], instant(case["now"]), profiles, source_extensions=src["extensions"],
                               known_extensions=case.get("knownExtensions", ()), published_at=src.get("published_at"),
                               live_checked_at=case.get("liveCheckedAt"))
                for end, wanted in case["claims"].items():
                    _, usable, reasons, value = next(r for r in found if r[0]["id"].endswith(end))
                    check(usable == wanted["usable"] and reasons == sorted(wanted.get("reasons", [])) and (usable or value is None),
                          f"{case['id']} {case['title']}: {end} got {usable} {reasons}")
                check(len({canonical(r[3]) for r in found if r[1]}) <= 1, f"{case['id']}: two usable answers with different values")
                continue
            if "error" in want:
                check(False, f"{case['id']} {case['title']}: the source was read, {want['error']} expected")
                continue
            for c in src["claims"]:
                found = select(src["claims"], {"property": c["property"], "scope": c["scope"]}, instant(case["now"]), profiles,
                               source_extensions=src["extensions"], known_extensions=case.get("knownExtensions", ()),
                               published_at=src.get("published_at"))
                _, usable, reasons, _ = next(r for r in found if r[0]["id"] == c["id"])
                check(usable == want["usable"] and all(r in reasons for r in want.get("reasons", [])), f"{case['id']} {case['title']}: got {usable} {reasons}")
    # reading a 0.2 file: the live rule must survive (a stored value older than max_age is not used)
    n_reading = 0
    reading = folder.parent / "0.2" / "reading.json"
    if reading.exists():
        for case in json.loads(reading.read_text(encoding="utf-8"))["cases"]:
            n_reading += 1
            src = read_source(json.dumps(case["document"]))
            found = select(src["claims"], case["task"], instant(case["now"]), profiles, source_extensions=src["extensions"],
                           published_at=src.get("published_at"), live_checked_at=case.get("liveCheckedAt"))
            for end, wanted in case["claims"].items():
                _, usable, reasons, value = next(r for r in found if r[0]["id"].endswith(end))
                check(usable == wanted["usable"] and reasons == sorted(wanted.get("reasons", [])) and (usable or value is None),
                      f"{case['id']} {case['title']}: {end} got {usable} {reasons}")
    vectors = folder / "canonical.json"
    if vectors.exists():
        for vec in json.loads(vectors.read_text(encoding="utf-8"))["vectors"]:
            n_vectors += 1
            check(canonical(vec["value"]) == vec["canonical"], f"canonical form of {vec['canonical']}: got {canonical(vec['value'])}")
    print(f"{total - failed}/{total} checks passed ({len(cases)} evaluation cases x 3 input forms, digests of every claim, "
          f"{n_sources} whole-source cases, {n_reading} reading cases of the 0.2 draft, {n_vectors} canonical vectors)")
    return 1 if failed else 0


def run_ask(argv):
    path, prop, scope, now, review, trust, known = argv[0], None, {}, datetime.now(timezone.utc), False, None, []
    extra_profiles = []
    authenticated = []
    refuse_disputed, live_checked_at = False, None
    i = 1
    while i < len(argv):
        if argv[i] == "--property":
            prop = argv[i + 1]; i += 2
        elif argv[i] == "--scope":
            k, _, v = argv[i + 1].partition("="); scope[k] = v; i += 2
        elif argv[i] == "--now":
            now = instant(argv[i + 1]); i += 2
        elif argv[i] == "--review":
            review = True; i += 1
        elif argv[i] == "--trust":
            trust = (trust or []) + [argv[i + 1]]; i += 2
        elif argv[i] == "--extension":
            known.append(argv[i + 1]); i += 2
        elif argv[i] == "--authenticated":
            authenticated.append(argv[i + 1]); i += 2
        elif argv[i] == "--refuse-disputed":
            refuse_disputed = True; i += 1
        elif argv[i] == "--live-checked-at":
            live_checked_at = instant(argv[i + 1]); i += 2
        elif argv[i] == "--profile":
            extra_profiles.append(json.loads(Path(argv[i + 1]).read_text(encoding="utf-8"))); i += 2
        else:
            raise SystemExit("unknown argument " + argv[i])
    profiles = builtin_profiles() + extra_profiles
    try:
        source = read_source(Path(path).read_text(encoding="utf-8"))
    except UnsupportedVersion as err:
        print(json.dumps({"error": err.code, "version": err.version, "supported": list(SUPPORTED_VERSIONS)}, ensure_ascii=False, indent=2))
        return 1
    except InvalidSource as err:
        print(json.dumps({"error": err.code}, ensure_ascii=False, indent=2))
        return 1
    out = []
    asked = [c for c in source["claims"] if not prop or c["property"] == prop or c["property"].endswith("#" + prop)]
    for uri in sorted({c["property"] for c in asked}):
        task = {"property": uri, "scope": scope, "requireReview": review, "authenticatedAttestations": authenticated, "refuseDisputed": refuse_disputed}
        if trust is not None:
            task["trustedIssuers"] = trust
        for c, usable, reasons, value in select(source["claims"], task, now, profiles, source_extensions=source["extensions"], known_extensions=known,
                                                published_at=source.get("published_at"), live_checked_at=live_checked_at):
            out.append({"claim": c["id"], "usable": usable, "reasons": reasons, "warnings": warnings_of(c, task), "value": value, "scope": c["scope"], "valid_until": c["valid_until"]})
    out.sort(key=lambda r: not r["usable"])
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "conformance":
        return run_conformance(sys.argv[2])
    if len(sys.argv) >= 3 and sys.argv[1] == "ask":
        return run_ask(sys.argv[2:])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
