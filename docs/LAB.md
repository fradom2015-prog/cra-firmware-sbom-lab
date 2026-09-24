# Guida al laboratorio, passo per passo

Obiettivo: riprodurre l'analisi sul firmware di esempio, poi ripeterla su un'immagine OpenWrt ufficiale
e scrivere tu alcune decisioni VEX. Tempo stimato: 2–3 ore.

Ambiente: Kali Linux (anche la VM in UTM sul Mac va bene) con accesso a Internet.

---

## 1. Pubblica il repository su GitHub (dal Mac)

Il repository è già nella cartella `Desktop/EPICODE/cra-firmware-sbom-lab`.

1. Su github.com crea un repository **vuoto** chiamato `cra-firmware-sbom-lab` (senza README né licenza).
2. Dal Terminale del Mac:

```bash
cd ~/Desktop/EPICODE/cra-firmware-sbom-lab
git init -b main
git add .
git commit -m "Laboratorio SBOM, VEX e controlli CRA su firmware OpenWrt"
git remote add origin https://github.com/fradom2015-prog/cra-firmware-sbom-lab.git
git push -u origin main
```

3. Nella scheda **Actions** del repository parte il workflow `firmware-security`. Il primo job (test)
   deve passare; il secondo (analisi del firmware) termina con il gate **bloccato** a causa di SambaCry.
   È il comportamento voluto: apri il run e guarda il riepilogo e gli artefatti.
4. In **Settings → Code security** attiva *Private vulnerability reporting*: serve al link di `SECURITY.md`.

## 2. Prepara Kali

```bash
sudo apt update && sudo apt install -y git python3-venv squashfs-tools binwalk curl
git clone https://github.com/fradom2015-prog/cra-firmware-sbom-lab.git
cd cra-firmware-sbom-lab
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt pytest "cyclonedx-python-lib[json-validation]"
pytest -q                     # devono passare tutti

# syft e grype (Anchore)
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sudo sh -s -- -b /usr/local/bin
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sudo sh -s -- -b /usr/local/bin
```

## 3. Riproduci l'analisi di esempio

```bash
curl -sSfL -o rt-ac58u.bin \
  https://github.com/SuLingGG/OpenWrt-Rpi/releases/download/ipq40xx-generic/immortalwrt-ipq40xx-generic-asus_rt-ac58u-squashfs-sysupgrade.bin
echo "d9cd6f6c11ea7125aa17c420087a16b8ca1923bca079660dbce390d1167d4b6d  rt-ac58u.bin" | sha256sum -c -

FW_NAME="ImmortalWrt per ASUS RT-AC58U" bash scripts/run_lab.sh rt-ac58u.bin out
```

La prima esecuzione scarica circa 100 MB di feed NVD in `.cache/nvd`. Su Kali, a differenza dell'ambiente
in cui ho generato gli esempi, l'API EPSS di FIRST è raggiungibile: nel report comparirà la colonna EPSS
valorizzata e alcune priorità potrebbero cambiare. **Confronta il tuo `out/report.md` con quello in
`examples/`**: capire perché cambia qualcosa è parte dell'esercizio.

Cosa guardare, in ordine:

1. `out/confronto-syft.md`: perché la SBOM di syft non basta su OpenWrt.
2. `out/sbom.cdx.json`: cerca `openssh-sftp-server` e osserva `cpe`, `purl` e le proprietà `openwrt:*` e `fwsec:cpeAlias`.
3. `out/report.md`: sintesi, KEV, piano per componente.
4. `out/checks.md`: i controlli di configurazione.
5. `out/vex.cdx.json`: cerca `CVE-2024-6387` e leggi il blocco `analysis`.

## 4. Esercizio: scrivi tu tre decisioni VEX

Nel report ci sono ancora molte CVE `in_triage`. Scegline tre e decidi lo stato, verificando sul rootfs
estratto (`out/extract/rootfs/...`). Tre spunti su cui ragionare:

- **CVE-2026-35385** (OpenSSH, `scp`). Quale programma è `/usr/bin/scp` in questo firmware?
  Suggerimento: `find out/extract -path '*usr/bin/scp' -exec ls -la {} \;`.
