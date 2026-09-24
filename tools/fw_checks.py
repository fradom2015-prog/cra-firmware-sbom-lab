#!/usr/bin/env python3
"""Controlli di configurazione e di hardening su un rootfs OpenWrt estratto.

Ogni controllo è collegato al requisito del Cyber Resilience Act (Allegato I) e della
ETSI EN 303 645 che verifica. Non sostituisce un pentest: individua in pochi secondi
i problemi più comuni dei firmware (password di default, chiavi incorporate, servizi
non necessari, binari compilati senza protezioni).

Uso:
    python3 tools/fw_checks.py ROOTFS -o checks.json --md checks.md
"""
from __future__ import annotations

import argparse
import os
import re
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import dump_json  # noqa: E402

try:
    from elftools.elf.elffile import ELFFile
    from elftools.common.exceptions import ELFError
except ImportError:  # pragma: no cover
    ELFFile = None

PASS, FAIL, WARN, INFO = "PASS", "FAIL", "WARN", "INFO"
PRIVATE_KEY = re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")
INSECURE_DAEMONS = {"telnetd": "Telnet", "utelnetd": "Telnet", "ftpd": "FTP", "vsftpd": "FTP",
                    "tftpd": "TFTP", "in.tftpd": "TFTP", "rlogind": "rlogin"}


def result(cid, title, status, detail, cra, etsi, evidence=None):
    return {"id": cid, "title": title, "status": status, "detail": detail,
            "cra": cra, "etsi_en_303_645": etsi, "evidence": evidence or []}


def rel(root: Path, p: Path) -> str:
    return "/" + str(p.relative_to(root))


def walk_files(root: Path, skip=("proc", "sys", "dev", "tmp")):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not (Path(dirpath) == root and d in skip)]
        for fn in filenames:
            yield Path(dirpath) / fn


# ------------------------------------------------------------------ checks ---

def check_root_password(root: Path):
    shadow = root / "etc/shadow"
    if not shadow.exists():
        return result("C01", "Password dell'account root", INFO, "/etc/shadow non presente.", "I.2(d)", "5.1")
    for line in shadow.read_text(errors="replace").splitlines():
        parts = line.split(":")
        if parts[0] == "root":
            h = parts[1] if len(parts) > 1 else ""
            if h == "":
                return result("C01", "Password dell'account root", FAIL,
                              "L'account root non ha password al primo avvio. Chi raggiunge il dispositivo prima "
                              "del proprietario può autenticarsi. Serve una password unica per dispositivo o "
                              "l'obbligo di impostarla prima di attivare i servizi di rete.",
                              "I.2(b), I.2(d)", "5.1", ["/etc/shadow: root::"])
            if h in ("*", "!", "!!", "x"):
                return result("C01", "Password dell'account root", PASS, "Login root con password disabilitato.", "I.2(d)", "5.1")
            return result("C01", "Password dell'account root", WARN,
                          "Nell'immagine c'è un hash di password per root, uguale su tutti i dispositivi: "
                          "è una credenziale universale di default.", "I.2(b), I.2(d)", "5.1", ["/etc/shadow"])
    return result("C01", "Password dell'account root", INFO, "Nessun account root in /etc/shadow.", "I.2(d)", "5.1")


def owner_package(root: Path, path: str) -> str:
    info = root / "usr/lib/opkg/info"
    if info.exists():
        for lst in info.glob("*.list"):
            try:
                if path in lst.read_text(errors="replace").splitlines():
                    return f"  (pacchetto {lst.stem})"
            except OSError:
                continue
    return ""


def check_private_keys(root: Path):
    hits = []
    for p in walk_files(root):
        try:
            if p.is_symlink() or not p.is_file() or p.stat().st_size > 2_000_000:
                continue
            with open(p, "rb") as f:
                data = f.read()
            # nei binari ELF la stringa compare nel codice dei parser PEM: non è una chiave
            if data[:4] != b"\x7fELF" and PRIVATE_KEY.search(data):
                hits.append(rel(root, p) + owner_package(root, rel(root, p)))
        except OSError:
            continue
    if hits:
        return result("C02", "Chiavi private incorporate nell'immagine", FAIL,
                      "Nell'immagine ci sono chiavi private: sono identiche su ogni dispositivo e chiunque può "
                      "estrarle dal firmware pubblico.", "I.2(e), I.2(f)", "5.4", hits)
    return result("C02", "Chiavi private incorporate nell'immagine", PASS,
                  "Nessun blocco 'PRIVATE KEY' trovato nei file dell'immagine.", "I.2(e)", "5.4")


