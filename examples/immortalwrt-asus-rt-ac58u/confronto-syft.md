# syft e fw_sbom a confronto sullo stesso firmware

syft 1.52.0 trova **2147** componenti (esclusi i file). Origine:

- `dpkg-db-cataloger`: 1544
- `go-module-binary-cataloger`: 320
- `linux-kernel-cataloger`: 251
- `ruby-gemfile-cataloger`: 13
- `ruby-gemspec-cataloger`: 9
- `binary-classifier-cataloger`: 6
- `github-actions-usage-cataloger`: 3
- `?`: 1

## Pacchetti OpenWrt (opkg)

syft 1.52.0 non riconosce opkg come gestore a sé e ne legge il database con il catalogatore di Debian (`dpkg-db-cataloger`), perché il formato del file è simile. Le conseguenze misurate:

- **1544** voci per **772** pacchetti: 772 pacchetti compaiono due volte (una da `status`, una dal file `.control`).
- Voci con purl: **0**. Senza purl e senza una distro Debian riconosciuta, gli strumenti non sanno a quale database di vulnerabilità collegarle.
- CPE con il numero di release OpenWrt nella versione (es. `1.1.1q-20`): **759**. NVD non conosce quei numeri, quindi i confronti di versione falliscono.
- Dei **117** pacchetti per cui OpenWrt dichiara un CPE, syft indovina il vendor:product giusto per **7** e anche la versione giusta per **0**.

| Pacchetto | CPE di syft | CPE di fw_sbom |
|---|---|---|
| busybox | `cpe:2.3:a:busybox:busybox:1.35.0-3:*:*:*:*:*:*:*` | `cpe:2.3:a:busybox:busybox:1.35.0` |
| dnsmasq-full | `cpe:2.3:a:dnsmasq-full:dnsmasq-full:2.86-1:*:*:*:*:*:*:*` | `cpe:2.3:a:thekelleys:dnsmasq:2.86` |
| dropbear | `cpe:2.3:a:dropbear:dropbear:2022.82-2:*:*:*:*:*:*:*` | `cpe:2.3:a:dropbear_ssh_project:dropbear_ssh:2022.82` |
| libcurl4 | `cpe:2.3:a:libcurl4:libcurl4:7.83.1-1:*:*:*:*:*:*:*` | `cpe:2.3:a:haxx:libcurl:7.83.1` |
| libopenssl1.1 | `cpe:2.3:a:libopenssl1.1:libopenssl1.1:1.1.1q-20:*:*:*:*:*:*:*` | `cpe:2.3:a:openssl:openssl:1.1.1q` |
| openssh-sftp-server | `cpe:2.3:a:openssh-sftp-server:openssh-sftp-server:9.0p1-1:*:*:*:*:*:*:*` | `cpe:2.3:a:openbsd:openssh:9.0p1` |
| openssl-util | `cpe:2.3:a:openssl-util:openssl-util:1.1.1q-20:*:*:*:*:*:*:*` | `cpe:2.3:a:openssl:openssl:1.1.1q` |
| samba36-server | `cpe:2.3:a:samba36-server:samba36-server:3.6.25-15:*:*:*:*:*:*:*` | `cpe:2.3:a:samba:samba:3.6.25` |

## Dove syft funziona bene

Il catalogatore binario riconosce 6 programmi dalla firma nel file eseguibile, con CPE corretti:

- bash 5.1.16: `cpe:2.3:a:gnu:bash:5.1.16:*:*:*:*:*:*:*`
- busybox 1.35.0: `cpe:2.3:a:busybox:busybox:1.35.0:*:*:*:*:*:*:*`
- curl 7.83.1: `cpe:2.3:a:haxx:curl:7.83.1:*:*:*:*:*:*:*`
- gzip 1.11: `cpe:2.3:a:gnu:gzip:1.11:*:*:*:*:*:*:*`
- jq 1.6: `cpe:2.3:a:jqlang:jq:1.6:*:*:*:*:*:*:*`
- openssl 1.1.1q: `cpe:2.3:a:openssl:openssl:1.1.1q:*:*:*:*:*:*:*`

## Conclusione

Su un firmware OpenWrt una SBOM generata solo con syft sembra completa ma è quasi inutilizzabile per il confronto con NVD. fw_sbom usa i metadati che OpenWrt mette già nei pacchetti (`CPE-ID`, `Source`, `License`), toglie il numero di release e corregge i CPE sbagliati con alias verificati. La SBOM di syft resta utile come controllo incrociato, soprattutto per i binari riconosciuti dal catalogatore binario.
