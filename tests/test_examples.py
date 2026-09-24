"""Verifica che SBOM e VEX di esempio siano CycloneDX 1.6 validi e coerenti tra loro."""
import json
from pathlib import Path

import pytest

EX = Path(__file__).resolve().parents[1] / "examples" / "immortalwrt-asus-rt-ac58u"


@pytest.mark.parametrize("name", ["sbom.cdx.json", "vex.cdx.json"])
def test_schema(name):
    validation = pytest.importorskip("cyclonedx.validation.json")
    from cyclonedx.schema import SchemaVersion
    err = validation.JsonStrictValidator(SchemaVersion.V1_6).validate_str((EX / name).read_text())
    assert err is None, err


def test_vex_points_to_sbom():
    sbom = json.loads((EX / "sbom.cdx.json").read_text())
    vex = json.loads((EX / "vex.cdx.json").read_text())
    serial = sbom["serialNumber"].replace("urn:uuid:", "")
    refs = {c["bom-ref"] for c in sbom["components"]}
    for v in vex["vulnerabilities"]:
        for a in v["affects"]:
            prefix, _, ref = a["ref"].partition("#")
            assert prefix == f"urn:cdx:{serial}/1"
            assert ref in refs


def test_every_closed_finding_is_justified():
    vex = json.loads((EX / "vex.cdx.json").read_text())
    for v in vex["vulnerabilities"]:
        a = v["analysis"]
        if a["state"] == "not_affected":
            assert a.get("justification") and a.get("detail"), v["id"]
        if a["state"] in ("false_positive", "exploitable"):
            assert a.get("detail"), v["id"]
