#!/usr/bin/env bash
#
# Installs subtitle-safe, free-for-commercial-use fonts plus legacy neon set.
# Mirrors samsar_processor/install_fonts.sh so rendered subtitles (incl. Thai) work in this container.

set -euo pipefail

FONTS=(
  # Core stacks
  "Montserrat|https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf"
  "Inter|https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
  "Poppins|https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf"
  "NotoSans|https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf"
  # DejaVu Sans intentionally omitted (unreliable upstream URL)

  # CJK + Thai
  "NotoSansJP|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
  "NotoSansKR|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf"
  "NotoSansSC|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
  "NotoSansTC|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
  "NotoSansThai|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansthai/NotoSansThai%5Bwdth,wght%5D.ttf"
  "MPLUSRounded1c|https://raw.githubusercontent.com/google/fonts/main/ofl/mplusrounded1c/MPLUSRounded1c-Regular.ttf"
  "Sarabun|https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Regular.ttf"

  # Arabic / Hebrew / Devanagari
  "NotoSansArabic|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf"
  "NotoSansHebrew|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf"
  "NotoSansDevanagari|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf"
  "NotoSerifDevanagari|https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifdevanagari/NotoSerifDevanagari%5Bwdth,wght%5D.ttf"
  "Cairo|https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt,wght%5D.ttf"
  "Hind|https://raw.githubusercontent.com/google/fonts/main/ofl/hind/Hind-Regular.ttf"
  "Mukta|https://raw.githubusercontent.com/google/fonts/main/ofl/mukta/Mukta-Regular.ttf"

  # Bengali
  "NotoSansBengali|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansbengali/NotoSansBengali%5Bwdth,wght%5D.ttf"
  "NotoSerifBengali|https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifbengali/NotoSerifBengali%5Bwdth,wght%5D.ttf"
  "HindSiliguri|https://raw.githubusercontent.com/google/fonts/main/ofl/hindsiliguri/HindSiliguri-Regular.ttf"

  # Neon/display set
  "Neonderthaw|https://raw.githubusercontent.com/google/fonts/main/ofl/neonderthaw/Neonderthaw-Regular.ttf"
  "Monoton|https://raw.githubusercontent.com/google/fonts/main/ofl/monoton/Monoton-Regular.ttf"
  "BungeeOutline|https://raw.githubusercontent.com/google/fonts/main/ofl/bungeeoutline/BungeeOutline-Regular.ttf"
  "Orbitron|https://raw.githubusercontent.com/google/fonts/main/ofl/orbitron/Orbitron%5Bwght%5D.ttf"
  "RampartOne|https://raw.githubusercontent.com/google/fonts/main/ofl/rampartone/RampartOne-Regular.ttf"
)

OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
  Linux*) FONT_DIR="/usr/local/share/fonts" ;;
  Darwin*) FONT_DIR="/Library/Fonts" ;;
  *) echo "Unsupported OS: $OS_TYPE"; exit 1 ;;
esac
FONT_DIR="${SUBTITLE_FONT_DIR:-$FONT_DIR}"

if ! command -v fc-scan >/dev/null 2>&1; then
  echo "fontconfig (fc-scan) is required to validate downloaded fonts." >&2
  exit 1
fi

INSTALL_CMD="cp"
POST_INSTALL_CMD="fc-cache -f -v"

if [[ "$(id -u)" -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
  INSTALL_CMD="sudo cp"
  POST_INSTALL_CMD="sudo ${POST_INSTALL_CMD}"
fi

echo "Detected OS: $OS_TYPE"
echo "Installing fonts to: $FONT_DIR"
mkdir -p "$FONT_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
echo "Using temporary directory: $TMP_DIR"

pushd "$TMP_DIR" >/dev/null

for entry in "${FONTS[@]}"; do
  FONT_NAME="${entry%%|*}"
  FONT_URL="${entry#*|}"

  echo ""
  echo "---------------------------------------"
  echo "Downloading $FONT_NAME from:"
  echo "$FONT_URL"

  # Stable filenames match the runtime font registry. HTTP errors must fail
  # the image build instead of installing an error page with a .ttf suffix.
  TTF_FILE="${FONT_NAME}.ttf"
  curl --fail --location --retry 3 --retry-delay 1 \
    --connect-timeout 20 --max-time 180 --output "$TTF_FILE" "$FONT_URL"

  FONT_FAMILY="$(fc-scan --format '%{family}' "$TTF_FILE")"
  if [[ -z "$FONT_FAMILY" ]]; then
    echo "Downloaded file for $FONT_NAME is not a readable font." >&2
    exit 1
  fi

  echo "Installing $FONT_NAME..."
  $INSTALL_CMD "$TTF_FILE" "$FONT_DIR/"

  echo "$FONT_NAME installed."
done

popd >/dev/null

if [[ -n "$POST_INSTALL_CMD" ]]; then
  echo ""
  echo "---------------------------------------"
  echo "Updating font cache..."
  eval "$POST_INSTALL_CMD"
fi

echo ""
echo "---------------------------------------"
echo "Installation complete! The fonts should now be available system-wide."
echo "---------------------------------------"
