"""Funzioni condivise: confronto di versioni, parsing CPE, I/O compresso."""
from __future__ import annotations

import gzip
import json
import lzma
import re
from pathlib import Path
from typing import IO, Iterable

# Parole che indicano una pre-release: "1.0rc1" viene prima di "1.0".
_PRERELEASE = {"alpha", "beta", "rc", "pre", "preview", "dev", "snapshot"}
_TOKEN = re.compile(r"\d+|[a-zA-Z]+")


def _tokens(version: str) -> list[tuple[int, object]]:
    """Scompone una versione in token confrontabili.

    Ogni token diventa (rango, valore):
      rango 0 = pre-release (alpha, rc...), sempre inferiore alla fine della stringa
      rango 1 = fine stringa (aggiunto implicitamente nel confronto)
      rango 2 = lettera "normale" (es. la 'q' di OpenSSL 1.1.1q, la 'p' di OpenSSH 9.0p1)
      rango 3 = numero
    """
    out: list[tuple[int, object]] = []
    for tok in _TOKEN.findall(version.lower()):
        if tok.isdigit():
            out.append((3, int(tok)))
        elif tok in _PRERELEASE:
            out.append((0, tok))
        else:
            out.append((2, tok))
    return out


def vercmp(a: str, b: str) -> int:
    """Restituisce -1, 0 o 1. Pensato per versioni upstream (OpenSSL, BusyBox, dnsmasq...)."""
    ta, tb = _tokens(a), _tokens(b)
    end = (1, "")
    for i in range(max(len(ta), len(tb))):
        x = ta[i] if i < len(ta) else end
        y = tb[i] if i < len(tb) else end
        if x == y:
            continue
        if x[0] != y[0]:
            return -1 if x[0] < y[0] else 1
        return -1 if x[1] < y[1] else 1  # type: ignore[operator]
    return 0


_RELEASE_SUFFIX = re.compile(r"-r?\d+$")


def upstream_version(openwrt_version: str) -> str:
    """'1.1.1q-20' -> '1.1.1q', '1.37.0-r1' -> '1.37.0'. Toglie il numero di release del pacchetto
    (PKG_RELEASE di opkg, -rN di apk), che NVD non conosce."""
    return _RELEASE_SUFFIX.sub("", openwrt_version.strip())


def cpe22_to_vendor_product(cpe: str) -> tuple[str, str, str] | None:
    """'cpe:/a:openssl:openssl' -> ('a', 'openssl', 'openssl')."""
    m = re.match(r"^cpe:/([aoh]):([^:]+):([^:]+)", cpe.strip())
    return (m.group(1), m.group(2).lower(), m.group(3).lower()) if m else None


def cpe23(part: str, vendor: str, product: str, version: str) -> str:
    esc = lambda s: re.sub(r"([^A-Za-z0-9_.\-~])", r"\\\1", s)  # noqa: E731
    return f"cpe:2.3:{part}:{esc(vendor)}:{esc(product)}:{esc(version)}:*:*:*:*:*:*:*"


def parse_cpe23(cpe: str) -> dict[str, str] | None:
    # split rispettando gli escape "\:"
    fields = re.split(r"(?<!\\):", cpe)
    if len(fields) < 6 or fields[0] != "cpe" or fields[1] != "2.3":
        return None
    unesc = lambda s: re.sub(r"\\(.)", r"\1", s)  # noqa: E731
    return {
        "part": fields[2],
        "vendor": unesc(fields[3]).lower(),
        "product": unesc(fields[4]).lower(),
        "version": unesc(fields[5]),
        "update": unesc(fields[6]) if len(fields) > 6 else "*",
    }


def open_maybe_compressed(path: str | Path, mode: str = "rb") -> IO:
    p = str(path)
    if p.endswith(".xz"):
        return lzma.open(p, mode)
    if p.endswith(".gz"):
        return gzip.open(p, mode)
    return open(p, mode)


def load_json(path: str | Path):
    with open_maybe_compressed(path, "rt") as f:
        return json.load(f)


def dump_json(obj, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def chunked(items: Iterable, size: int):
    buf = []
    for it in items:
        buf.append(it)
        if len(buf) == size:
            yield buf
            buf = []
    if buf:
        yield buf
