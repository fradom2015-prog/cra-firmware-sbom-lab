#!/usr/bin/env python3
"""Confronta i CPE di una SBOM CycloneDX con i feed NVD (formato JSON 2.0).

Pensato come verifica indipendente da grype: legge i feed annuali (anche .json.xz),
applica le regole di versione delle configurazioni NVD (versionStart/End Including/Excluding)
e produce un elenco di finding normalizzato, leggibile da triage.py.

Uso:
    python3 tools/nvd_match.py sbom.cdx.json nvd/CVE-*.json.xz -o matches.json [--include-kernel]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import dump_json, load_json, open_maybe_compressed, parse_cpe23, vercmp  # noqa: E402

try:
    import ijson  # streaming: evita di caricare in memoria feed da centinaia di MB
except ImportError:  # pragma: no cover
    ijson = None


def iter_cves(path: Path):
    with open_maybe_compressed(path, "rb") as f:
        if ijson:
            yield from ijson.items(f, "cve_items.item", use_float=True)
            return
        data = json.load(f)
    items = data.get("cve_items") or [v.get("cve", v) for v in data.get("vulnerabilities", [])]
    yield from items


def version_in_range(version: str, m: dict, crit: dict) -> bool:
    """True se `version` soddisfa un elemento cpeMatch di NVD."""
    cv = crit["version"]
    if cv not in ("*", "-", ""):
        # criterio a versione esatta; il campo "update" porta suffissi come il "p1" di OpenSSH 9.0p1
        upd = crit.get("update")
        target = cv if upd in ("*", "-", "", None) else cv + upd
        return vercmp(version, target) == 0
    checks = [
        ("versionStartIncluding", lambda c: c >= 0),
        ("versionStartExcluding", lambda c: c > 0),
        ("versionEndIncluding", lambda c: c <= 0),
        ("versionEndExcluding", lambda c: c < 0),
    ]
    bounded = False
    for key, ok in checks:
        if key in m:
            bounded = True
            if not ok(vercmp(version, m[key])):
                return False
    # un criterio "*" senza limiti significa "tutte le versioni": troppo generico,
    # lo scartiamo per non riempire il report di falsi positivi
    return bounded


def best_cvss(metrics: dict) -> dict:
    order = ["cvssMetricV31", "cvssMetricV30", "cvssMetricV40", "cvssMetricV2"]
    for key in order:
        entries = metrics.get(key) or []
        if not entries:
            continue
        entries = sorted(entries, key=lambda e: e.get("type") != "Primary")
        d = entries[0].get("cvssData", {})
        return {
            "version": d.get("version"), "vector": d.get("vectorString"),
            "score": d.get("baseScore"),
            "severity": (d.get("baseSeverity") or entries[0].get("baseSeverity") or "").upper(),
            "source": entries[0].get("source"),
        }
    return {}


def fixed_hint(m: dict) -> str | None:
    if "versionEndExcluding" in m:
        return m["versionEndExcluding"]
    return None


def load_targets(sbom: dict, include_kernel: bool):
    """Raggruppa i componenti per (vendor, product, versione upstream)."""
    targets: dict[tuple[str, str], dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for c in sbom.get("components", []):
        if "cpe" not in c:
            continue
        p = parse_cpe23(c["cpe"])
        if not p:
            continue
        if p["product"] == "linux_kernel" and not include_kernel:
            continue
        targets[(p["vendor"], p["product"])][p["version"]].append(c["bom-ref"])
    return targets


def match(sbom_path: Path, feeds: list[Path], include_kernel: bool = False) -> dict:
    sbom = load_json(sbom_path)
    targets = load_targets(sbom, include_kernel)
    seen_products: set[tuple[str, str]] = set()
    findings: dict[tuple[str, str], dict] = {}
    scanned = 0

    for feed in feeds:
        for cve in iter_cves(feed):
            scanned += 1
            if cve.get("vulnStatus") == "Rejected":
                continue
            for conf in cve.get("configurations") or []:
                for node in conf.get("nodes") or []:
                    for m in node.get("cpeMatch") or []:
                        crit = parse_cpe23(m.get("criteria", ""))
                        if not crit:
                            continue
                        key = (crit["vendor"], crit["product"])
                        if key not in targets:
                            continue
                        seen_products.add(key)
                        if not m.get("vulnerable", True):
                            continue
                        for version, refs in targets[key].items():
                            if not version_in_range(version, m, crit):
                                continue
                            fkey = (cve["id"], f"{key[0]}:{key[1]}@{version}")
                            if fkey in findings:
                                continue
                            desc = next((d["value"] for d in cve.get("descriptions", []) if d.get("lang") == "en"), "")
                            cwe = sorted({d["value"] for w in cve.get("weaknesses", []) for d in w.get("description", [])
                                          if d.get("value", "").startswith("CWE-")})
                            findings[fkey] = {
                                "cve": cve["id"],
                                "component": key[1], "vendor": key[0], "version": version,
                                "bom_refs": sorted(refs),
                                "cvss": best_cvss(cve.get("metrics", {})),
                                "fixed_in": fixed_hint(m),
                                "cwe": cwe,
                                "published": cve.get("published", "")[:10],
                                "description": desc[:400],
                                "conditional": conf.get("operator") == "AND",
                                "source": "nvd",
                            }

    unknown = sorted(f"{v}:{p}" for (v, p) in targets if (v, p) not in seen_products)
    return {
        "tool": "nvd_match",
        "sbom": str(sbom_path),
        "feeds": [p.name for p in feeds],
        "cves_scanned": scanned,
        "products_checked": len(targets),
        "products_unknown_to_nvd": unknown,
        "findings": sorted(findings.values(), key=lambda f: (-(f["cvss"].get("score") or 0), f["cve"])),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sbom", type=Path)
    ap.add_argument("feeds", type=Path, nargs="+", help="Feed NVD (CVE-YYYY.json[.xz])")
    ap.add_argument("-o", "--output", type=Path, required=True)
    ap.add_argument("--include-kernel", action="store_true",
                    help="Include il kernel Linux (migliaia di CVE: da valutare a parte)")
    a = ap.parse_args(argv)
    if ijson is None:
        print("Attenzione: ijson non installato, i feed verranno caricati interamente in memoria.", file=sys.stderr)
    res = match(a.sbom, a.feeds, a.include_kernel)
    dump_json(res, a.output)
    print(f"{len(res['findings'])} corrispondenze su {res['products_checked']} prodotti "
          f"({res['cves_scanned']} CVE analizzate). Prodotti mai visti in NVD: {len(res['products_unknown_to_nvd'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
