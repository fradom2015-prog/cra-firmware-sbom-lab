# Triage vulnerabilità: ImmortalWrt 18.06-k5.4 per ASUS RT-AC58U (build 2023-03-09)

- **Generato**: 2026-09-24 12:52 UTC
- **SBOM**: `urn:uuid:1993c083-e26b-4782-95c9-951929a1b9da`
- **Fonti**: NVD (28 feed)
- **Catalogo KEV**: 2026.09.23 (1721 voci)
- **EPSS**: non disponibile (API FIRST non raggiungibile)

## Sintesi

| Priorità | Significato | Aperte | Chiuse con VEX |
|---|---|---|---|
| P1 | Massima: correggere subito | 1 | 1 |
| P2 | Alta: pianificare il fix a breve | 319 | 13 |
| P3 | Media: entro il ciclo di rilascio | 192 | 3 |
| P4 | Bassa: monitorare | 19 | 0 |

**548** corrispondenze CVE su **35** componenti. **1** aperte sono nel catalogo CISA KEV.

## Vulnerabilità nel catalogo CISA KEV

Sono sfruttate attivamente nel mondo reale. Per il Cyber Resilience Act (art. 14) la notifica entro 24 ore scatta quando il produttore viene a conoscenza di una vulnerabilità attivamente sfruttata **contenuta nel proprio prodotto**: questi casi vanno portati subito in valutazione.

