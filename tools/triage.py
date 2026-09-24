#!/usr/bin/env python3
"""Triage delle vulnerabilità di un firmware: priorità, VEX e report.

Prende i finding di nvd_match.py e/o di grype, li arricchisce con il catalogo CISA KEV
e con EPSS, applica la matrice di priorità e le decisioni di analisi (vex/decisions.toml),
poi produce:
  - triage.json   finding arricchiti
  - report.md     report leggibile per sviluppatori e management
  - vex.cdx.json  documento CycloneDX VEX con lo stato di analisi di ogni CVE

Uso:
    python3 tools/triage.py --sbom sbom.cdx.json --nvd matches.json [--grype grype.json] \
        [--decisions vex/decisions.toml] [--kev kev.json] [--epss-csv epss.csv.gz] \
        [--stats sbom-stats.json] --out-dir report/ [--fail-on P1]
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import functools
import io
import json
import sys
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import chunked, dump_json, load_json, open_maybe_compressed, vercmp  # noqa: E402

KEV_URLS = [
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    "https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json",
]
EPSS_API = "https://api.first.org/data/v1/epss?cve="

CLOSED_STATES = {"not_affected", "false_positive", "resolved", "resolved_with_pedigree"}
VALID_STATES = CLOSED_STATES | {"exploitable", "in_triage"}
VALID_JUSTIFICATIONS = {
    "code_not_present", "code_not_reachable", "requires_configuration", "requires_dependency",
    "requires_environment", "protected_by_compiler", "protected_at_runtime",
    "protected_at_perimeter", "protected_by_mitigating_control",
}
PRIORITY_LABEL = {
    "P1": "Massima: correggere subito",
    "P2": "Alta: pianificare il fix a breve",
    "P3": "Media: entro il ciclo di rilascio",
    "P4": "Bassa: monitorare",
}


# ------------------------------------------------------------------ input ---

def from_grype(doc: dict) -> list[dict]:
    out = []
    for m in doc.get("matches", []):
        v, art = m.get("vulnerability", {}), m.get("artifact", {})
        cve = v.get("id", "")
        if not cve.startswith("CVE-"):
            rel = [r.get("id") for r in m.get("relatedVulnerabilities", []) if r.get("id", "").startswith("CVE-")]
            cve = rel[0] if rel else cve
        cvss = {}
        for src in [v] + m.get("relatedVulnerabilities", []):
            for c in sorted(src.get("cvss", []), key=lambda c: str(c.get("version")), reverse=True):
                score = (c.get("metrics") or {}).get("baseScore")
                if score is not None:
                    cvss = {"version": c.get("version"), "vector": c.get("vector"), "score": score,
                            "severity": (v.get("severity") or "").upper(), "source": src.get("dataSource")}
                    break
            if cvss:
                break
        fix = v.get("fix") or {}
        f = {
            "cve": cve, "component": art.get("name", ""), "vendor": "", "version": art.get("version", ""),
            "bom_refs": [f"pkg:{art.get('name', '')}"], "cvss": cvss,
            "fixed_in": (fix.get("versions") or [None])[0], "cwe": [], "published": "",
            "description": (v.get("description") or "")[:400], "conditional": False, "source": "grype",
        }
        # grype recenti includono già EPSS e KEV
        if v.get("epss"):
            e = v["epss"][0]
            f["epss"] = {"score": float(e.get("epss", 0)), "percentile": float(e.get("percentile", 0)),
                         "date": e.get("date", "")}
        if v.get("knownExploited"):
            k = v["knownExploited"][0]
            f["kev_hint"] = {"ransomware": k.get("knownRansomwareCampaignUse", "Unknown")}
        out.append(f)
    return out


def merge(findings: list[dict]) -> list[dict]:
    """Unisce i finding delle due fonti sulla chiave (CVE, componente, versione)."""
    merged: dict[tuple, dict] = {}
    for f in findings:
        key = (f["cve"], f["component"], f["version"])
        if key not in merged:
            merged[key] = {**f, "sources": [f["source"]]}
        else:
            cur = merged[key]
            if f["source"] not in cur["sources"]:
                cur["sources"].append(f["source"])
            for k in ("cvss", "fixed_in", "epss", "description"):
                if not cur.get(k) and f.get(k):
                    cur[k] = f[k]
            cur["bom_refs"] = sorted(set(cur["bom_refs"]) | set(f["bom_refs"]))
    return list(merged.values())


# ------------------------------------------------------------- enrichment ---

def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "cra-firmware-sbom-lab/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_kev(path: Path | None, cache: Path, offline: bool = False) -> tuple[dict, str]:
    if path and path.exists():
        doc = load_json(path)
    elif cache.exists():
        doc = load_json(cache)
    elif offline:
        doc = None
    else:
        doc = None
        for url in KEV_URLS:
            try:
                doc = json.loads(fetch(url))
                dump_json(doc, cache)
                break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                continue
    if not doc:
        return {}, "non disponibile"
    kev = {v["cveID"]: v for v in doc.get("vulnerabilities", [])}
    return kev, f"{doc.get('catalogVersion', '?')} ({len(kev)} voci)"


def load_epss(cves: list[str], csv_path: Path | None, cache: Path, offline: bool = False) -> tuple[dict, str]:
    scores: dict[str, dict] = {}
    if csv_path and csv_path.exists():
        with open_maybe_compressed(csv_path, "rt") as f:
            first = f.readline()
            date = first.split("score_date:")[-1].strip() if first.startswith("#") else ""
            if not first.startswith("#"):
                f = io.StringIO(first + f.read())
            for row in csv.DictReader(f):
                scores[row["cve"]] = {"score": float(row["epss"]), "percentile": float(row["percentile"]), "date": date}
        return {c: scores[c] for c in cves if c in scores}, f"CSV {csv_path.name}"
    if cache.exists():
        scores = load_json(cache)
    missing = [c for c in cves if c not in scores]
    if offline:
        return {c: scores[c] for c in cves if c in scores}, "non richiesto (--offline)"
    try:
        for batch in chunked(missing, 80):
            data = json.loads(fetch(EPSS_API + ",".join(batch)))
            for d in data.get("data", []):
                scores[d["cve"]] = {"score": float(d["epss"]), "percentile": float(d["percentile"]),
                                    "date": d.get("date", "")}
        if missing:
            dump_json(scores, cache)
        src = "API FIRST"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
        src = "non disponibile (API FIRST non raggiungibile)" if not scores else "cache parziale"
    return {c: scores[c] for c in cves if c in scores}, src


def load_decisions(path: Path | None) -> list[dict]:
    if not path or not path.exists():
        return []
    if path.suffix == ".json":
        doc = load_json(path)
    else:
        try:
            import tomllib  # Python 3.11+
        except ImportError:  # pragma: no cover
            import tomli as tomllib  # type: ignore
        doc = tomllib.loads(path.read_text())
    decs = doc.get("decision", doc.get("decisions", []))
    for d in decs:
        if d.get("state") not in VALID_STATES:
            raise SystemExit(f"Decisione per {d.get('cve')}: stato '{d.get('state')}' non valido. Validi: {sorted(VALID_STATES)}")
        if d.get("justification") and d["justification"] not in VALID_JUSTIFICATIONS:
            raise SystemExit(f"Decisione per {d.get('cve')}: justification '{d['justification']}' non valida.")
        if d["state"] == "not_affected" and not d.get("justification"):
            raise SystemExit(f"Decisione per {d.get('cve')}: 'not_affected' richiede una justification.")
    return decs


def decision_for(f: dict, decisions: list[dict]) -> dict | None:
    for d in decisions:
        if d.get("cve") != f["cve"]:
            continue
        if d.get("component") in (None, "", "*", f["component"]):
            return d
    return None


# --------------------------------------------------------------- priority ---

def prioritize(f: dict) -> tuple[str, str]:
    score = f.get("cvss", {}).get("score") or 0.0
    epss = (f.get("epss") or {}).get("score")
    if f.get("kev"):
        return "P1", "Nel catalogo CISA KEV: sfruttata attivamente nel mondo reale"
    if score >= 7.0 and epss is not None and epss >= 0.5:
        return "P1", f"CVSS {score} ed EPSS {epss:.2f}: grave e probabile"
    if score >= 7.0:
        why = f"CVSS {score}" + (f", EPSS {epss:.3f}" if epss is not None else ", EPSS non disponibile")
        return "P2", why
    if score >= 4.0:
        if epss is not None and epss >= 0.5:
            return "P2", f"CVSS medio ({score}) ma EPSS {epss:.2f}"
        return "P3", f"CVSS {score}"
    if epss is not None and epss >= 0.5:
        return "P3", f"CVSS basso ({score}) ma EPSS {epss:.2f}"
    return "P4", f"CVSS {score or 'n.d.'}"


# ---------------------------------------------------------------- outputs ---

def cvss_method(version: str | None) -> str:
    return {"3.1": "CVSSv31", "3.0": "CVSSv3", "4.0": "CVSSv4", "2.0": "CVSSv2"}.get(str(version), "other")


def build_vex(findings: list[dict], sbom: dict) -> dict:
    serial = sbom.get("serialNumber", "").replace("urn:uuid:", "")
    bom_version = sbom.get("version", 1)
    vulns = []
    for f in findings:
        c = f.get("cvss") or {}
        v = {
            "bom-ref": f"vex:{f['cve']}:{f['component']}",
            "id": f["cve"],
            "source": {"name": "NVD", "url": f"https://nvd.nist.gov/vuln/detail/{f['cve']}"},
            "affects": [{"ref": f"urn:cdx:{serial}/{bom_version}#{r}"} for r in f["bom_refs"]],
            "analysis": {"state": f["state"]},
            "properties": [
                {"name": "fwsec:priority", "value": f["priority"]},
                {"name": "fwsec:kev", "value": str(bool(f.get("kev"))).lower()},
            ],
        }
        if c.get("score") is not None:
            v["ratings"] = [{"source": {"name": c.get("source") or "NVD"}, "score": c["score"],
                             "severity": (c.get("severity") or "unknown").lower(),
                             "method": cvss_method(c.get("version")), "vector": c.get("vector")}]
        if f.get("cwe"):
            v["cwes"] = [int(x.split("-")[1]) for x in f["cwe"] if x.split("-")[1].isdigit()]
        if f.get("epss"):
            v["properties"].append({"name": "fwsec:epss", "value": f"{f['epss']['score']:.5f}"})
        d = f.get("decision")
        if d:
            if d.get("justification"):
                v["analysis"]["justification"] = d["justification"]
            if d.get("response"):
                v["analysis"]["response"] = d["response"]
            if d.get("detail"):
                v["analysis"]["detail"] = d["detail"]
        vulns.append(v)
    return {
        "bomFormat": "CycloneDX", "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}", "version": 1,
        "metadata": {
            "timestamp": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "component": sbom.get("metadata", {}).get("component", {}),
            "tools": {"components": [{"type": "application", "name": "triage", "version": "1.0.0"}]},
        },
        "vulnerabilities": vulns,
    }


def md_table(headers: list[str], rows: list[list]) -> str:
    if not rows:
        return "_Nessuno._\n"
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(x) for x in r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def cve_link(cve: str) -> str:
    return f"[{cve}](https://nvd.nist.gov/vuln/detail/{cve})"


def build_report(findings, sbom, meta, stats, unknown) -> str:
    fw = sbom.get("metadata", {}).get("component", {})
    open_f = [f for f in findings if f["state"] not in CLOSED_STATES]
    lines = [f"# Triage vulnerabilità: {fw.get('name', 'firmware')}", ""]
    lines += [
        f"- **Generato**: {meta['generated']}",
        f"- **SBOM**: `{sbom.get('serialNumber', '')}`",
        f"- **Fonti**: {', '.join(meta['sources'])}",
        f"- **Catalogo KEV**: {meta['kev']}",
        f"- **EPSS**: {meta['epss']}",
        "",
        "## Sintesi",
        "",
    ]
    by_p = defaultdict(lambda: [0, 0])
    for f in findings:
        by_p[f["priority"]][0 if f["state"] not in CLOSED_STATES else 1] += 1
    rows = [[p, PRIORITY_LABEL[p], by_p[p][0], by_p[p][1]] for p in ("P1", "P2", "P3", "P4")]
    lines.append(md_table(["Priorità", "Significato", "Aperte", "Chiuse con VEX"], rows))
    comps = {(f["component"], f["version"]) for f in findings}
    kev_n = sum(1 for f in open_f if f.get("kev"))
    lines += [f"**{len(findings)}** corrispondenze CVE su **{len(comps)}** componenti. "
              f"**{kev_n}** aperte sono nel catalogo CISA KEV.", ""]

    lines += ["## Vulnerabilità nel catalogo CISA KEV", "",
              "Sono sfruttate attivamente nel mondo reale. Per il Cyber Resilience Act (art. 14) la notifica "
              "entro 24 ore scatta quando il produttore viene a conoscenza di una vulnerabilità attivamente "
              "sfruttata **contenuta nel proprio prodotto**: questi casi vanno portati subito in valutazione.", ""]
    rows = [[cve_link(f["cve"]), f["component"], f["version"], f["cvss"].get("score", ""),
             f["kev"]["dateAdded"], f["kev"].get("knownRansomwareCampaignUse", ""), f.get("fixed_in") or "",
             f["state"]] for f in findings if f.get("kev")]
    lines.append(md_table(["CVE", "Componente", "Versione", "CVSS", "In KEV dal", "Ransomware", "Corretta in", "Stato"], rows))

    lines += ["## Priorità P1 e P2 aperte", ""]
    top = [f for f in open_f if f["priority"] in ("P1", "P2")]
    rows = [[cve_link(f["cve"]), f["priority"], f["component"], f["version"], f["cvss"].get("score", ""),
             f"{f['epss']['score']:.3f}" if f.get("epss") else "n.d.", f.get("fixed_in") or "", f["why"]]
            for f in top[:40]]
    lines.append(md_table(["CVE", "P", "Componente", "Versione", "CVSS", "EPSS", "Corretta in", "Motivo"], rows))
    if len(top) > 40:
        lines += [f"_Altre {len(top) - 40} in `triage.json`._", ""]

    lines += ["## Per componente", "", "Il piano di remediation si ragiona per componente: un solo aggiornamento chiude molte CVE.", ""]
    agg = defaultdict(lambda: {"n": 0, "max": 0.0, "kev": 0, "fix": set(), "p1": 0})
    for f in open_f:
        a = agg[(f["component"], f["version"])]
        a["n"] += 1
        a["max"] = max(a["max"], f["cvss"].get("score") or 0)
        a["kev"] += 1 if f.get("kev") else 0
        a["p1"] += 1 if f["priority"] == "P1" else 0
        if f.get("fixed_in"):
            a["fix"].add(f["fixed_in"])
    def max_fix(s):
        return sorted(s, key=functools.cmp_to_key(vercmp))[-1] if s else ""
    rows = sorted(([c, v, a["n"], a["p1"], a["kev"], a["max"], max_fix(a["fix"])] for (c, v), a in agg.items()),
                  key=lambda r: (-r[3], -r[5], -r[2]))
    lines.append(md_table(["Componente", "Versione", "CVE aperte", "P1", "KEV", "CVSS max", "Versione minima che le chiude"], rows))

    if stats or unknown:
        lines += ["## Qualità della SBOM", ""]
        if stats:
            lines += [f"- Pacchetti installati: **{stats['packages']}** ({stats['package_manager']})",
                      f"- Componenti con CPE: **{stats['components_with_cpe']}** ({stats['cpe_coverage_pct']}%). "
                      "Gli altri non possono essere confrontati con NVD: servono CPE o purl migliori.",
                      f"- CPE corretti con alias verificati: {stats.get('aliased', 0)}",
                      f"- Kernel: {stats.get('kernel')} (escluso dal confronto automatico, da valutare a parte)"]
        if unknown:
            lines += [f"- Prodotti dichiarati ma mai presenti nei feed NVD analizzati ({len(unknown)}): "
                      + ", ".join(f"`{u}`" for u in unknown)]
        lines.append("")

    lines += ["## Metodo", "",
              "- **P1**: nel catalogo CISA KEV, oppure CVSS ≥ 7 con EPSS ≥ 0,5.",
              "- **P2**: CVSS ≥ 7, oppure CVSS 4–6,9 con EPSS ≥ 0,5.",
              "- **P3**: CVSS 4–6,9, oppure CVSS basso con EPSS ≥ 0,5.",
              "- **P4**: il resto.",
              "- Le decisioni di analisi (VEX) in `vex/decisions.toml` chiudono i finding non sfruttabili "
              "nel contesto del prodotto; ogni chiusura richiede una motivazione.",
              "- Le corrispondenze basate su CPE possono contenere falsi positivi (per esempio CVE che riguardano "
              "solo alcune piattaforme): vanno verificate prima di comunicarle all'esterno.", ""]
    return "\n".join(lines)


def run(a) -> int:
    sbom = load_json(a.sbom)
    raw, sources, unknown = [], [], []
    if a.nvd:
        doc = load_json(a.nvd)
        raw += doc["findings"]
        unknown = doc.get("products_unknown_to_nvd", [])
        sources.append(f"NVD ({', '.join(doc.get('feeds', []))})" if len(doc.get("feeds", [])) < 4
                       else f"NVD ({len(doc['feeds'])} feed)")
    if a.grype:
        raw += from_grype(load_json(a.grype))
        sources.append("grype")
    findings = merge(raw)

    a.out_dir.mkdir(parents=True, exist_ok=True)
    kev, kev_meta = load_kev(a.kev, a.cache_dir / "kev.json", a.offline)
    cves = sorted({f["cve"] for f in findings})
    epss, epss_meta = load_epss(cves, a.epss_csv, a.cache_dir / "epss.json", a.offline)
    decisions = load_decisions(a.decisions)

    for f in findings:
        if f["cve"] in kev:
            f["kev"] = {k: kev[f["cve"]].get(k) for k in ("dateAdded", "dueDate", "knownRansomwareCampaignUse", "vulnerabilityName")}
        if f["cve"] in epss and not f.get("epss"):
            f["epss"] = epss[f["cve"]]
        f["priority"], f["why"] = prioritize(f)
        d = decision_for(f, decisions)
        f["decision"] = d
        f["state"] = d["state"] if d else "in_triage"

    order = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}
    findings.sort(key=lambda f: (order[f["priority"]], -(f.get("cvss", {}).get("score") or 0), f["cve"]))
    meta = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "sources": sources,
            "kev": kev_meta, "epss": epss_meta}
    stats = load_json(a.stats) if a.stats and a.stats.exists() else None

    dump_json({"meta": meta, "findings": findings}, a.out_dir / "triage.json")
    dump_json(build_vex(findings, sbom), a.out_dir / "vex.cdx.json")
    (a.out_dir / "report.md").write_text(build_report(findings, sbom, meta, stats, unknown), encoding="utf-8")

    open_by_p = defaultdict(int)
    for f in findings:
        if f["state"] not in CLOSED_STATES:
            open_by_p[f["priority"]] += 1
    print(f"{len(findings)} finding | aperti: " + ", ".join(f"{p}={open_by_p[p]}" for p in ("P1", "P2", "P3", "P4"))
          + f" | KEV: {sum(1 for f in findings if f.get('kev'))} | EPSS: {epss_meta}")

    if a.fail_on != "none":
        levels = ["P1"] if a.fail_on == "P1" else ["P1", "P2"]
        blocking = sum(open_by_p[p] for p in levels)
        if blocking:
            print(f"GATE FALLITO: {blocking} finding aperti di priorità {'/'.join(levels)}.", file=sys.stderr)
            return 1
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sbom", type=Path, required=True)
    ap.add_argument("--nvd", type=Path, help="Output di nvd_match.py")
    ap.add_argument("--grype", type=Path, help="Output di 'grype -o json'")
    ap.add_argument("--decisions", type=Path, help="Decisioni di analisi VEX (.toml o .json)")
    ap.add_argument("--kev", type=Path, help="Catalogo KEV locale (altrimenti scaricato)")
    ap.add_argument("--epss-csv", type=Path, help="CSV EPSS giornaliero (altrimenti API FIRST)")
    ap.add_argument("--stats", type=Path, help="Statistiche prodotte da fw_sbom.py --stats")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--cache-dir", type=Path, default=Path(".cache"))
    ap.add_argument("--offline", action="store_true", help="Non scaricare KEV ed EPSS (usa solo file locali e cache)")
    ap.add_argument("--fail-on", choices=["P1", "P2", "none"], default="none",
                    help="Esce con codice 1 se restano finding aperti di questa priorità (per la CI)")
    a = ap.parse_args(argv)
    if not a.nvd and not a.grype:
        ap.error("serve almeno --nvd o --grype")
    a.cache_dir.mkdir(parents=True, exist_ok=True)
    return run(a)


if __name__ == "__main__":
    raise SystemExit(main())