def check_ssh_host_keys(root: Path):
    found = []
    for d in ("etc/dropbear", "etc/ssh"):
        for p in (root / d).glob("*host*key*") if (root / d).exists() else []:
            if p.is_file() and p.stat().st_size > 0 and not p.name.endswith(".pub"):
                found.append(rel(root, p))
    if found:
        return result("C03", "Chiavi host SSH pregenerate", FAIL,
                      "Le chiavi host SSH sono nell'immagine: tutti i dispositivi condividono la stessa identità "
                      "e un attaccante può impersonarli (MITM).", "I.2(e)", "5.4", found)
    return result("C03", "Chiavi host SSH pregenerate", PASS,
                  "Le chiavi host SSH sono assenti o vuote: vengono generate al primo avvio, uniche per dispositivo.",
                  "I.2(e)", "5.4")


def check_insecure_daemons(root: Path):
    found = []
    for d in ("bin", "sbin", "usr/bin", "usr/sbin"):
        for name, proto in INSECURE_DAEMONS.items():
            p = root / d / name
            if p.exists() or p.is_symlink():
                found.append(f"/{d}/{name} ({proto})")
    if found:
        return result("C04", "Servizi con protocolli in chiaro", WARN,
                      "Sono presenti server per protocolli senza cifratura. Verificare che non siano avviati di default.",
                      "I.2(j)", "5.5", found)
    return result("C04", "Servizi con protocolli in chiaro", PASS, "Nessun server Telnet, FTP o TFTP trovato.", "I.2(j)", "5.6")


def check_enabled_services(root: Path):
    rcd = root / "etc/rc.d"
    if not rcd.exists():
        return result("C05", "Servizi avviati di default", INFO, "/etc/rc.d assente.", "I.2(j)", "5.6")
    services = sorted({re.sub(r"^[SK]\d+", "", p.name) for p in rcd.iterdir() if p.name.startswith("S")})
    network_facing = [s for s in services if s in {
        "samba", "samba4", "uhttpd", "nginx", "lighttpd", "dropbear", "sshd", "telnet", "vsftpd", "miniupnpd",
        "snmpd", "openvpn", "haproxy", "transmission", "aria2", "netdata", "rpcbind", "nfsd", "avahi-daemon"}]
    return result("C05", "Servizi avviati di default", WARN if len(network_facing) > 3 else INFO,
                  f"{len(services)} servizi abilitati al boot, di cui {len(network_facing)} esposti in rete: "
                  + ", ".join(network_facing) + ". Ogni servizio attivo di default va giustificato nel risk assessment.",
                  "I.2(j)", "5.6", services)


def check_package_signatures(root: Path):
    conf = root / "etc/opkg.conf"
    keys = list((root / "etc/opkg/keys").glob("*")) if (root / "etc/opkg/keys").exists() else []
    apk_keys = list((root / "etc/apk/keys").glob("*")) if (root / "etc/apk/keys").exists() else []
    if (root / "lib/apk/db/installed").exists() and apk_keys:  # OpenWrt 25.x usa apk
        return result("C06", "Verifica della firma degli aggiornamenti", PASS,
                      f"apk con {len(apk_keys)} chiavi di firma: i pacchetti sono verificati.", "II(7)", "5.3", [])
    if conf.exists() and "check_signature" in conf.read_text():
        return result("C06", "Verifica della firma degli aggiornamenti", PASS,
                      f"opkg verifica la firma dei pacchetti (check_signature) con {len(keys)} chiavi usign.",
                      "II(7)", "5.3", [f"/etc/opkg/keys: {len(keys)} chiavi"])
    return result("C06", "Verifica della firma degli aggiornamenti", FAIL,
                  f"In /etc/opkg.conf manca 'option check_signature': opkg non verifica la firma degli indici dei "
                  f"pacchetti, da cui dipende anche il controllo dell'hash di ogni pacchetto, anche se nell'immagine ci "
                  f"sono {len(keys)} chiavi usign. Chi controlla il repository o la rete può far installare pacchetti modificati.",
                  "II(7)", "5.3", ["/etc/opkg.conf: check_signature assente", f"/etc/opkg/keys: {len(keys)} chiavi"])