- **CVE-2025-26465** (client OpenSSH con `VerifyHostKeyDNS`). Il client `ssh` di OpenSSH è installato?
- **CVE-2022-48174** (BusyBox, shell `ash`). Qui la risposta è diversa: la shell c'è ed è usata.
  Che stato scegli, e quale mitigazione scriveresti nel campo `detail`?

Aggiungi le decisioni in `vex/decisions.toml` con lo stesso formato delle altre, rilancia
`scripts/run_lab.sh` e verifica che il report le conteggi tra le "chiuse con VEX" (o tra le confermate).
Poi `pytest -q`: il test `test_every_closed_finding_is_justified` controlla che ogni chiusura sia motivata.

## 5. Ripeti su un firmware OpenWrt ufficiale

1. Apri https://downloads.openwrt.org/releases/ e scegli l'ultima versione stabile.
2. Scarica il rootfs x86-64, per esempio:

```bash
V=24.10.2   # sostituisci con la versione stabile corrente
curl -sSfLO https://downloads.openwrt.org/releases/$V/targets/x86/64/openwrt-$V-x86-64-rootfs.tar.gz
curl -sSfL https://downloads.openwrt.org/releases/$V/targets/x86/64/sha256sums | grep rootfs.tar.gz
sha256sum openwrt-$V-x86-64-rootfs.tar.gz

mkdir -p rootfs-openwrt && tar xzf openwrt-$V-x86-64-rootfs.tar.gz -C rootfs-openwrt
FW_NAME="OpenWrt $V x86-64" bash scripts/run_lab.sh rootfs-openwrt out-openwrt
```

3. Confronta i due `checks.md`. Nella build ufficiale ti aspetti la firma dei pacchetti attiva e nessuna
   chiave OpenVPN incorporata. La password di root vuota al primo avvio invece c'è anche in OpenWrt
   ufficiale: come la giustificheresti o la correggeresti in un prodotto commerciale?
4. Per le versioni recenti di OpenWrt che usano `apk` invece di `opkg`, `fw_sbom.py` legge
   `lib/apk/db/installed`. Verifica quanti componenti hanno un CPE: se il database apk non riporta il
   `CPE-ID` dei pacchetti, la copertura crolla. In quel caso il passo successivo è ricavare i CPE dalle
   ricette di build (i Makefile dei pacchetti OpenWrt dichiarano `PKG_CPE_ID`).

Per un router reale invece del target x86 usa un file `*-squashfs-sysupgrade.bin` dalla cartella del
target corrispondente: `run_lab.sh` lo estrae da solo.

## 6. Facoltativo: Dependency-Track

Per vedere come si gestiscono le SBOM di molte release nel tempo:

```bash
curl -LO https://dependencytrack.org/docker-compose.yml
docker compose up -d
# interfaccia su http://localhost:8080, primo accesso admin/admin (ti chiede di cambiarla)
```

Crea un progetto, carica `out/sbom.cdx.json` e confronta le vulnerabilità trovate con il tuo report.

## 7. Come raccontarlo in un colloquio

In tre frasi:

1. «Ho costruito una pipeline che da un'immagine firmware produce SBOM CycloneDX, confronto con NVD,
   priorità con KEV ed EPSS e un documento VEX, più controlli di configurazione mappati sull'Allegato I
   del CRA. Gira in CI a ogni push e ogni settimana.»
2. «Sul firmware di prova ho scoperto che la SBOM generata da syft non trovava la versione corretta di
   nessun pacchetto OpenWrt, perché leggeva il database come se fosse Debian. Usando i metadati di
   OpenWrt e correggendo 8 CPE sbagliati sono passato da 0 a 118 componenti confrontabili.»
3. «Ho chiuso 17 finding con un VEX motivato, per esempio regreSSHion non si applica perché nel
   firmware sshd non c'è, e ho confermato SambaCry, che è nel catalogo KEV: il gate della pipeline blocca
   il rilascio finché non si corregge.»
