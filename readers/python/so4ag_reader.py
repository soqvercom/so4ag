#!/usr/bin/env python3
"""Second SO4AG 0.1 reader (Python, standard library only, Apache-2.0).

Written separately from the reference implementation in validator/ and shares no code with it.
It reads a source from SO4AG JSON, from a JSON-LD document or from an HTML page with embedded JSON-LD,
and answers one question: may this claim be used for this task at this time?

  python so4ag_reader.py conformance <dir>      run the conformance suite
  python so4ag_reader.py ask <file> --property <uri-or-name> [--scope k=v ...] [--now ISO]
                                   [--review --trust <issuer-uri> ...] [--extension <uri> ...]
                                   [--profile <file> ...]   (your own profile documents)

A document of a version this reader does not know is refused, never read by the rules of another version.
--review without --trust accepts nothing: a matching digest ties an attestation to the wording of a claim,
it says nothing about who issued it. Whom to trust is the decision of the consumer.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SOURCE_TYPES = ("so4ag:Source", "https://soqver.com/spec/so4ag/0.1/terms#Source")
SUPPORTED_VERSIONS = ("0.1-draft", "0.2-draft")


class UnsupportedVersion(ValueError):
    """The document says it is another version of the format (or says no version at all)."""

    def __init__(self, code, version):
        super().__init__(code + (": " + str(version) if version is not None else ""))
        self.code, self.version = code, version


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


def evaluate(claim, task, now, profiles, source_extensions=None, known_extensions=()):
    """Returns (usable, reasons, value). `disputed` is reported but does not block.
    known_extensions: URIs of the extensions this consumer implements; source_extensions: `extensions` of the whole source."""
    reasons = []
    for uri, ext in list((source_extensions or {}).items()) + list((claim.get("extensions") or {}).items()):
        if isinstance(ext, dict) and ext.get("affects_use") is True and uri not in known_extensions:
            reasons.append("unknown_required_extension:" + uri)
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
    if claim.get("dispute"):
        reasons.append("disputed")
    if claim["knowledge_state"] != "known":
        reasons.append(claim["knowledge_state"])
    if task.get("requireReview"):
        trusted = task.get("trustedIssuers")
        if not isinstance(trusted, list):
            reasons.append("no_trust_policy")          # without the consumer's own list nothing is independently reviewed
        else:
            digest = claim_digest(claim)
            accepted = any(
                a.get("claim_digest") == digest
                and a.get("issuer_relation") == "independent"
                and a.get("issuer") in trusted
                and instant(a["issued_at"]) <= now < instant(a["expires_at"])
                for a in claim.get("attestations", [])
            )
            if not accepted:
                reasons.append("no_valid_independent_attestation")
    usable = all(r == "disputed" for r in reasons)
    return usable, sorted(reasons), (claim.get("value") if usable else None)


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
    head = next((n for n in graph if n.get("additionalType") in SOURCE_TYPES), None)
    if head is None:
        raise ValueError("not a SO4AG source")
    version = check_version(head.get("so4ag:version"))
    extensions = (head.get("so4ag:extensions") or {}).get("@value")
    return {"version": version, "claims": claims_from_jsonld(doc), "extensions": extensions}


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
    """SO4AG JSON (0.1 or 0.2), JSON-LD, or an HTML page with JSON-LD blocks -> {"version", "claims", "extensions"}.
    Raises UnsupportedVersion when the document is of a version this reader does not implement."""
    stripped = text.lstrip()
    if stripped.startswith("{"):
        doc = json.loads(text)
        if "@graph" in doc:
            return source_from_jsonld(doc)
        version = check_version(doc.get("so4ag"))
        claims = expand02(doc) if version == "0.2-draft" else doc["claims"]
        return {"version": version, "claims": claims, "extensions": doc.get("extensions")}
    for block in re.findall(r'<script\b[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>', text, re.S | re.I):
        try:
            doc = json.loads(block)
        except ValueError:
            continue
        for d in doc if isinstance(doc, list) else [doc]:
            try:
                return source_from_jsonld(d)
            except UnsupportedVersion:
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
            check(usable == want["usable"] and reasons == want["reasons"] and value == want["value"],
                  f"{case['id']} ({form}) {case['title']}: got {usable} {reasons}")
    # whole sources: version of the format and extensions of the source; canonical form of numbers and strings
    extra = folder / "sources.json"
    n_sources = n_vectors = 0
    if extra.exists():
        for case in json.loads(extra.read_text(encoding="utf-8"))["cases"]:
            n_sources += 1
            want = case["expect"]
            try:
                src = read_source(json.dumps(case["document"]))
            except UnsupportedVersion as err:
                check(want.get("error") == err.code, f"{case['id']} {case['title']}: got {err.code}")
                continue
            if "error" in want:
                check(False, f"{case['id']} {case['title']}: the source was read, {want['error']} expected")
                continue
            for c in src["claims"]:
                usable, reasons, _ = evaluate(c, {"property": c["property"], "scope": c["scope"]}, instant(case["now"]), profiles,
                                              source_extensions=src["extensions"], known_extensions=case.get("knownExtensions", ()))
                check(usable == want["usable"] and all(r in reasons for r in want.get("reasons", [])), f"{case['id']} {case['title']}: got {usable} {reasons}")
    vectors = folder / "canonical.json"
    if vectors.exists():
        for vec in json.loads(vectors.read_text(encoding="utf-8"))["vectors"]:
            n_vectors += 1
            check(canonical(vec["value"]) == vec["canonical"], f"canonical form of {vec['canonical']}: got {canonical(vec['value'])}")
    print(f"{total - failed}/{total} checks passed ({len(cases)} evaluation cases x 3 input forms, digests of every claim, "
          f"{n_sources} whole-source cases, {n_vectors} canonical vectors)")
    return 1 if failed else 0


def run_ask(argv):
    path, prop, scope, now, review, trust, known = argv[0], None, {}, datetime.now(timezone.utc), False, None, []
    extra_profiles = []
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
    out = []
    for c in source["claims"]:
        if prop and c["property"] != prop and not c["property"].endswith("#" + prop):
            continue
        task = {"property": c["property"], "scope": scope, "requireReview": review}
        if trust is not None:
            task["trustedIssuers"] = trust
        usable, reasons, value = evaluate(c, task, now, profiles, source_extensions=source["extensions"], known_extensions=known)
        out.append({"claim": c["id"], "usable": usable, "reasons": reasons, "value": value, "scope": c["scope"], "valid_until": c["valid_until"]})
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
