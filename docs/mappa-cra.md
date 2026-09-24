# Mappa tra requisiti CRA e parti del laboratorio

Come ogni pezzo del repository copre un requisito del Regolamento (UE) 2024/2847.

| Requisito CRA | Cosa chiede | Dove è nel laboratorio |
|---|---|---|
| Allegato I, parte I, 2(a) | Nessuna vulnerabilità nota sfruttabile al momento dell'immissione sul mercato | `nvd_match.py` + `triage.py`: CVE note, priorità, gate che blocca con P1 aperte |
| Allegato I, parte I, 2(b) | Configurazione sicura di default | `fw_checks.py`: password di root, servizi attivi, porte aperte dalla WAN |
| Allegato I, parte I, 2(d) | Protezione dagli accessi non autorizzati | `fw_checks.py` C01 (password), C07 (firewall) |
| Allegato I, parte I, 2(e)(f) | Riservatezza e integrità | `fw_checks.py` C02 (chiavi private), C03 (chiavi host SSH) |
| Allegato I, parte I, 2(j) | Limitare la superficie d'attacco | `fw_checks.py` C04, C05, C07 |
| Allegato I, parte I, 2(k) | Mitigazioni dello sfruttamento | `fw_checks.py` C09 (NX, PIE, RELRO, canary) |
| Allegato I, parte II, 1 | SBOM leggibile da macchina, almeno le dipendenze di primo livello | `fw_sbom.py` (CycloneDX 1.6 validata) e `compare_syft.py` per misurarne la qualità |
| Allegato I, parte II, 2 | Correggere senza ritardo | Tabella "Per componente" del report: versione minima che chiude le CVE |
| Allegato I, parte II, 3 | Test e verifiche regolari | Workflow CI a ogni push e ogni lunedì |
| Allegato I, parte II, 4 | Pubblicare le vulnerabilità corrette | `vex.cdx.json` come base per advisory e VEX pubblici |
| Allegato I, parte II, 5 | Politica di divulgazione coordinata | `SECURITY.md`, `docs/politica-cvd-produttore.md` |
| Allegato I, parte II, 6 | Indirizzo di contatto per le segnalazioni | `.well-known/security.txt` (RFC 9116) |
| Allegato I, parte II, 7 | Distribuzione sicura degli aggiornamenti | `fw_checks.py` C06 (verifica della firma dei pacchetti) |
| Articolo 14 | Notifica entro 24/72 ore delle vulnerabilità attivamente sfruttate | Arricchimento con il catalogo CISA KEV; sezione dedicata del report |
| Allegato VII | Documentazione tecnica | SBOM, report, VEX e decisioni motivate conservati per ogni release |

## Cosa il laboratorio non copre

- Il **risk assessment** del prodotto (Allegato I, parte I, punto 1), che è un documento di progettazione.
- La **valutazione della conformità** e la dichiarazione UE di conformità.
- La **notifica** vera e propria sulla Single Reporting Platform di ENISA.
- L'analisi dinamica del firmware (emulazione, fuzzing, pentest dei servizi).
