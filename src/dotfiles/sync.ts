import { git, gitTry } from "./git-exec.js";
import { machineLabel } from "../config.js";

// Commit, rebase onto remote, and push. Safe to run unattended: never force-pushes,
// and on a rebase conflict it aborts and reports rather than auto-resolving.
export function sync({ quiet = false }: { quiet?: boolean } = {}): boolean {
  const log = (msg: string) => {
    if (!quiet) console.log(msg);
  };

  const branch = git(["branch", "--show-current"], { quiet: true });

  // 1. Commit anything local. Check first so a clean tree (the common case on the
  //    15-min timer) skips the `git add` entirely.
  if (git(["status", "--porcelain"], { quiet: true })) {
    git(["add", "-A"], { quiet: true });
    const label = machineLabel();
    const stamp = new Date().toISOString();
    const from = label ? ` from ${label}` : "";
    git(["commit", "-m", `chore(sync): dotfiles${from} ${stamp}`], { quiet: true });
    log(`Committed local changes on ${branch}.`);
  } else {
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

  // 4. Push.
  const push = gitTry(["push", "origin", branch]);
  if (push.code !== 0) {
    log(`⚠️  push failed:\n${push.stderr}`);
    return false;
  }

  log("✅ Synced.");
  return true;
}
