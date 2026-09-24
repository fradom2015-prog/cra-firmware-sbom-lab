#!/usr/bin/env python3
"""Confronta la SBOM di syft con quella di fw_sbom.py sullo stesso rootfs OpenWrt.

Misura quanto ciascuna SBOM è utilizzabile per il vulnerability management:
componenti duplicati, purl presenti, CPE con vendor:product e versione confrontabili con NVD.

Uso:
    python3 tools/compare_syft.py syft.cdx.json sbom.cdx.json -o confronto.md
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_json, parse_cpe23  # noqa: E402


def props(c: dict, name: str) -> list[str]:
    return [p["value"] for p in c.get("properties", []) if p["name"] == name]


def compare(syft: dict, ours: dict) -> dict:
    comps = [c for c in syft.get("components", []) if c.get("type") != "file"]
    found_by = Counter((props(c, "syft:package:foundBy") or ["?"])[0] for c in comps)
    pkg_db = [c for c in comps if "dpkg-db-cataloger" in props(c, "syft:package:foundBy")]
    names = Counter(c["name"] for c in pkg_db)

    ref = {}
    for c in ours.get("components", []):
        if "cpe" in c and c["name"] in names:
            p = parse_cpe23(c["cpe"])
            ref[c["name"]] = (p["vendor"], p["product"], p["version"])

    right_vp = right_all = release_suffix = 0
    examples = []
    seen = set()
    for c in pkg_db:
        if c["name"] in seen:
            continue
        seen.add(c["name"])
        cpes = [x for x in [c.get("cpe")] + props(c, "syft:cpe23") if x]
        parsed = [parse_cpe23(x) for x in cpes if parse_cpe23(x)]
        vps = {(p["vendor"], p["product"]) for p in parsed}
        vers = {p["version"] for p in parsed}
        if any(re.search(r"-\d+$", v) for v in vers):
            release_suffix += 1
        if c["name"] in ref:
            v, p, ver = ref[c["name"]]
            if (v, p) in vps:
                right_vp += 1
                if ver in vers:
                    right_all += 1
            if len(examples) < 8 and c["name"] in (
                    "openssl-util", "busybox", "dropbear", "dnsmasq-full", "libcurl4",
                    "samba36-server", "openssh-sftp-server", "zlib", "libopenssl1.1"):
                examples.append((c["name"], c.get("cpe", ""), f"cpe:2.3:a:{v}:{p}:{ver}"))

    binaries = [(c["name"], c.get("version", ""), c.get("cpe", "")) for c in comps
                if "binary-classifier-cataloger" in props(c, "syft:package:foundBy")]
    tools = syft.get("metadata", {}).get("tools", {})
    tool_list = tools.get("components", []) if isinstance(tools, dict) else tools
    version = next((t.get("version") for t in tool_list if t.get("name") == "syft"), "?")
    return {
        "syft_version": version,
        "syft_components": len(comps), "found_by": dict(found_by.most_common()),
        "pkg_db_entries": len(pkg_db), "pkg_db_unique": len(names),
        "pkg_db_duplicated": sum(1 for k in names.values() if k > 1),
        "pkg_db_with_purl": sum(1 for c in pkg_db if c.get("purl")),
        "cpe_with_release_suffix": release_suffix,
        "ours_with_cpe": len(ref), "syft_right_vendor_product": right_vp, "syft_right_version": right_all,
        "binary_classifier": binaries, "examples": examples,
    }


def to_md(r: dict) -> str:
    L = ["# syft e fw_sbom a confronto sullo stesso firmware", "",
         f"syft {r['syft_version']} trova **{r['syft_components']}** componenti (esclusi i file). Origine:", ""]
    L += [f"- `{k}`: {v}" for k, v in r["found_by"].items()]
    L += ["", "## Pacchetti OpenWrt (opkg)", "",
          f"syft {r['syft_version']} non riconosce opkg come gestore a sé e ne legge il database con il catalogatore di Debian (`dpkg-db-cataloger`), "
          "perché il formato del file è simile. Le conseguenze misurate:", "",
          f"- **{r['pkg_db_entries']}** voci per **{r['pkg_db_unique']}** pacchetti: "
          f"{r['pkg_db_duplicated']} pacchetti compaiono due volte (una da `status`, una dal file `.control`).",
          f"- Voci con purl: **{r['pkg_db_with_purl']}**. Senza purl e senza una distro Debian riconosciuta, "
          "gli strumenti non sanno a quale database di vulnerabilità collegarle.",
          f"- CPE con il numero di release OpenWrt nella versione (es. `1.1.1q-20`): **{r['cpe_with_release_suffix']}**. "
          "NVD non conosce quei numeri, quindi i confronti di versione falliscono.",
          f"- Dei **{r['ours_with_cpe']}** pacchetti per cui OpenWrt dichiara un CPE, syft indovina il vendor:product "
          f"giusto per **{r['syft_right_vendor_product']}** e anche la versione giusta per **{r['syft_right_version']}**.",
          "", "| Pacchetto | CPE di syft | CPE di fw_sbom |", "|---|---|---|"]
    L += [f"| {n} | `{a}` | `{b}` |" for n, a, b in r["examples"]]
    L += ["", "## Dove syft funziona bene", "",
          f"Il catalogatore binario riconosce {len(r['binary_classifier'])} programmi dalla firma nel file eseguibile, "
          "con CPE corretti:", ""]
    L += [f"- {n} {v}: `{c}`" for n, v, c in r["binary_classifier"]]
    L += ["", "## Conclusione", "",
          "Su un firmware OpenWrt una SBOM generata solo con syft sembra completa ma è quasi inutilizzabile per il "
          "confronto con NVD. fw_sbom usa i metadati che OpenWrt mette già nei pacchetti (`CPE-ID`, `Source`, "
          "`License`), toglie il numero di release e corregge i CPE sbagliati con alias verificati. "
          "La SBOM di syft resta utile come controllo incrociato, soprattutto per i binari riconosciuti "
          "dal catalogatore binario.", ""]
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("syft", type=Path)
    ap.add_argument("ours", type=Path)
    ap.add_argument("-o", "--output", type=Path, required=True)
    a = ap.parse_args(argv)
    r = compare(load_json(a.syft), load_json(a.ours))
    a.output.write_text(to_md(r), encoding="utf-8")
    a.output.with_suffix(".json").write_text(json.dumps(r, indent=2, ensure_ascii=False))
    print(f"syft: {r['syft_right_vendor_product']}/{r['ours_with_cpe']} vendor:product giusti, "
          f"{r['syft_right_version']} versioni giuste. Report in {a.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