| CVE | Componente | Versione | CVSS | In KEV dal | Ransomware | Corretta in | Stato |
|---|---|---|---|---|---|---|---|
| [CVE-2017-7494](https://nvd.nist.gov/vuln/detail/CVE-2017-7494) | samba | 3.6.25 | 9.8 | 2023-03-30 | Known | 4.4.0 | exploitable |
| [CVE-2020-1472](https://nvd.nist.gov/vuln/detail/CVE-2020-1472) | samba | 3.6.25 | 5.5 | 2021-11-03 | Known | 4.10.18 | not_affected |

## Priorità P1 e P2 aperte

| CVE | P | Componente | Versione | CVSS | EPSS | Corretta in | Motivo |
|---|---|---|---|---|---|---|---|
| [CVE-2017-7494](https://nvd.nist.gov/vuln/detail/CVE-2017-7494) | P1 | samba | 3.6.25 | 9.8 | n.d. | 4.4.0 | Nel catalogo CISA KEV: sfruttata attivamente nel mondo reale |
| [CVE-2017-18342](https://nvd.nist.gov/vuln/detail/CVE-2017-18342) | P2 | pyyaml | 0.2.5 | 9.8 | n.d. | 5.1 | CVSS 9.8, EPSS non disponibile |
| [CVE-2021-26937](https://nvd.nist.gov/vuln/detail/CVE-2021-26937) | P2 | screen | 4.8.0 | 9.8 | n.d. |  | CVSS 9.8, EPSS non disponibile |
| [CVE-2022-0318](https://nvd.nist.gov/vuln/detail/CVE-2022-0318) | P2 | vim | 8.2 | 9.8 | n.d. | 8.2.4151 | CVSS 9.8, EPSS non disponibile |
| [CVE-2022-3520](https://nvd.nist.gov/vuln/detail/CVE-2022-3520) | P2 | vim | 8.2 | 9.8 | n.d. | 9.0.0765 | CVSS 9.8, EPSS non disponibile |
| [CVE-2022-37434](https://nvd.nist.gov/vuln/detail/CVE-2022-37434) | P2 | zlib | 1.2.12 | 9.8 | n.d. |  | CVSS 9.8, EPSS non disponibile |
| [CVE-2022-46393](https://nvd.nist.gov/vuln/detail/CVE-2022-46393) | P2 | mbed_tls | 2.28.0 | 9.8 | n.d. | 2.28.2 | CVSS 9.8, EPSS non disponibile |
| [CVE-2022-48174](https://nvd.nist.gov/vuln/detail/CVE-2022-48174) | P2 | busybox | 1.35.0 | 9.8 | n.d. |  | CVSS 9.8, EPSS non disponibile |
| [CVE-2023-38545](https://nvd.nist.gov/vuln/detail/CVE-2023-38545) | P2 | libcurl | 7.83.1 | 9.8 | n.d. | 8.4.0 | CVSS 9.8, EPSS non disponibile |
| [CVE-2023-3961](https://nvd.nist.gov/vuln/detail/CVE-2023-3961) | P2 | samba | 3.6.25 | 9.8 | n.d. | 4.17.12 | CVSS 9.8, EPSS non disponibile |
| [CVE-2023-45853](https://nvd.nist.gov/vuln/detail/CVE-2023-45853) | P2 | zlib | 1.2.12 | 9.8 | n.d. | 1.3.1 | CVSS 9.8, EPSS non disponibile |
| [CVE-2024-27903](https://nvd.nist.gov/vuln/detail/CVE-2024-27903) | P2 | openvpn | 2.5.7 | 9.8 | n.d. | 2.5.10 | CVSS 9.8, EPSS non disponibile |
| [CVE-2024-45491](https://nvd.nist.gov/vuln/detail/CVE-2024-45491) | P2 | libexpat | 2.4.7 | 9.8 | n.d. | 2.6.3 | CVSS 9.8, EPSS non disponibile |
| [CVE-2024-45492](https://nvd.nist.gov/vuln/detail/CVE-2024-45492) | P2 | libexpat | 2.4.7 | 9.8 | n.d. | 2.6.3 | CVSS 9.8, EPSS non disponibile |
| [CVE-2024-52533](https://nvd.nist.gov/vuln/detail/CVE-2024-52533) | P2 | glib | 2.70.4 | 9.8 | n.d. | 2.82.1 | CVSS 9.8, EPSS non disponibile |
| [CVE-2024-56171](https://nvd.nist.gov/vuln/detail/CVE-2024-56171) | P2 | libxml2 | 2.9.14 | 9.8 | n.d. | 2.12.10 | CVSS 9.8, EPSS non disponibile |
| [CVE-2025-14087](https://nvd.nist.gov/vuln/detail/CVE-2025-14087) | P2 | glib | 2.70.4 | 9.8 | n.d. | 2.86.3 | CVSS 9.8, EPSS non disponibile |
| [CVE-2025-47917](https://nvd.nist.gov/vuln/detail/CVE-2025-47917) | P2 | mbed_tls | 2.28.0 | 9.8 | n.d. | 3.6.4 | CVSS 9.8, EPSS non disponibile |
| [CVE-2025-68615](https://nvd.nist.gov/vuln/detail/CVE-2025-68615) | P2 | net-snmp | 5.9.1 | 9.8 | n.d. | 5.9.5 | CVSS 9.8, EPSS non disponibile |
| [CVE-2026-34877](https://nvd.nist.gov/vuln/detail/CVE-2026-34877) | P2 | mbed_tls | 2.28.0 | 9.8 | n.d. | 3.6.6 | CVSS 9.8, EPSS non disponibile |
| [CVE-2026-6653](https://nvd.nist.gov/vuln/detail/CVE-2026-6653) | P2 | libxml2 | 2.9.14 | 9.8 | n.d. |  | CVSS 9.8, EPSS non disponibile |
| [CVE-2026-60002](https://nvd.nist.gov/vuln/detail/CVE-2026-60002) | P2 | openssh | 9.0p1 | 9.4 | n.d. | 10.4 | CVSS 9.4, EPSS non disponibile |
| [CVE-2021-46848](https://nvd.nist.gov/vuln/detail/CVE-2021-46848) | P2 | libtasn1 | 4.16.0 | 9.1 | n.d. | 4.19.0 | CVSS 9.1, EPSS non disponibile |
| [CVE-2022-35409](https://nvd.nist.gov/vuln/detail/CVE-2022-35409) | P2 | mbed_tls | 2.28.0 | 9.1 | n.d. | 2.28.1 | CVSS 9.1, EPSS non disponibile |
| [CVE-2023-25725](https://nvd.nist.gov/vuln/detail/CVE-2023-25725) | P2 | haproxy | 2.6.2 | 9.1 | n.d. | 2.6.9 | CVSS 9.1, EPSS non disponibile |
| [CVE-2024-38428](https://nvd.nist.gov/vuln/detail/CVE-2024-38428) | P2 | wget | 1.21.2 | 9.1 | n.d. |  | CVSS 9.1, EPSS non disponibile |
| [CVE-2026-34872](https://nvd.nist.gov/vuln/detail/CVE-2026-34872) | P2 | mbed_tls | 2.28.0 | 9.1 | n.d. | 3.6.6 | CVSS 9.1, EPSS non disponibile |
| [CVE-2026-55203](https://nvd.nist.gov/vuln/detail/CVE-2026-55203) | P2 | haproxy | 2.6.2 | 9.1 | n.d. |  | CVSS 9.1, EPSS non disponibile |
| [CVE-2026-58016](https://nvd.nist.gov/vuln/detail/CVE-2026-58016) | P2 | glib | 2.70.4 | 9.1 | n.d. | 2.88.1 | CVSS 9.1, EPSS non disponibile |
| [CVE-2018-10858](https://nvd.nist.gov/vuln/detail/CVE-2018-10858) | P2 | samba | 3.6.25 | 8.8 | n.d. | 4.6.16 | CVSS 8.8, EPSS non disponibile |
| [CVE-2021-33621](https://nvd.nist.gov/vuln/detail/CVE-2021-33621) | P2 | ruby | 3.1.2 | 8.8 | n.d. | 3.1.3 | CVSS 8.8, EPSS non disponibile |
| [CVE-2021-44142](https://nvd.nist.gov/vuln/detail/CVE-2021-44142) | P2 | samba | 3.6.25 | 8.8 | n.d. | 4.13.17 | CVSS 8.8, EPSS non disponibile |
| [CVE-2022-0729](https://nvd.nist.gov/vuln/detail/CVE-2022-0729) | P2 | vim | 8.2 | 8.8 | n.d. | 8.2.4440 | CVSS 8.8, EPSS non disponibile |
| [CVE-2022-1271](https://nvd.nist.gov/vuln/detail/CVE-2022-1271) | P2 | gzip | 1.11 | 8.8 | n.d. | 1.12 | CVSS 8.8, EPSS non disponibile |
| [CVE-2022-24805](https://nvd.nist.gov/vuln/detail/CVE-2022-24805) | P2 | net-snmp | 5.9.1 | 8.8 | n.d. | 5.9.2 | CVSS 8.8, EPSS non disponibile |
| [CVE-2022-24810](https://nvd.nist.gov/vuln/detail/CVE-2022-24810) | P2 | net-snmp | 5.9.1 | 8.8 | n.d. | 5.9.2 | CVSS 8.8, EPSS non disponibile |
| [CVE-2022-28391](https://nvd.nist.gov/vuln/detail/CVE-2022-28391) | P2 | busybox | 1.35.0 | 8.8 | n.d. |  | CVSS 8.8, EPSS non disponibile |
| [CVE-2022-42898](https://nvd.nist.gov/vuln/detail/CVE-2022-42898) | P2 | samba | 3.6.25 | 8.8 | n.d. | 4.15.12 | CVSS 8.8, EPSS non disponibile |
| [CVE-2024-4877](https://nvd.nist.gov/vuln/detail/CVE-2024-4877) | P2 | openvpn | 2.5.7 | 8.8 | n.d. | 2.6.11 | CVSS 8.8, EPSS non disponibile |
| [CVE-2025-5372](https://nvd.nist.gov/vuln/detail/CVE-2025-5372) | P2 | libssh | 0.9.6 | 8.8 | n.d. | 0.11.2 | CVSS 8.8, EPSS non disponibile |

_Altre 280 in `triage.json`._

## Per componente

Il piano di remediation si ragiona per componente: un solo aggiornamento chiude molte CVE.

| Componente | Versione | CVE aperte | P1 | KEV | CVSS max | Versione minima che le chiude |
|---|---|---|---|---|---|---|
| samba | 3.6.25 | 46 | 1 | 1 | 9.8 | 4.19.2 |
| vim | 8.2 | 214 | 0 | 0 | 9.8 | 9.2.0842 |
| libexpat | 2.4.7 | 33 | 0 | 0 | 9.8 | 2.8.4 |
| libxml2 | 2.9.14 | 29 | 0 | 0 | 9.8 | 2.15.4 |
| mbed_tls | 2.28.0 | 23 | 0 | 0 | 9.8 | 3.6.6 |
| glib | 2.70.4 | 18 | 0 | 0 | 9.8 | 2.88.1 |
| openvpn | 2.5.7 | 9 | 0 | 0 | 9.8 | 2.6.21 |
| net-snmp | 5.9.1 | 9 | 0 | 0 | 9.8 | 5.9.5 |
| libcurl | 7.83.1 | 7 | 0 | 0 | 9.8 | 8.12.0 |
| busybox | 1.35.0 | 5 | 0 | 0 | 9.8 |  |
| zlib | 1.2.12 | 4 | 0 | 0 | 9.8 | 1.3.2 |
| screen | 4.8.0 | 2 | 0 | 0 | 9.8 |  |
| pyyaml | 0.2.5 | 1 | 0 | 0 | 9.8 | 5.1 |
| openssh | 9.0p1 | 19 | 0 | 0 | 9.4 | 10.5 |
| haproxy | 2.6.2 | 9 | 0 | 0 | 9.1 | 3.3.6 |
| wget | 1.21.2 | 5 | 0 | 0 | 9.1 |  |
| libtasn1 | 4.16.0 | 1 | 0 | 0 | 9.1 | 4.19.0 |
| openssl | 1.1.1q | 26 | 0 | 0 | 8.8 | 1.1.1zi |
| libssh | 0.9.6 | 16 | 0 | 0 | 8.8 | 0.12.0 |
| gzip | 1.11 | 3 | 0 | 0 | 8.8 | 1.12 |
| ruby | 3.1.2 | 1 | 0 | 0 | 8.8 | 3.1.3 |
| c-ares | 1.18.1 | 5 | 0 | 0 | 8.6 | 1.19.1 |
| bind | 9.18.1 | 20 | 0 | 0 | 8.2 | 9.18.49 |
| gnutls | 3.7.7 | 4 | 0 | 0 | 8.2 | 3.8.10 |
| json-c | 0.15 | 1 | 0 | 0 | 7.8 | 0.15-20200726 |
| e2fsprogs | 1.46.5 | 1 | 0 | 0 | 7.8 |  |
| dnsmasq | 2.86 | 5 | 0 | 0 | 7.5 | 2.93 |
| giflib | 5.2.1 | 4 | 0 | 0 | 7.1 |  |
| nano | 6.4 | 1 | 0 | 0 | 6.7 | 8.0 |
| dbus | 1.13.18 | 3 | 0 | 0 | 6.5 | 1.14.4 |
| ppp | 2.4.9.git-2021-01-04 | 1 | 0 | 0 | 6.5 | 2.5.0 |
| iputils | 20211215 | 1 | 0 | 0 | 6.5 | 20250602 |
| coreutils | 9.1 | 1 | 0 | 0 | 6.1 |  |
| dropbear_ssh | 2022.82 | 1 | 0 | 0 | 5.9 | 2022.83 |
| util-linux | 2.38 | 3 | 0 | 0 | 5.3 | 2.42.2 |

## Qualità della SBOM

- Pacchetti installati: **772** (opkg)
- Componenti con CPE: **118** (15.3%). Gli altri non possono essere confrontati con NVD: servono CPE o purl migliori.
- CPE corretti con alias verificati: 17
- Kernel: 5.4.203 (escluso dal confronto automatico, da valutare a parte)

## Metodo

- **P1**: nel catalogo CISA KEV, oppure CVSS ≥ 7 con EPSS ≥ 0,5.
- **P2**: CVSS ≥ 7, oppure CVSS 4–6,9 con EPSS ≥ 0,5.
- **P3**: CVSS 4–6,9, oppure CVSS basso con EPSS ≥ 0,5.
- **P4**: il resto.
- Le decisioni di analisi (VEX) in `vex/decisions.toml` chiudono i finding non sfruttabili nel contesto del prodotto; ogni chiusura richiede una motivazione.
- Le corrispondenze basate su CPE possono contenere falsi positivi (per esempio CVE che riguardano solo alcune piattaforme): vanno verificate prima di comunicarle all'esterno.
