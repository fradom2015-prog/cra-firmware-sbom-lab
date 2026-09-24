"""Test della pipeline su un rootfs e un feed NVD minimi costruiti al volo.

I dati qui sono sintetici e servono solo a verificare la logica (parsing, confronto
delle versioni, priorità, VEX). I risultati reali sono in examples/.
"""
import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import fw_checks  # noqa: E402
import fw_sbom  # noqa: E402
import nvd_match  # noqa: E402
import triage  # noqa: E402
from common import upstream_version, vercmp  # noqa: E402


# ------------------------------------------------------------ vercmp -------

@pytest.mark.parametrize("a,b,exp", [
    ("1.1.1q", "1.1.1t", -1),      # lettere OpenSSL
    ("1.1.1q", "1.1.1", 1),
    ("1.1.1zh", "1.1.1q", 1),
    ("9.0p1", "9.3p2", -1),        # OpenSSH
    ("9.0p1", "9.0", 1),
    ("2022.82", "2022.83", -1),    # Dropbear
    ("1.35.0", "1.35.0", 0),
    ("2.86", "2.9", 1),            # 86 > 9 numericamente
    ("1.0rc1", "1.0", -1),         # pre-release
    ("3.0.8", "3.0.13", -1),
])
def test_vercmp(a, b, exp):
    assert vercmp(a, b) == exp


def test_upstream_version():
    assert upstream_version("1.1.1q-20") == "1.1.1q"
    assert upstream_version("2022.82-2") == "2022.82"
    assert upstream_version("2022-01-16-868fd881-1") == "2022-01-16-868fd881"
    assert upstream_version("1.37.0-r1") == "1.37.0"


# ------------------------------------------------------------ fixture ------

@pytest.fixture
def rootfs(tmp_path):
    r = tmp_path / "rootfs"
    info = r / "usr/lib/opkg/info"
    info.mkdir(parents=True)
    (r / "etc/config").mkdir(parents=True)
    (r / "etc/uci-defaults").mkdir(parents=True)
    (r / "etc/dropbear").mkdir(parents=True)
    (r / "etc/openwrt_release").write_text(
        "DISTRIB_ID='OpenWrt'\nDISTRIB_RELEASE='24.10.2'\nDISTRIB_REVISION='r0-test'\n"
        "DISTRIB_TARGET='test/generic'\nDISTRIB_ARCH='test'\nDISTRIB_DESCRIPTION='OpenWrt test'\n")
    status = []
    pkgs = {
        "libopenssl3": ("3.0.8-1", "cpe:/a:openssl:openssl", "libc"),
        "busybox": ("1.36.1-1", "cpe:/a:busybox:busybox", "libc"),
        "openssh-sftp-server": ("9.0p1-1", "cpe:/a:openssh:openssh", "libc"),
        "libc": ("1.2.4-4", "", ""),
        "kmod-foo": ("6.6.86-1", "", ""),
    }
    for name, (ver, cpe, dep) in pkgs.items():
        status.append(f"Package: {name}\nVersion: {ver}\nDepends: {dep}\nStatus: install user installed\nArchitecture: test\n")
        ctrl = f"Package: {name}\nVersion: {ver}\nLicense: MIT\nSource: package/{name}\n"
        if cpe:
            ctrl += f"CPE-ID: {cpe}\n"
        (info / f"{name}.control").write_text(ctrl)
        (info / f"{name}.list").write_text(f"/usr/lib/{name}.so\n")
    # un pacchetto non installato non deve finire nella SBOM
    status.append("Package: ghost\nVersion: 1.0-1\nStatus: deinstall user not-installed\n")
    (r / "usr/lib/opkg/status").write_text("\n".join(status))
    (r / "etc/shadow").write_text("root::19000:0:99999:7:::\n")
    (r / "etc/dropbear/dropbear_rsa_host_key").write_bytes(b"")
    (r / "etc/test.key").write_text("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n")
    (r / "etc/config/firewall").write_text(
        "config zone\n\toption name 'wan'\n\toption input 'REJECT'\n\n"
        "config rule\n\toption name 'Allow-DHCP-Renew'\n\toption src 'wan'\n\toption dest_port '68'\n\toption target 'ACCEPT'\n")
    (r / "etc/uci-defaults/vpn").write_text(
        "p=\"$(uci -q get x)\"\n[ -z \"$p\" ] && p=1194\nuci batch <<EOF\n"
        "set firewall.vpn.src='wan'\nset firewall.vpn.target='ACCEPT'\nset firewall.vpn.dest_port=\"$p\"\nEOF\n")
    (r / "etc/opkg.conf").write_text("option check_signature\n")
    return r


