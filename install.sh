#!/bin/sh
# OpenRoll installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/noah-thing/openroll/main/install.sh | sh
#
# Options (environment variables):
#   OPENROLL_VERSION   install a specific release, e.g. v0.1.0 or 0.1.0 (default: latest)
#   OPENROLL_DIR       where the macOS app goes (default: /Applications, or ~/Applications)

set -eu

REPO="noah-thing/openroll"

say() { printf '%s\n' "$*"; }
step() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
# Nothing here may fall back to plain http, not even through a redirect.
get() { curl --proto '=https' --proto-redir '=https' --tlsv1.2 "$@"; }

command -v curl >/dev/null 2>&1 || fail "curl is required"

case "$(uname -s)" in
	Darwin) OS=mac ;;
	Linux) OS=linux ;;
	*) fail "this script is for macOS and Linux; on Windows run install.ps1" ;;
esac

case "$(uname -m)" in
	arm64 | aarch64) ARCH=arm64 ;;
	x86_64 | amd64) ARCH=x64 ;;
	*) fail "unsupported processor: $(uname -m)" ;;
esac
[ "$OS" = linux ] && [ "$ARCH" = arm64 ] && fail "there is no Linux build for ARM processors yet"

if [ -n "${OPENROLL_VERSION:-}" ]; then
	API="https://api.github.com/repos/$REPO/releases/tags/v${OPENROLL_VERSION#v}"
else
	API="https://api.github.com/repos/$REPO/releases/latest"
fi

step "Finding the latest OpenRoll release"
RELEASE=$(get -fsSL -H "Accept: application/vnd.github+json" "$API") || fail "could not read the release from GitHub (no internet, no release with that version, or GitHub is rate limiting you; try again in a few minutes)"
TAG=$(printf '%s' "$RELEASE" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

# The download URL of the first asset whose name ends in $1. Only this repository's own release files count.
asset() {
	printf '%s' "$RELEASE" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"$/\1/' | grep -F "https://github.com/$REPO/releases/download/" | grep -- "$1\$" | head -1
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

sha_of() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Every release lists the sha256 of each file in SHA256SUMS.txt, the same list the in app updater trusts.
SUMS_URL=$(asset "/SHA256SUMS.txt")
[ -n "$SUMS_URL" ] || fail "this release has no SHA256SUMS.txt, so its files cannot be checked"
get -fsSL -o "$TMP/SHA256SUMS.txt" "$SUMS_URL" || fail "could not download SHA256SUMS.txt"

download() {
	NAME=$(basename "$1")
	say "Downloading $NAME"
	get -fL --progress-bar -o "$TMP/$2" "$1" || fail "download failed"
	WANT=$(grep -- " \*\{0,1\}$NAME\$" "$TMP/SHA256SUMS.txt" | cut -d' ' -f1 | tr 'A-F' 'a-f')
	[ -n "$WANT" ] || fail "$NAME is not listed in SHA256SUMS.txt"
	[ "$(sha_of "$TMP/$2" | tr 'A-F' 'a-f')" = "$WANT" ] || fail "$NAME does not match its checksum; nothing was installed"
}

if [ "$OS" = mac ]; then
	URL=$(asset "-mac-$ARCH.zip")
	[ -n "$URL" ] || fail "this release has no build for macOS ($ARCH)"
	download "$URL" OpenRoll.zip

	step "Installing"
	DEST="${OPENROLL_DIR:-/Applications}"
	if [ ! -w "$DEST" ] && [ -z "${OPENROLL_DIR:-}" ]; then DEST="$HOME/Applications"; fi
	mkdir -p "$DEST"
	ditto -x -k "$TMP/OpenRoll.zip" "$TMP/app" || fail "could not unpack the download"
	[ -d "$TMP/app/OpenRoll.app" ] || fail "the download has no OpenRoll.app"
	# copy first, swap after: a failed copy leaves the app that is already installed untouched
	rm -rf "$DEST/OpenRoll.app.new"
	ditto "$TMP/app/OpenRoll.app" "$DEST/OpenRoll.app.new" || { rm -rf "$DEST/OpenRoll.app.new"; fail "could not copy the app to $DEST"; }
	rm -rf "$DEST/OpenRoll.app"
	mv "$DEST/OpenRoll.app.new" "$DEST/OpenRoll.app" || fail "could not move the app into place"

	say ""
	say "OpenRoll $TAG is installed in $DEST."
	say "Open it from Launchpad or run: open -a OpenRoll"
	exit 0
fi

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"
if [ -n "$SUDO" ] && ! command -v sudo >/dev/null 2>&1; then SUDO=""; fi

if command -v apt-get >/dev/null 2>&1 && URL=$(asset "-linux-amd64.deb") && [ -n "$URL" ]; then
	download "$URL" openroll.deb
	step "Installing with apt (you may be asked for your password)"
	# curl | sh feeds this script through stdin, so apt gets /dev/null and cannot swallow the rest of it
	$SUDO apt-get install -y "$TMP/openroll.deb" </dev/null
	say ""
	say "OpenRoll $TAG is installed. Start it from the applications menu, or run: openroll"
	exit 0
fi

URL=$(asset "-linux-x86_64.AppImage")
[ -n "$URL" ] || fail "this release has no build for Linux"
download "$URL" OpenRoll.AppImage
step "Installing to ~/Applications"
mkdir -p "$HOME/Applications" "$HOME/.local/bin"
install -m 755 "$TMP/OpenRoll.AppImage" "$HOME/Applications/OpenRoll.AppImage"
ln -sf "$HOME/Applications/OpenRoll.AppImage" "$HOME/.local/bin/openroll"

say ""
say "OpenRoll $TAG is installed. Run: openroll"
say "If it does not start, install FUSE 2 (on Ubuntu: sudo apt install libfuse2t64)."
