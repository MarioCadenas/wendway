#!/bin/sh
# Public, secret-free entry point for a fresh Mac. Point it at your own dotfiles
# repo (owner/repo form) and run with:
#   curl -fsSL https://raw.githubusercontent.com/MarioCadenas/wendway/master/bootstrap.sh | WENDWAY_DOTFILES_REPO=you/dotfiles sh
#
# It installs the prerequisites needed to reach that (typically private) dotfiles
# repo (Homebrew + gh), authenticates you with GitHub, clones the repo, and hands
# off to its provisioning script. Nothing here is secret — the personal config
# lives behind the GitHub auth this script sets up.

set -e

# The dotfiles repo to clone, in owner/repo form. Set via env, or you'll be
# prompted. WENDWAY_DOTFILES_DIR overrides the clone destination.
DOTFILES_REPO="${WENDWAY_DOTFILES_REPO:-}"
DOTFILES_DIR="${WENDWAY_DOTFILES_DIR:-$HOME/.dotfiles}"

echo "▶ Fresh Mac bootstrap"

if [ -z "$DOTFILES_REPO" ]; then
  printf "▶ Your dotfiles repo (owner/repo): " > /dev/tty
  read -r DOTFILES_REPO < /dev/tty
fi
if [ -z "$DOTFILES_REPO" ]; then
  echo "✗ No dotfiles repo provided (set WENDWAY_DOTFILES_REPO or answer the prompt)." >&2
  exit 1
fi

# 1. Homebrew (also provides git on a machine that only has the Xcode stub).
if ! command -v brew >/dev/null 2>&1; then
  echo "▶ Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# 2. gh, to authenticate the clone of the private repo.
if ! command -v gh >/dev/null 2>&1; then
  echo "▶ Installing gh..."
  brew install gh
fi

# 3. GitHub auth (skipped if already logged in). This is the one interactive step —
#    it's your identity and can't be automated away.
if ! gh auth status >/dev/null 2>&1; then
  echo "▶ Log in to GitHub (needed to clone your private dotfiles):"
  gh auth login
fi

# 4. Clone the private dotfiles repo.
if [ ! -d "$DOTFILES_DIR" ]; then
  echo "▶ Cloning dotfiles into $DOTFILES_DIR..."
  gh repo clone "$DOTFILES_REPO" "$DOTFILES_DIR" 2>/dev/null \
    || git clone "git@github.com:${DOTFILES_REPO}.git" "$DOTFILES_DIR"
fi

# 5. Hand off to the private provisioning script.
echo "▶ Running provisioning..."
sh "$DOTFILES_DIR/provision/fresh-install.sh"

echo "✅ Bootstrap complete."