def check_wan_firewall(root: Path):
    fw = root / "etc/config/firewall"
    if not fw.exists():
        return result("C07", "Firewall sulla WAN", INFO, "/etc/config/firewall assente.", "I.2(j)", "5.6")
    text = fw.read_text(errors="replace")
    pol = None
    for z in re.split(r"\nconfig ", text):
        if z.startswith("zone") and re.search(r"option name\s+'?wan'?", z):
            m = re.search(r"option input\s+'?(\w+)'?", z)
            pol = m.group(1) if m else "?"
    # porte aperte dalla WAN: regole nel file e regole aggiunte al primo avvio dagli script uci-defaults
    openings = []
    for blk in re.split(r"\nconfig ", text):
        if (blk.startswith("rule") and re.search(r"option src\s+'?wan'?", blk)
                and re.search(r"option target\s+'?ACCEPT'?", blk) and not re.search(r"option dest\s", blk)):
            port = re.search(r"option dest_port\s+'?([\w:-]+)'?", blk)
            name = re.search(r"option name\s+'?([^'\n]+)'?", blk)
            if port:
                openings.append(f"/etc/config/firewall: {name.group(1) if name else 'regola'} -> porta {port.group(1)}")
    ud = root / "etc/uci-defaults"
    for script in (sorted(ud.iterdir()) if ud.exists() else []):
        t = script.read_text(errors="replace")
        for rule in set(re.findall(r"firewall\.(\w+)\.src='wan'", t)):
            if re.search(rf"firewall\.{rule}\.target='ACCEPT'", t):
                m = re.search(rf"firewall\.{rule}\.dest_port=['\"]?([^'\"\n]+)", t)
                port = m.group(1) if m else "?"
                if port.startswith("$"):  # es. $openvpn_port con default impostato nello script
                    var = port.strip("${}")
                    d = re.search(rf"{var}=['\"]?(\d+)", t)
                    port = f"{port} (default {d.group(1)})" if d else port
                if not re.search(rf"firewall\.{rule}\.dest=", t):
                    openings.append(f"{rel(root, script)}: regola '{rule}' apre dalla WAN la porta {port}")
    if pol is None:
        return result("C07", "Firewall sulla WAN", WARN, "Nessuna zona 'wan' trovata.", "I.2(j)", "5.6", openings)
    if pol not in ("REJECT", "DROP"):
        return result("C07", "Firewall sulla WAN", FAIL, f"La zona WAN accetta il traffico in ingresso (policy {pol}).",
                      "I.2(j)", "5.6", openings)
    if openings:
        return result("C07", "Firewall sulla WAN", WARN,
                      f"La policy di ingresso WAN è {pol}, ma {len(openings)} regole aprono porte verso Internet. "
                      "Ogni apertura va giustificata; se il servizio è disattivato, la regola non dovrebbe esistere.",
                      "I.2(j)", "5.6", openings)
    return result("C07", "Firewall sulla WAN", PASS, f"Policy di ingresso WAN {pol}, nessuna porta aperta dalla WAN.",
                  "I.2(j)", "5.6")


def check_setuid(root: Path):
    found = []
    for p in walk_files(root):
        try:
            st = p.lstat()
        except OSError:
            continue
        if stat.S_ISREG(st.st_mode) and st.st_mode & (stat.S_ISUID | stat.S_ISGID):
            found.append(rel(root, p))
    return result("C08", "Binari setuid/setgid", INFO if len(found) <= 5 else WARN,
                  f"{len(found)} file con bit setuid o setgid (possibili vie di escalation dei privilegi).",
                  "I.2(k)", "5.6", found)


def _elf_props(path: Path):
    """Legge le protezioni dai segmenti ELF, non dalle sezioni: i firmware OpenWrt sono
    passati da sstrip, che elimina la tabella delle sezioni (.dynsym, .dynamic)."""
    with open(path, "rb") as f:
        elf = ELFFile(f)
        if elf.header.e_type not in ("ET_EXEC", "ET_DYN"):
            return None
        interp, nx, relro, now, syms = None, True, False, False, set()
        for seg in elf.iter_segments():
            t = seg.header.p_type
            if t == "PT_INTERP":
                interp = seg.get_interp_name()
            elif t == "PT_GNU_STACK":
                nx = not (seg.header.p_flags & 1)
            elif t == "PT_GNU_RELRO":
                relro = True
            elif t == "PT_DYNAMIC":
                for tag in seg.iter_tags():
                    d = tag.entry.d_tag
                    if d == "DT_BIND_NOW" or (d == "DT_FLAGS" and tag.entry.d_val & 0x8) \
                            or (d == "DT_FLAGS_1" and tag.entry.d_val & 0x1):
                        now = True
                try:
                    syms = {sym.name for sym in seg.iter_symbols()}
                except Exception:  # tabella dei simboli non ricostruibile
                    syms = set()
        is_lib = elf.header.e_type == "ET_DYN" and not interp
        musl = bool(interp and "musl" in interp)
        return {
            "type": "lib" if is_lib else "exe",
            "nx": nx,
            "pie": (elf.header.e_type == "ET_DYN") if not is_lib else None,
            "relro": "full" if relro and now else ("partial" if relro else "no"),
            "canary": "__stack_chk_fail" in syms or "__stack_chk_guard" in syms,
            # con musl FORTIFY è implementato da header inline (fortify-headers): non lascia simboli __*_chk
            "fortify": None if musl else any(x.startswith("__") and x.endswith("_chk") and x != "__stack_chk_fail" for x in syms),
            "libc": "musl" if musl else ("glibc" if interp and "ld-linux" in interp else None),
        }


