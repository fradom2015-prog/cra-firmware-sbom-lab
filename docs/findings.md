# Risultati sul firmware di esempio

**Firmware**: build comunitaria ImmortalWrt 18.06-k5.4 per il router ASUS RT-AC58U (target ipq40xx),
compilata il 9 marzo 2023 e pubblicata sul repository GitHub `SuLingGG/OpenWrt-Rpi`.
**SHA-256**: `d9cd6f6c11ea7125aa17c420087a16b8ca1923bca079660dbce390d1167d4b6d`
**Analisi**: 24 settembre 2026, feed NVD aggiornati allo stesso giorno, catalogo CISA KEV 2026.09.23.

Non è un firmware ufficiale ASUS né OpenWrt: è una distribuzione comunitaria con molti pacchetti extra.
L'ho scelta come caso realistico di prodotto Linux embedded con tre anni di vita sul campo. I risultati
riguardano questa build, non i prodotti ASUS né OpenWrt ufficiale.

I file completi sono in [`examples/immortalwrt-asus-rt-ac58u/`](../examples/immortalwrt-asus-rt-ac58u/).

## 1. La SBOM generata da syft è quasi inutilizzabile per questo firmware

syft 1.52 legge il database opkg con il catalogatore di Debian (il formato del file è simile). Su 772
pacchetti installati:

- ogni pacchetto compare **due volte** (1.544 voci);
- **nessuna** voce ha un purl;
- 759 CPE contengono il numero di release di OpenWrt nella versione (`1.1.1q-20` invece di `1.1.1q`),
  che NVD non conosce;
- dei 117 pacchetti per cui OpenWrt dichiara un CPE, syft indovina il vendor:product giusto per 7 e
  la versione giusta per **nessuno**. Per esempio `libopenssl1.1` diventa
  `cpe:2.3:a:libopenssl1.1:libopenssl1.1:1.1.1q-20`, che non corrisponde a niente in NVD.

Il catalogatore binario di syft funziona invece bene: riconosce bash, busybox, curl, gzip, jq e openssl
dalla firma nell'eseguibile, con CPE corretti.

**Cosa fa fw_sbom**: usa il campo `CPE-ID` che OpenWrt scrive nel file `.control` di ogni pacchetto,
toglie il numero di release e unifica i duplicati. Risultato: 118 componenti con CPE confrontabile
(15,3% dei pacchetti; gli altri sono per lo più pacchetti di configurazione, traduzioni e moduli kernel).
SBOM e VEX sono validati contro lo schema CycloneDX 1.6 nei test.

Dettaglio: [`confronto-syft.md`](../examples/immortalwrt-asus-rt-ac58u/confronto-syft.md).

## 2. Anche i CPE dichiarati da OpenWrt a volte sono sbagliati

8 dei 58 prodotti dichiarati non compaiono in nessuna delle 396.876 CVE di NVD con quel nome. Per
ciascuno ho cercato il nome usato da NVD e l'ho verificato sugli stessi feed:

| Dichiarato nel pacchetto | Nome in NVD | CVE con il nome NVD |
|---|---|---|
| `openssh:openssh` | `openbsd:openssh` | 137 |
| `matt_johnston:dropbear_ssh_server` | `dropbear_ssh_project:dropbear_ssh` | 20 |
| `gnu:zlib` | `zlib:zlib` | 15 |
| `libexpat:expat` | `libexpat_project:libexpat` | presente |
| `json-c_project:json-c` | `json-c:json-c` | presente |
| `netfilter_core_team:iptables` | `netfilter:iptables` | presente |
| `iputils_project:iputils` | `iputils:iputils` | presente |
| `pyyaml_project:pyyaml` | `pyyaml:pyyaml` | presente |

Senza queste correzioni la SBOM avrebbe "nascosto" tutte le CVE di OpenSSH, Dropbear e zlib. Gli alias
sono in [`tools/cpe_aliases.json`](../tools/cpe_aliases.json) e ogni componente corretto lo dichiara in
una proprietà `fwsec:cpeAlias`, così la correzione resta tracciabile.

## 3. Vulnerabilità note

548 corrispondenze CVE su 35 componenti. Due sono nel catalogo CISA KEV:

- **CVE-2017-7494 (SambaCry), stato `exploitable`**. smbd di Samba 3.6.25 è installato e le share
  `homes` sono abilitate in `/etc/config/samba`, quindi c'è una share scrivibile per gli utenti
  autenticati: è la precondizione dell'exploit. È l'unico finding P1 aperto e blocca il gate della CI.
- **CVE-2020-1472 (Zerologon), stato `not_affected`**. Colpisce Samba solo come domain controller; il
  template di configurazione del firmware usa `security = user` senza `domain logons`.

