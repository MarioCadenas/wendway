import { buildPlan, entryLabel, PlanAction } from "./link.js";
import { git, gitTry } from "./git-exec.js";

// Report link state per manifest entry plus repo sync position.
export function status() {
  const items = buildPlan();

  console.log("Dotfile link status:\n");
  const state: Record<PlanAction["kind"], string> = {
    "already-linked": "linked",
    "adopt-from-repo": "in repo, not linked here",
    migrate: "live only (not yet in repo)",
    "overwrite-with-repo": "exists both live and in repo",
    union: "live copy to fold into the stored tree",
    retarget: "symlink to retarget at the stored tree",
    outside: "external symlink (left in place)",
    skip: "missing",
    conflict: "CONFLICT",
  };
  for (const it of items) {
    const name = entryLabel(it.entry.name, it.rel);
    const where = it.entry.mode === "children" ? `  ${it.action.from}` : "";
    console.log(`  ${name.padEnd(28)} ${state[it.action.kind]}${where}`);
  }

  console.log("\nRepo sync:\n");
  const branch = git(["branch", "--show-current"], { quiet: true });
  const dirty = git(["status", "--porcelain"], { quiet: true });
  console.log(`  branch: ${branch}`);
  console.log(`  uncommitted config changes: ${dirty ? "yes" : "no"}`);

  const fetch = gitTry(["fetch", "origin", branch]);
  if (fetch.code !== 0) {
    console.log("  remote: unreachable (offline?)");
    return;
  }
  const counts = gitTry(["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`]);
  if (counts.code === 0) {
    const [behind, ahead] = counts.stdout.split(/\s+/);
    console.log(`  behind remote: ${behind}, ahead: ${ahead}`);
  }
}
