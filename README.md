# wendway

CLI to set up a Mac and keep shared config files in sync across machines.

There are two kinds of config:

- **Machine-specific** (ssh config, git identity) — generated once per machine, never synced.
- **Shared dotfiles** (nvim, zed, zellij, herdr, hammerspoon, claude, …) — symlinked
  into a separate **dotfiles repo** and kept in sync automatically.

The tool (this repo) is the engine. Your configs live in a separate repo (default
`~/.dotfiles`) described by a `manifest.json`. The CLI reads that manifest — it has no
hard-coded knowledge of your configs.

## New machine

`wendway` is the engine; your actual configs live in a separate **dotfiles repo** that
you own (a `manifest.json` describes them — see below). On a fresh Mac:

```sh
npm install -g wendway
git clone git@github.com:<your-username>/dotfiles.git ~/.dotfiles
wendway bootstrap            # generates git identity, creates workspace dirs, links configs, seeds zsh, installs autosync
wendway machine <name>       # label this machine for sync commit messages
```

**No dotfiles repo yet?** Run `wendway init` first — it creates `~/.dotfiles` with a
starter `manifest.json` to edit; then `wendway link` moves your configs in.

`bootstrap` on a machine that already has the configs in `~/.dotfiles` just **creates
the symlinks** to them (nothing is moved). From then on, autosync keeps every machine
in sync: edits on one are committed + pushed within ~15 min, and each machine's agent
pulls (`git pull --rebase`) before pushing, so changes flow both ways.

For a one-command fresh-Mac install (Homebrew, `gh`, clone your dotfiles, run
`wendway bootstrap`), `bootstrap.sh` in this repo is a secret-free template you can adapt
and serve via `curl … | sh`.

## Install

```sh
npm install -g wendway
```

To hack on wendway itself, run from source instead:

```sh
git clone https://github.com/MarioCadenas/wendway.git   # or your fork
cd wendway && npm install && npm link
```

`npm link` runs the build automatically (via `prepare`). During development you can
skip the build and run from source with `npm start -- <command>`.

## Commands

Once installed, invoke the binary directly:

```sh
wendway                     # show the command list (same as --help)
wendway init                # create the dotfiles repo + a starter manifest.json (first run)
wendway bootstrap           # full new-machine setup (see above)
wendway link                # symlink shared dotfiles into the dotfiles repo
wendway link nvim           # link only the named entries
wendway link --dry-run      # preview link actions without touching anything
wendway sync                # commit + pull --rebase + push shared dotfiles
wendway status              # show link state and how far ahead/behind the remote you are
wendway autosync install    # install the launchd agent (auto sync every 15 min + on wake)
wendway autosync uninstall  # remove it
wendway machine my-laptop   # set this machine's label (shown in sync commit messages)
wendway --help              # full command list
```

Running from source instead of the installed binary? Use `npm start -- <command>`, e.g.
`npm start -- link nvim --dry-run` (the `--` is required so npm forwards the flags).

Sync commits are labelled `chore(sync): dotfiles from <machine> <timestamp>`. The machine
name comes from `wendway machine <name>` (or the bootstrap prompt), not the hostname —
managed Macs report their serial number as the hostname.

## The dotfiles repo

- Location: `~/.dotfiles` by default. Override with the `WENDWAY_DOTFILES` env var or
  `~/.config/wendway/config.json` (`{ "dotfilesRepo": "..." }`).
- Env: set `WENDWAY_SKIP_LAUNCHCTL=1` to write/remove the autosync plist without calling
  `launchctl` — for sandboxed test runs (drive it against a throwaway `HOME`) and hosts
  without launchd (CI, containers).
- `manifest.json` describes each shared config. Three modes:
  - `dir` — the whole directory is symlinked (use for dirs that are all config).
  - `files` — only listed files/subdirs are symlinked (use when the dir also holds
    runtime state like logs, sessions, or local databases).
  - `children` — one stored tree of selected child directories, each symlinked into
    every path in `targets`. Use this when the same set of folders (for example a
    skill directory) lives in several places and has to stay one copy. The program
    does not know those paths; they belong in the manifest.
- `link` moves each live config into the repo (backing it up as `<name>.bak` first),
  then symlinks the original path to it. Re-running is safe; on another machine it just
  creates the symlink to the already-cloned files.

### Sharing one tree across several directories

A `children` entry stores each selected child at `<repo>/<name>/<child>` and symlinks
that path from every directory in `targets`:

```json
{
  "name": "skills",
  "mode": "children",
  "targets": ["~/.config/agent-a/skills", "~/.config/agent-b/skills"],
  "children": "every",
  "skip": ["synced"]
}
```

- `children` chooses what to share. `"every"` (or omitting the field) shares every child.
  A glob such as `"team-*"` shares one family of names (`*` is any run of characters, `?` is one).
- `skip` is a list of child names to leave untouched — a directory that happens to
  live beside the skills but is not one of them.
- A symlink that points outside every directory in `targets` stays where it is and is
  not copied into the repo. A symlink whose target is the same child in another
  target is that one skill, not a second copy.
- When the same child is a real directory in more than one target, the stored tree is
  the union of the files (a file that exists in only one copy is kept). If the same
  relative path has different contents, `link` does not choose a winner: it leaves
  those copies in place and reports the paths.
- Running `link` again leaves a symlink that already points at the stored tree alone.
  A real directory is backed up to `<path>.bak` and replaced with a symlink. Those
  `.bak` directories are not themselves shared.

## How sync works

`sync` commits everything in the dotfiles repo, rebases onto the remote, and pushes. It
never force-pushes and never auto-resolves conflicts — on a conflict it aborts the rebase,
restores the tree, and asks you to run `sync` interactively. The launchd agent runs `sync`
on an interval (and once on wake), so edits made on one machine reach the others.

Before that commit, `sync` adopts new matching children from any target of a `children`
entry and refreshes the symlinks in all of them. A skill added in one directory is stored
and linked into the others on that machine, then committed and pushed. After the pull,
`sync` refreshes those symlinks again, so a skill that just arrived is linked here before
the push. If two live copies disagree, sync stops and does not push.

## Releasing

Releases are automatic. Every push to `master` runs `.github/workflows/publish.yml`,
which invokes `release-it`: it picks the version from the conventional commits since
the last tag, writes `CHANGELOG.md`, commits/tags, creates the GitHub Release, and
publishes to npm via OIDC trusted publishing (no tokens) with provenance.

Only `feat` / `fix` / `perf` / `revert` / breaking-change commits cut a release —
`feat` bumps the minor, `fix`/`perf`/`revert` the patch, a `BREAKING CHANGE` the major.
Merges that are only `docs` / `chore` / `refactor` / `style` / `test` / `build` / `ci`
publish nothing.

One-time setup (already done): on npmjs.com, add a **Trusted Publisher** for this
package — GitHub Actions, repo `MarioCadenas/wendway`, workflow `publish.yml`.

## What is NOT synced

Credentials and machine-specific state should be left out of the manifest: ssh keys,
git identity, `~/.config/gh`, `~/.config/op`, `~/.aws`
(its config is entirely an access token), and various caches / logs /
sockets. A fresh repo is seeded with an empty manifest — you decide what goes in it.
