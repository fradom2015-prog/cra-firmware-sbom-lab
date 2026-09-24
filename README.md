# cra-firmware-sbom-lab

Pipeline di **product security** per firmware Linux embedded (OpenWrt), costruita attorno ai requisiti
del **Cyber Resilience Act** (Regolamento UE 2024/2847):

```
firmware.bin ──► estrazione ──► SBOM CycloneDX ──► CVE da NVD ──► priorità (CVSS, EPSS, CISA KEV)
                     │                                                   │
                     └──► controlli di configurazione e hardening        └──► VEX + report + gate CI
```

| Strumento | Cosa fa |
|---|---|
| [`tools/fw_sbom.py`](tools/fw_sbom.py) | SBOM CycloneDX 1.6 dal database opkg/apk, usando i `CPE-ID` dichiarati da OpenWrt e correggendo quelli sbagliati |
| [`tools/compare_syft.py`](tools/compare_syft.py) | Misura la qualità della SBOM di syft rispetto a quella di fw_sbom |
| [`tools/nvd_match.py`](tools/nvd_match.py) | Confronta i CPE con i feed NVD (regole di versione incluse), senza dipendere da database esterni |
| [`tools/triage.py`](tools/triage.py) | Arricchisce con KEV ed EPSS, assegna le priorità, applica le decisioni VEX, genera report e VEX, fa da gate in CI |
| [`tools/fw_checks.py`](tools/fw_checks.py) | 9 controlli (password, chiavi incorporate, servizi, firewall, firma degli aggiornamenti, NX/PIE/RELRO/canary) mappati su CRA ed ETSI EN 303 645 |

## Risultati sul firmware di esempio

Build comunitaria ImmortalWrt 18.06 per ASUS RT-AC58U (2023). Dettagli in [docs/findings.md](docs/findings.md).

- **syft** legge i pacchetti OpenWrt come se fossero Debian: 0 versioni confrontabili con NVD su 117.
  **fw_sbom**: 118 componenti con CPE corretto, dopo aver corretto 8 CPE sbagliati dichiarati nei pacchetti.
- **548 CVE** su 35 componenti; 2 nel catalogo CISA KEV. **SambaCry** (CVE-2017-7494) è confermata
  sfruttabile e blocca il gate; **Zerologon** non si applica (il dispositivo non è un domain controller).
- **VEX con 18 decisioni motivate**, per esempio regreSSHion `not_affected` perché nel firmware sshd non c'è.
- **Chiave privata di una CA OpenVPN** inclusa nell'immagine, identica per tutti; verifica della firma
  dei pacchetti disattivata; root senza password; PIE solo sul 7% degli eseguibili.

Output completi: [`examples/immortalwrt-asus-rt-ac58u/`](examples/immortalwrt-asus-rt-ac58u/)
([report](examples/immortalwrt-asus-rt-ac58u/report.md) ·
[controlli](examples/immortalwrt-asus-rt-ac58u/checks.md) ·
[confronto syft](examples/immortalwrt-asus-rt-ac58u/confronto-syft.md) ·
[SBOM](examples/immortalwrt-asus-rt-ac58u/sbom.cdx.json) ·
[VEX](examples/immortalwrt-asus-rt-ac58u/vex.cdx.json)).

## Uso rapido

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
bash scripts/run_lab.sh firmware.bin out            # oppure una cartella con il rootfs estratto
FAIL_ON=P1 bash scripts/run_lab.sh firmware.bin out # esce con 1 se restano finding P1 aperti
```

Guida completa, esercizi inclusi: [docs/LAB.md](docs/LAB.md).

## Documentazione

- [docs/findings.md](docs/findings.md): risultati e limiti dell'analisi
- [docs/mappa-cra.md](docs/mappa-cra.md): quale requisito del CRA copre ogni parte
- [docs/politica-cvd-produttore.md](docs/politica-cvd-produttore.md): modello di politica di divulgazione coordinata per un produttore
- [SECURITY.md](SECURITY.md) e [.well-known/security.txt](.well-known/security.txt)
- [vex/decisions.toml](vex/decisions.toml): le decisioni di analisi, una per CVE, con la verifica fatta

## Limiti

- Il confronto via CPE produce falsi positivi (CVE limitate a piattaforme specifiche) e falsi negativi
  (pacchetti senza CPE). Il report lo dichiara e il VEX serve proprio a gestirli.
- Il kernel è escluso dal confronto automatico (`--include-kernel` per attivarlo): le CVE del kernel
  vanno valutate per configurazione e moduli effettivamente compilati.
- `fw_checks.py` è un controllo statico: non sostituisce un pentest dei servizi in esecuzione.

## Autore

Francesco Terracciano · laboratorio personale di preparazione su product security e Cyber Resilience Act.
Licenza [MIT](LICENSE).
