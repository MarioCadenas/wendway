import fs from "node:fs";
import { git, gitTry } from "./git-exec.js";
import { machineLabel } from "../config.js";
import { link } from "./link.js";
import { loadManifest, manifestPath } from "./manifest.js";

// Adopt new matching children and refresh their symlinks. Returns false when a
// content clash must stop the sync. `pushNote` is the failure line for this point
// in the run (nothing has been pushed yet either way).
function refreshShared(log: (msg: string) => void, pushNote: string): boolean {
  // A repo that has no manifest yet has nothing to adopt; sync still commits.
  if (!fs.existsSync(manifestPath())) return true;
  const shared = loadManifest().filter((e) => e.mode === "children");
  if (!shared.length) return true;
  const linked = link({
    dryRun: false,
    only: shared.map((e) => e.name),
    quiet: true,
  });
  if (linked.conflicts > 0) {
    log(pushNote);
    return false;
  }
  return true;
}

function commitIfDirty(log: (msg: string) => void, branch: string): boolean {
  if (!git(["status", "--porcelain"], { quiet: true })) return false;
  git(["add", "-A"], { quiet: true });
  const label = machineLabel();
  const stamp = new Date().toISOString();
  const from = label ? ` from ${label}` : "";
  git(["commit", "-m", `chore(sync): dotfiles${from} ${stamp}`], { quiet: true });
  log(`Committed local changes on ${branch}.`);
  return true;
}

// Commit, rebase onto remote, and push. Safe to run unattended: never force-pushes,
// and on a rebase conflict it aborts and reports rather than auto-resolving.
// Children entries are adopted and their symlinks refreshed first, so a skill added
// in any live directory is stored before the commit. After the pull, symlinks are
// refreshed again so a skill that just arrived is linked before the push.
// A content clash stops the sync and does not push.
export function sync({ quiet = false }: { quiet?: boolean } = {}): boolean {
  const log = (msg: string) => {
    if (!quiet) console.log(msg);
  };

  if (!refreshShared(log, "✗ Content clash — sync stopped, nothing was committed or pushed.")) {
    return false;
  }

  const branch = git(["branch", "--show-current"], { quiet: true });

  // 1. Commit anything local. Check first so a clean tree (the common case on the
  //    15-min timer) skips the `git add` entirely.
  if (!commitIfDirty(log, branch)) {
    log("No local changes to commit.");
  }

  // No remote configured yet → nothing more to do (local-only repo).
  const hasRemote = gitTry(["remote", "get-url", "origin"]).code === 0;
  if (!hasRemote) {
    log("No 'origin' remote configured — committed locally only.");
    return true;
  }

  // 2. Fetch. If the remote branch doesn't exist yet, do the initial push.
  const fetch = gitTry(["fetch", "origin", branch]);
  if (fetch.code !== 0) {
    // Distinguish "branch not on remote yet" from a real network failure.
    const remoteHasBranch = gitTry(["ls-remote", "--exit-code", "origin", branch]).code === 0;
    if (!remoteHasBranch) {
      const push = gitTry(["push", "-u", "origin", branch]);
      if (push.code !== 0) {
        log(`⚠️  initial push failed:\n${push.stderr}`);
        return false;
      }
      log("✅ Pushed initial branch to origin.");
      return true;
    }
    log(`⚠️  fetch failed (offline?). Local commit is safe; will push next run.\n${fetch.stderr}`);
    return false;
  }

  // 3. Rebase onto remote (linear history, no merge commits).
  const rebase = gitTry(["rebase", `origin/${branch}`]);
  if (rebase.code !== 0) {
    gitTry(["rebase", "--abort"]);
    log(
      "✗ Rebase conflict with remote — aborted, tree restored.\n" +
        "   Run `npm start sync` interactively and resolve, or inspect with `git status`."
    );
    return false;
  }

  // 4. Link skills that arrived with the pull, then push. A clash here must not push.
  if (!refreshShared(log, "✗ Content clash — sync stopped, nothing was pushed.")) {
    return false;
  }
  commitIfDirty(log, branch);

  const push = gitTry(["push", "origin", branch]);
  if (push.code !== 0) {
    log(`⚠️  push failed:\n${push.stderr}`);
    return false;
  }

  log("✅ Synced.");
  return true;
}