Il piano di remediation per componente (tabella completa nel
[report](../examples/immortalwrt-asus-rt-ac58u/report.md)) mostra dove conviene intervenire:
Samba 3.6 (46 CVE aperte, end-of-life dal 2015), vim, libexpat, libxml2, mbed TLS e OpenSSL 1.1.1
(end-of-life da settembre 2023).

**Un limite da dichiarare**: per vim il pacchetto riporta la versione `8.2` senza il patch level, quindi
tutte le 214 CVE di vim 8.2.x risultano applicabili. È un problema di qualità del dato di partenza: una
SBOM utile deve riportare la versione esatta.

## 4. Il VEX: 18 decisioni motivate

Ogni decisione è in [`vex/decisions.toml`](../vex/decisions.toml) con la verifica fatta sul firmware.

| Stato | Quante | Esempio |
|---|---|---|
| `not_affected` / `code_not_present` | 6 | regreSSHion (CVE-2024-6387) riguarda sshd, ma di OpenSSH ci sono solo `sftp-server` e il client `sftp`; `/usr/bin/ssh` è un link a Dropbear |
| `not_affected` / `requires_configuration` | 4 | Zerologon; tre CVE di OpenSSL che richiedono la verifica delle policy X.509, disattivata di default |
| `false_positive` | 7 | CVE-2021-45951…45957 di dnsmasq, contestate dal manutentore (crash nel harness di fuzzing) |
| `exploitable` | 1 | SambaCry |

## 5. Controlli di configurazione

Dettaglio: [`checks.md`](../examples/immortalwrt-asus-rt-ac58u/checks.md).

| Controllo | Esito | Cosa c'è |
|---|---|---|
| Password di root | FAIL | `root::` in `/etc/shadow`: nessuna password al primo avvio |
| Chiavi private nell'immagine | FAIL | Il pacchetto `luci-app-openvpn-server` include la **chiave privata della CA**, la chiave del server e quella di un client OpenVPN, identiche per chiunque installi il firmware. Lo script di rigenerazione (`/etc/openvpncert.sh`) esiste ma nessun componente lo richiama. Inoltre `/etc/uci-defaults/openvpn` apre al primo avvio la porta 1194 dalla WAN, anche se il server è disattivato |
| Verifica della firma dei pacchetti | FAIL | `check_signature` assente in `/etc/opkg.conf` |
| Hardening dei binari | FAIL | Su 223 eseguibili: NX 100%, RELRO completo 99%, stack canary 77%, ma **PIE solo 7%**, quindi l'ASLR è poco efficace |
| Servizi attivi di default | WARN | 11 servizi di rete avviati al boot, tra cui Samba, SNMP, rpcbind, transmission e netdata |
| Chiavi host SSH | PASS | Generate al primo avvio |
| Firewall WAN | WARN | Policy REJECT, ma con la regola OpenVPN aggiunta al primo avvio |

Nella prima versione il controllo di hardening dava stack canary 0%: `sstrip` di OpenWrt elimina la
tabella delle sezioni, e la lettura di `.dynsym` falliva in silenzio. Ora le protezioni si leggono dai
segmenti ELF (`PT_DYNAMIC`). FORTIFY non è misurabile con musl, perché è implementato da header inline
che non lasciano simboli `__*_chk`.

## 6. Cosa dice tutto questo in ottica CRA

Se questo fosse un prodotto messo sul mercato UE oggi:

- **Allegato I, parte I, punto 2(a)** (nessuna vulnerabilità nota sfruttabile): violato, c'è SambaCry.
- **Punto 2(b)** (configurazione sicura di default): violato, nessuna password di root e chiavi condivise.
- **Parte II, punto 1** (SBOM): una SBOM generata "così com'è" con uno strumento generico avrebbe dato
  un falso senso di copertura. La qualità della SBOM va verificata, non solo prodotta.
- **Parte II, punto 7** (distribuzione sicura degli aggiornamenti): la verifica della firma è disattivata.
- **Articolo 14**: SambaCry è nel catalogo KEV. Se il produttore scopre che è sfruttata sui propri
  dispositivi, scatta il preallarme entro 24 ore.

## Divulgazione

Le chiavi OpenVPN incluse nel pacchetto `luci-app-openvpn-server` potrebbero essere presenti anche nelle
versioni attuali di quel pacchetto. Prima di pubblicare questo repository, verifica la versione corrente
e, se il problema è ancora presente, segnalalo ai manutentori secondo la loro politica di sicurezza.
È il processo di divulgazione coordinata che questo laboratorio descrive.
