#!/bin/sh
# Install SPOTOEI from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/amaruki/spotoei/main/scripts/install.sh | sh
#
# Options (environment variables):
#   SPOTOEI_VERSION        Install a specific version instead of the latest (e.g. 0.0.0)
#   SPOTOEI_PREFIX         Install prefix (default: $HOME/.local)
#   SPOTOEI_DOWNLOAD_BASE  Override the release download base URL (testing/mirrors)
set -eu

REPO="amaruki/spotoei"
VERSION="${SPOTOEI_VERSION:-latest}"
PREFIX="${SPOTOEI_PREFIX:-$HOME/.local}"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) platform=linux ;;
  Darwin) platform=macos ;;
  *) die "unsupported OS: $(uname -s). See docs/INSTALL.md for manual install." ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported architecture: $(uname -m). See docs/INSTALL.md for manual install." ;;
esac

if [ "$VERSION" = "latest" ]; then
  VERSION=$(
    curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
      sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1
  )
  [ -n "$VERSION" ] || die "could not resolve the latest release; set SPOTOEI_VERSION"
fi

archive="spotoei-v${VERSION}-${platform}-${arch}.tar.gz"
base="${SPOTOEI_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download/v$VERSION}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading %s...\n' "$archive"
curl -fsSL "$base/$archive" -o "$tmp/$archive"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp" && sha256sum -c SHA256SUMS)
else
  (cd "$tmp" && shasum -a 256 -c SHA256SUMS)
fi

libexec="$PREFIX/libexec/spotoei"
mkdir -p "$libexec" "$PREFIX/bin"
tar -xzf "$tmp/$archive" -C "$libexec"
ln -sf "$libexec/spotoei" "$PREFIX/bin/spotoei"

on_path=false
case ":$PATH:" in
  *":$PREFIX/bin:"*) on_path=true ;;
esac

# On the default prefix, persist PATH so a fresh shell finds `spotoei`.
if [ "$on_path" = false ] && [ "$PREFIX" = "$HOME/.local" ]; then
  path_line='export PATH="$HOME/.local/bin:$PATH"'
  case "${SHELL:-}" in
    */zsh) rc="$HOME/.zshrc" ;;
    */bash) rc="$HOME/.bashrc" ;;
    *) rc="" ;;
  esac
  if [ -n "$rc" ]; then
    touch "$rc"
    if ! grep -qF "$path_line" "$rc"; then
      printf '\n# Added by the SPOTOEI installer\n%s\n' "$path_line" >> "$rc"
      printf 'Added %s to PATH in %s\n' "$PREFIX/bin" "$rc"
    fi
  fi
fi

printf '\nInstalled spotoei v%s to %s\n' "$VERSION" "$libexec"
if [ "$on_path" = false ]; then
  printf '\nFor this terminal, run:\n\n  export PATH="%s:$PATH"\n' "$PREFIX/bin"
fi
printf '\nThen start it with:\n\n  spotoei\n'
