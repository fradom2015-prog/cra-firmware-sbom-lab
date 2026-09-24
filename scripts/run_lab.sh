#!/usr/bin/env bash
# Esegue l'intera pipeline su un firmware OpenWrt:
#   estrazione -> SBOM -> confronto con syft -> CVE da NVD -> controlli di configurazione -> triage + VEX
#
# Uso:
#   scripts/run_lab.sh FIRMWARE_O_ROOTFS [CARTELLA_OUTPUT]
#
# FIRMWARE può essere:
#   - un sysupgrade .bin (tar con kernel e root squashfs)
#   - un rootfs .tar.gz (per esempio openwrt-*-x86-64-rootfs.tar.gz)
#   - un'immagine squashfs
#   - una cartella con il rootfs già estratto
#
# Variabili d'ambiente:
#   NVD_YEARS   anni dei feed NVD da scaricare (default: 2002..anno corrente)
#   NVD_DIR     cache dei feed (default: .cache/nvd)
#   FW_NAME     nome del firmware nei report
#   FAIL_ON     P1 | P2 | none (default none)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
IN="${1:?Specifica il firmware o la cartella del rootfs}"
OUT="${2:-out}"
NVD_DIR="${NVD_DIR:-.cache/nvd}"
FAIL_ON="${FAIL_ON:-none}"
mkdir -p "$OUT" "$NVD_DIR"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 1. estrazione
IMAGE_ARG=()
if [ -d "$IN" ]; then
  ROOTFS="$IN"
else
  IMAGE_ARG=(--image "$IN")
  WORK="$OUT/extract"
  rm -rf "$WORK" && mkdir -p "$WORK"
  log "Estrazione di $(basename "$IN")"
  sha256sum "$IN" | tee "$OUT/firmware.sha256"
  squash=""
  if tar tf "$IN" >/dev/null 2>&1; then
    tar xf "$IN" -C "$WORK"
    squash="$(find "$WORK" -type f -name root | head -1)"
    [ -z "$squash" ] && ROOTFS="$WORK"
  elif file "$IN" | grep -qi squashfs; then
    squash="$IN"
  else
    command -v binwalk >/dev/null || { echo "Formato non riconosciuto e binwalk non installato."; exit 1; }
    (cd "$WORK" && binwalk -e -q "$(realpath "$IN")")
    ROOTFS="$(find "$WORK" -type d -name squashfs-root | head -1)"
  fi
  if [ -n "$squash" ]; then
    if command -v unsquashfs >/dev/null; then
      # senza root unsquashfs non può creare i device file di /dev ed esce con errore:
      # per l'analisi non servono, quindi si prosegue se il resto è stato estratto
      unsquashfs -q -f -d "$WORK/rootfs" "$squash" >/dev/null 2>"$OUT/unsquashfs.log" \
        || echo "  avviso: alcuni file speciali non estratti (normale senza root), dettagli in $OUT/unsquashfs.log"
    else
      python3 -m pip install -q --user PySquashfsImage >/dev/null
      python3 -m PySquashfsImage extract -d "$WORK/rootfs" "$squash" >/dev/null 2>&1 \
        || "$HOME/.local/bin/pysquashfs" extract -d "$WORK/rootfs" "$squash" >/dev/null
    fi
    ROOTFS="$WORK/rootfs"
    [ -d "$ROOTFS/squashfs-root" ] && ROOTFS="$ROOTFS/squashfs-root"
  fi
fi
[ -e "$ROOTFS/usr/lib/opkg/status" ] || [ -e "$ROOTFS/lib/apk/db/installed" ] \
  || { echo "In $ROOTFS non trovo il database dei pacchetti."; exit 1; }

# ---------------------------------------------------------------- 2. SBOM
log "SBOM CycloneDX dai metadati OpenWrt"
python3 "$HERE/tools/fw_sbom.py" "$ROOTFS" -o "$OUT/sbom.cdx.json" --stats "$OUT/sbom-stats.json" \
  ${FW_NAME:+--name "$FW_NAME"} "${IMAGE_ARG[@]}"

if command -v syft >/dev/null; then
  log "SBOM di confronto con syft"
  syft scan "dir:$ROOTFS" -q -o cyclonedx-json="$OUT/syft.cdx.json"
  python3 "$HERE/tools/compare_syft.py" "$OUT/syft.cdx.json" "$OUT/sbom.cdx.json" -o "$OUT/confronto-syft.md"
fi

# ---------------------------------------------------------------- 3. CVE
log "Feed NVD (fkie-cad/nvd-json-data-feeds)"
TAG="$(curl -sSI https://github.com/fkie-cad/nvd-json-data-feeds/releases/latest | awk -F/ 'tolower($1) ~ /^location/ {print $NF}' | tr -d '\r')"
YEARS="${NVD_YEARS:-$(seq 2002 "$(date +%Y)")}"
for y in $YEARS; do
  f="$NVD_DIR/CVE-$y.json.xz"
  # riscarica i feed più vecchi di un giorno: le CVE vengono aggiornate di continuo
  if [ ! -s "$f" ] || [ -n "$(find "$f" -mtime +0 2>/dev/null)" ]; then
    curl -sSfL -o "$f" "https://github.com/fkie-cad/nvd-json-data-feeds/releases/download/$TAG/CVE-$y.json.xz" \
      || echo "  feed $y non disponibile"
  fi
done
python3 "$HERE/tools/nvd_match.py" "$OUT/sbom.cdx.json" "$NVD_DIR"/CVE-*.json.xz -o "$OUT/matches.json"

GRYPE_ARG=()
if command -v grype >/dev/null; then
  log "Verifica incrociata con grype"
  if grype sbom:"$OUT/sbom.cdx.json" -q -o json > "$OUT/grype.json" 2>/dev/null; then
    GRYPE_ARG=(--grype "$OUT/grype.json")
  fi
fi

# ---------------------------------------------------------------- 4. controlli
log "Controlli di configurazione e hardening"
python3 "$HERE/tools/fw_checks.py" "$ROOTFS" -o "$OUT/checks.json" --md "$OUT/checks.md" ${FW_NAME:+--name "$FW_NAME"}

# ---------------------------------------------------------------- 5. triage
log "Triage con KEV, EPSS e decisioni VEX"
set +e
python3 "$HERE/tools/triage.py" --sbom "$OUT/sbom.cdx.json" --nvd "$OUT/matches.json" "${GRYPE_ARG[@]}" \
  --decisions "$HERE/vex/decisions.toml" --stats "$OUT/sbom-stats.json" \
  --out-dir "$OUT" --cache-dir "$OUT/.cache" --fail-on "$FAIL_ON"
rc=$?
set -e
log "Fatto. Report: $OUT/report.md e $OUT/checks.md"
exit $rc
