#!/usr/bin/env python3
"""Genera una SBOM CycloneDX 1.6 dal root filesystem di un firmware OpenWrt.

Legge il database dei pacchetti installati (opkg: usr/lib/opkg, apk: lib/apk/db/installed)
e usa i metadati che OpenWrt mette nei pacchetti (Source, License, CPE-ID) invece di
indovinarli dal nome del pacchetto.

Uso:
    python3 tools/fw_sbom.py ROOTFS -o sbom.cdx.json [--image firmware.bin] [--name NOME]
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import cpe22_to_vendor_product, cpe23, dump_json, upstream_version  # noqa: E402

TOOL_NAME = "fw_sbom"
TOOL_VERSION = "1.0.0"
ALIASES = json.loads((Path(__file__).resolve().parent / "cpe_aliases.json").read_text())


# ---------------------------------------------------------------- parsing ---

def parse_control_blocks(text: str) -> list[dict[str, str]]:
    """Parser per il formato 'Chiave: valore' di opkg/dpkg, con righe di continuazione."""
    blocks, cur, last = [], {}, None
    for line in text.splitlines():
        if not line.strip():
            if cur:
                blocks.append(cur)
            cur, last = {}, None
            continue
        if line[0] in " \t" and last:
            cur[last] += "\n" + line.strip()
            continue
        if ":" in line:
            k, v = line.split(":", 1)
            last = k.strip()
            cur[last] = v.strip()
    if cur:
        blocks.append(cur)
    return blocks


def read_opkg(root: Path) -> list[dict[str, str]]:
    status = root / "usr/lib/opkg/status"
    info = root / "usr/lib/opkg/info"
    pkgs = []
    for blk in parse_control_blocks(status.read_text(errors="replace")):
        # "install user installed" sì, "deinstall user not-installed" no
        if "installed" not in blk.get("Status", "").split():
            continue
        ctrl = info / f"{blk['Package']}.control"
        if ctrl.exists():
            extra = parse_control_blocks(ctrl.read_text(errors="replace"))
            if extra:
                blk = {**extra[0], **blk}  # lo status ha la precedenza (versione installata)
        pkgs.append(blk)
    return pkgs


def read_apk(root: Path) -> list[dict[str, str]]:
    """Database apk (OpenWrt 25.x): campi di una lettera. P=nome, V=versione, L=licenza, o=origine."""
    db = root / "lib/apk/db/installed"
    pkgs = []
    for blk in db.read_text(errors="replace").split("\n\n"):
        f: dict[str, str] = {}
        for line in blk.splitlines():
            if len(line) > 2 and line[1] == ":":
                k, v = line[0], line[2:]
                if k == "D":
                    f["Depends"] = ", ".join(v.split())
                else:
                    f.setdefault(k, v)
        if "P" in f:
            pkgs.append({
                "Package": f["P"], "Version": f.get("V", ""), "License": f.get("L", ""),
                "Source": f.get("o", ""), "Architecture": f.get("A", ""),
                "Description": f.get("T", ""), "Depends": f.get("Depends", ""),
            })
    return pkgs


def read_release(root: Path) -> dict[str, str]:
    out = {}
    for rel in ("etc/openwrt_release", "usr/lib/os-release", "etc/os-release"):
        p = root / rel
        if p.exists():
            for line in p.read_text(errors="replace").splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    out.setdefault(k.strip(), v.strip().strip("'\""))
    return out


def kernel_version(pkgs: list[dict[str, str]]) -> str | None:
    for p in pkgs:
        if p["Package"] == "kernel":
            return re.split(r"[-+~]", p["Version"])[0]
    for p in pkgs:
        if p["Package"].startswith("kmod-"):
            return re.split(r"[-+~]", p["Version"])[0]
    return None


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------- building ---

def component_for(pkg: dict[str, str], distro: str) -> dict:
    name, version = pkg["Package"], pkg.get("Version", "")
    arch = pkg.get("Architecture", "")
    comp: dict = {
        "type": "library",
        "bom-ref": f"pkg:{name}",
        "name": name,
        "version": version,
        "purl": f"pkg:generic/{name}@{version}?distro={distro}" + (f"&arch={arch}" if arch else ""),
    }
    desc = pkg.get("Description", "").split("\n")[0].strip()
    if desc:
        comp["description"] = desc
    lic = pkg.get("License", "").strip()
    if lic:
        comp["licenses"] = [{"license": {"name": lic}}]
    props = []
    if pkg.get("Source"):
        props.append({"name": "openwrt:source", "value": pkg["Source"]})
    if pkg.get("SourceName"):
        props.append({"name": "openwrt:sourceName", "value": pkg["SourceName"]})
    up = upstream_version(version)
    props.append({"name": "openwrt:upstreamVersion", "value": up})

    cpe_id = pkg.get("CPE-ID", "").strip()
    parsed = cpe22_to_vendor_product(cpe_id) if cpe_id else None
    if parsed:
        part, vendor, product = parsed
        props.append({"name": "openwrt:cpeId", "value": cpe_id})
        key = f"{vendor}:{product}"
        if key in ALIASES:
            vendor, product = ALIASES[key].split(":", 1)
            props.append({"name": "fwsec:cpeAlias", "value": f"{key} -> {vendor}:{product}"})
        comp["cpe"] = cpe23(part, vendor, product, up)
    comp["properties"] = props
    return comp


def depends_list(dep: str) -> list[str]:
    names = []
    for alt in dep.split(","):
        first = alt.split("|")[0].strip()
        first = re.sub(r"\s*\(.*\)", "", first).strip()
        if first:
            names.append(first)
    return names


def build_sbom(root: Path, image: Path | None, name: str | None) -> tuple[dict, dict]:
    if (root / "usr/lib/opkg/status").exists():
        pkgs, manager = read_opkg(root), "opkg"
    elif (root / "lib/apk/db/installed").exists():
        pkgs, manager = read_apk(root), "apk"
    else:
        raise SystemExit(f"Nessun database opkg o apk trovato in {root}. È davvero il rootfs estratto?")

    rel = read_release(root)
    distro_id = (rel.get("DISTRIB_ID") or rel.get("ID") or "openwrt").lower()
    distro_ver = rel.get("DISTRIB_RELEASE") or rel.get("VERSION_ID") or "unknown"
    distro = f"{distro_id}-{distro_ver}"

    comps = [component_for(p, distro) for p in sorted(pkgs, key=lambda p: p["Package"])]
    refs = {c["name"]: c["bom-ref"] for c in comps}

    kver = kernel_version(pkgs)
    if kver:
        comps.insert(0, {
            "type": "operating-system", "bom-ref": "kernel", "name": "linux-kernel",
            "version": kver, "cpe": cpe23("o", "linux", "linux_kernel", kver),
            "properties": [{"name": "fwsec:note", "value": "Versione dedotta dai pacchetti kmod/kernel"}],
        })

    fw_ref = "firmware"
    fw = {
        "type": "firmware", "bom-ref": fw_ref,
        "name": name or rel.get("DISTRIB_DESCRIPTION") or distro,
        "version": rel.get("DISTRIB_REVISION") or distro_ver,
        "properties": [
            {"name": "openwrt:distribution", "value": distro},
            {"name": "openwrt:target", "value": rel.get("DISTRIB_TARGET", "")},
            {"name": "openwrt:arch", "value": rel.get("DISTRIB_ARCH", "")},
            {"name": "fwsec:packageManager", "value": manager},
        ],
    }
    if image:
        fw["hashes"] = [{"alg": "SHA-256", "content": sha256(image)}]
        fw["properties"].append({"name": "fwsec:imageFile", "value": image.name})

    deps = [{"ref": fw_ref, "dependsOn": [c["bom-ref"] for c in comps]}]
    for p in pkgs:
        on = [refs[d] for d in depends_list(p.get("Depends", "")) if d in refs]
        if on:
            deps.append({"ref": refs[p["Package"]], "dependsOn": sorted(set(on))})

    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "lifecycles": [{"phase": "post-build"}],
            "tools": {"components": [{"type": "application", "name": TOOL_NAME, "version": TOOL_VERSION}]},
            "component": fw,
        },
        "components": comps,
        "dependencies": deps,
    }
    with_cpe = sum(1 for c in comps if "cpe" in c)
    stats = {
        "distribution": distro, "package_manager": manager, "packages": len(pkgs),
        "components_with_cpe": with_cpe, "kernel": kver,
        "cpe_coverage_pct": round(100 * with_cpe / max(len(comps), 1), 1),
        "aliased": sum(1 for c in comps for p in c.get("properties", []) if p["name"] == "fwsec:cpeAlias"),
    }
    return sbom, stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rootfs", type=Path, help="Directory del root filesystem estratto")
    ap.add_argument("-o", "--output", type=Path, required=True)
    ap.add_argument("--image", type=Path, help="Immagine firmware originale (per l'hash SHA-256)")
    ap.add_argument("--name", help="Nome del firmware nella SBOM")
    ap.add_argument("--stats", type=Path, help="Scrive anche le statistiche in JSON")
    a = ap.parse_args(argv)

    sbom, stats = build_sbom(a.rootfs, a.image, a.name)
    dump_json(sbom, a.output)
    if a.stats:
        dump_json(stats, a.stats)
    print(f"SBOM scritta in {a.output}: {stats['packages']} pacchetti ({stats['package_manager']}), "
          f"{stats['components_with_cpe']} componenti con CPE ({stats['cpe_coverage_pct']}%), "
          f"kernel {stats['kernel']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
