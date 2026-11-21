# so4ag (Python reader)

Reader for [SO4AG](https://soqver.com/spec/so4ag/0.1/), the open format for business facts that carry their meaning,
scope, origin and validity. It answers one question: may this fact be used for this task at this time, and if not, why not?

Standard library only. It reads SO4AG JSON, the JSON-LD form, or an HTML page with the JSON-LD embedded.

```bash
pip install so4ag
# examples/valid/rental-first-party.json from https://github.com/soqvercom/so4ag
so4ag ask rental-first-party.json --property refundableDeposit --scope vehicle_class=economy   --scope branch=https://rental.example/branches/prague-airport
# the same question without the branch: not usable, the claim holds for one branch only
so4ag ask rental-first-party.json --property refundableDeposit --scope vehicle_class=economy
# the same question at another time
so4ag ask rental-first-party.json --property refundableDeposit --scope vehicle_class=economy   --scope branch=https://rental.example/branches/prague-airport --now 2027-06-01T12:00:00Z
```

```python
import json
from pathlib import Path
from so4ag_reader import read_source, evaluate, builtin_profiles, instant

source = read_source(Path("rental-first-party.json").read_text(encoding="utf-8"))
task = {"property": "https://soqver.com/spec/so4ag/0.1/rental#refundableDeposit",
        "scope": {"vehicle_class": "economy", "branch": "https://rental.example/branches/prague-airport"}}
for claim in source["claims"]:
    usable, reasons, value = evaluate(claim, task, instant("2026-11-21T12:00:00Z"), builtin_profiles(),
                                      source_extensions=source["extensions"])
    print(claim["id"], usable, reasons, value)
```

A document of a version the reader does not know is refused. A review counts only when the caller says whom it trusts
(`--review --trust <issuer>`); a claim that needs an extension the reader does not understand is not used.

The reader passes the conformance suite of the format (`so4ag conformance spec/conformance/0.1` in a checkout of
https://github.com/soqvercom/so4ag). Licence: Apache-2.0.