@pytest.fixture
def nvd_feed(tmp_path):
    def item(cid, criteria, score, **rng):
        return {"id": cid, "vulnStatus": "Analyzed",
                "descriptions": [{"lang": "en", "value": f"test {cid}"}],
                "metrics": {"cvssMetricV31": [{"source": "nvd@nist.gov", "type": "Primary",
                                                "cvssData": {"version": "3.1", "baseScore": score, "baseSeverity": "HIGH",
                                                             "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}}]},
                "configurations": [{"nodes": [{"operator": "OR", "cpeMatch": [
                    {"vulnerable": True, "criteria": criteria, **rng}]}]}]}
    feed = {"cve_items": [
        item("CVE-2099-0001", "cpe:2.3:a:openssl:openssl:*:*:*:*:*:*:*:*", 7.5,
             versionStartIncluding="3.0.0", versionEndExcluding="3.0.13"),        # colpisce 3.0.8
        item("CVE-2099-0002", "cpe:2.3:a:openssl:openssl:*:*:*:*:*:*:*:*", 9.8,
             versionStartIncluding="1.1.1", versionEndExcluding="1.1.1t"),         # non colpisce 3.0.8
        item("CVE-2099-0003", "cpe:2.3:a:busybox:busybox:1.36.1:*:*:*:*:*:*:*", 5.5),  # versione esatta
        item("CVE-2099-0004", "cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*", 8.1,
             versionEndExcluding="9.8"),                                           # tramite alias CPE
        item("CVE-2099-0005", "cpe:2.3:a:busybox:busybox:*:*:*:*:*:*:*:*", 9.0),   # senza limiti: scartata
    ]}
    p = tmp_path / "CVE-2099.json"
    p.write_text(json.dumps(feed))
    return p


# ------------------------------------------------------------ tests --------

def test_sbom(rootfs, tmp_path):
    sbom, stats = fw_sbom.build_sbom(rootfs, None, "test")
    names = {c["name"] for c in sbom["components"]}
    assert "ghost" not in names
    assert stats["packages"] == 5 and stats["kernel"] == "6.6.86"
    by = {c["name"]: c for c in sbom["components"]}
    assert by["libopenssl3"]["cpe"] == "cpe:2.3:a:openssl:openssl:3.0.8:*:*:*:*:*:*:*"
    assert by["openssh-sftp-server"]["cpe"].startswith("cpe:2.3:a:openbsd:openssh:9.0p1")  # alias applicato
    assert "cpe" not in by["libc"]
    assert sbom["specVersion"] == "1.6"


def test_match_and_triage(rootfs, nvd_feed, tmp_path):
    sbom, stats = fw_sbom.build_sbom(rootfs, None, "test")
    sp = tmp_path / "sbom.json"
    sp.write_text(json.dumps(sbom))
    res = nvd_match.match(sp, [nvd_feed])
    ids = {f["cve"] for f in res["findings"]}
    assert ids == {"CVE-2099-0001", "CVE-2099-0003", "CVE-2099-0004"}

    mp = tmp_path / "matches.json"
    mp.write_text(json.dumps(res))
    kev = tmp_path / "kev.json"
    kev.write_text(json.dumps({"catalogVersion": "test", "vulnerabilities": [
        {"cveID": "CVE-2099-0003", "dateAdded": "2099-01-01", "knownRansomwareCampaignUse": "Unknown"}]}))
    dec = tmp_path / "decisions.json"
    dec.write_text(json.dumps({"decision": [
        {"cve": "CVE-2099-0004", "component": "openssh", "state": "not_affected",
         "justification": "code_not_present", "detail": "manca sshd"}]}))
    out = tmp_path / "out"
    rc = triage.main(["--sbom", str(sp), "--nvd", str(mp), "--kev", str(kev), "--decisions", str(dec),
                      "--offline", "--cache-dir", str(tmp_path / "c"),
                      "--out-dir", str(out), "--fail-on", "P1"])
    assert rc == 1  # CVE-2099-0003 è nel KEV e resta aperta
    t = json.loads((out / "triage.json").read_text())
    pr = {f["cve"]: (f["priority"], f["state"]) for f in t["findings"]}
    assert pr["CVE-2099-0003"] == ("P1", "in_triage")
    assert pr["CVE-2099-0004"][1] == "not_affected"
    vex = json.loads((out / "vex.cdx.json").read_text())
    v4 = next(v for v in vex["vulnerabilities"] if v["id"] == "CVE-2099-0004")
    assert v4["analysis"] == {"state": "not_affected", "justification": "code_not_present", "detail": "manca sshd"}
    assert v4["affects"][0]["ref"].startswith("urn:cdx:")
    assert "CISA KEV" in (out / "report.md").read_text()


def test_invalid_decision(tmp_path):
    p = tmp_path / "d.json"
    p.write_text(json.dumps({"decision": [{"cve": "CVE-1", "state": "not_affected"}]}))
    with pytest.raises(SystemExit):
        triage.load_decisions(p)


def test_checks(rootfs):
    by = {c["id"]: c for c in [
        fw_checks.check_root_password(rootfs), fw_checks.check_private_keys(rootfs),
        fw_checks.check_ssh_host_keys(rootfs), fw_checks.check_package_signatures(rootfs),
        fw_checks.check_wan_firewall(rootfs)]}
    assert by["C01"]["status"] == "FAIL"
    assert by["C02"]["status"] == "FAIL" and by["C02"]["evidence"][0].startswith("/etc/test.key")
    assert by["C03"]["status"] == "PASS"
    assert by["C06"]["status"] == "PASS"
    assert by["C07"]["status"] == "WARN"
    assert any("default 1194" in e for e in by["C07"]["evidence"])


def test_apk_database(tmp_path):
    """OpenWrt 25.x usa apk: stesso risultato atteso dal parser."""
    r = tmp_path / "rootfs"
    (r / "lib/apk/db").mkdir(parents=True)
    (r / "etc").mkdir()
    (r / "etc/openwrt_release").write_text("DISTRIB_ID='OpenWrt'\nDISTRIB_RELEASE='25.12.0'\n")
    (r / "lib/apk/db/installed").write_text(
        "C:Q1abc=\nP:busybox\nV:1.37.0-r1\nA:x86_64\nL:GPL-2.0-only\no:busybox\nT:Core utilities\nD:libc\n\n"
        "C:Q1def=\nP:libc\nV:1.2.5-r4\nA:x86_64\nL:MIT\n\n")
    sbom, stats = fw_sbom.build_sbom(r, None, None)
    by = {c["name"]: c for c in sbom["components"]}
    assert stats["package_manager"] == "apk" and stats["packages"] == 2
    assert by["busybox"]["version"] == "1.37.0-r1"
    assert by["busybox"]["licenses"][0]["license"]["name"] == "GPL-2.0-only"
    deps = {d["ref"]: d["dependsOn"] for d in sbom["dependencies"]}
    assert deps["pkg:busybox"] == ["pkg:libc"]