def check_binary_hardening(root: Path):
    if ELFFile is None:
        return result("C09", "Hardening dei binari", INFO, "pyelftools non installato: controllo saltato "
                      "(pip install pyelftools).", "I.2(k)", "—"), []
    rows = []
    for d in ("bin", "sbin", "usr/bin", "usr/sbin", "usr/libexec", "lib", "usr/lib"):
        base = root / d
        if not base.exists():
            continue
        for p in base.rglob("*"):
            try:
                if p.is_symlink() or not p.is_file():
                    continue
                with open(p, "rb") as f:
                    if f.read(4) != b"\x7fELF":
                        continue
                props = _elf_props(p)
            except (OSError, ELFError, ValueError, KeyError):
                continue
            if props:
                rows.append({"path": rel(root, p), **props})
    exes = [r for r in rows if r["type"] == "exe"]
    n = max(len(exes), 1)
    pct = lambda k, v=True: round(100 * sum(1 for r in exes if r[k] == v) / n)  # noqa: E731
    musl = any(r.get("libc") == "musl" for r in exes)
    summary = {
        "executables": len(exes), "libraries": len(rows) - len(exes),
        "nx_pct": pct("nx"), "pie_pct": pct("pie"), "full_relro_pct": pct("relro", "full"),
        "canary_pct": pct("canary"), "fortify_pct": None if musl else pct("fortify"),
        "libc": "musl" if musl else "glibc/altro",
    }
    worst = [r["path"] for r in exes if not r["pie"] and not r["canary"]][:25]
    status = FAIL if summary["canary_pct"] < 50 or summary["pie_pct"] < 50 else (WARN if summary["full_relro_pct"] < 80 else PASS)
    detail = (f"{summary['executables']} eseguibili analizzati. NX {summary['nx_pct']}%, PIE {summary['pie_pct']}%, "
              f"RELRO completo {summary['full_relro_pct']}%, stack canary {summary['canary_pct']}%, "
              + (f"FORTIFY {summary['fortify_pct']}%. " if summary["fortify_pct"] is not None else
                 "FORTIFY non misurabile (con musl è implementato da header inline che non lasciano simboli). ")
              + "Le protezioni del compilatore mitigano lo sfruttamento di buffer overflow e bug di memoria.")
    res = result("C09", "Hardening dei binari (protezioni del compilatore)", status, detail, "I.2(k)", "5.6",
                 [f"Senza PIE né canary: {p}" for p in worst])
    res["summary"] = summary
    return res, rows


# ----------------------------------------------------------------- report ---

def to_markdown(checks: list[dict], rootname: str) -> str:
    icon = {PASS: "✅ PASS", FAIL: "❌ FAIL", WARN: "⚠️ WARN", INFO: "ℹ️ INFO"}
    out = [f"# Controlli di sicurezza del firmware: {rootname}", "",
           "| ID | Controllo | Esito | CRA Allegato I | ETSI EN 303 645 |", "|---|---|---|---|---|"]
    for c in checks:
        out.append(f"| {c['id']} | {c['title']} | {icon[c['status']]} | {c['cra']} | {c['etsi_en_303_645']} |")
    out.append("")
    for c in checks:
        out += [f"## {c['id']} · {c['title']}: {c['status']}", "", c["detail"], ""]
        if c["evidence"]:
            ev = c["evidence"][:30]
            out += ["```"] + ev + (["…"] if len(c["evidence"]) > 30 else []) + ["```", ""]
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rootfs", type=Path)
    ap.add_argument("-o", "--output", type=Path, required=True)
    ap.add_argument("--md", type=Path)
    ap.add_argument("--name", default=None)
    a = ap.parse_args(argv)
    root = a.rootfs.resolve()
    checks = [check_root_password(root), check_private_keys(root), check_ssh_host_keys(root),
              check_insecure_daemons(root), check_enabled_services(root), check_package_signatures(root),
              check_wan_firewall(root), check_setuid(root)]
    hard, rows = check_binary_hardening(root)
    checks.append(hard)
    dump_json({"checks": checks, "binaries": rows}, a.output)
    if a.md:
        a.md.write_text(to_markdown(checks, a.name or root.name), encoding="utf-8")
    for c in checks:
        print(f"{c['id']} {c['status']:<4} {c['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
