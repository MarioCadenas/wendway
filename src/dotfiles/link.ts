import fs from "node:fs";
import path from "node:path";
import { loadManifest, DotfileEntry } from "./manifest.js";
import { dotfilesRepo } from "../config.js";

export type PlanAction =
  | { kind: "already-linked"; from: string; to: string }
  | { kind: "adopt-from-repo"; from: string; to: string } // repo has it, live missing → just symlink
  | { kind: "migrate"; from: string; to: string; backup: string } // move live → repo, then symlink
  | { kind: "overwrite-with-repo"; from: string; to: string; backup: string } // --force: back up live, symlink to repo
  | { kind: "skip"; from: string; reason: string }
  | { kind: "conflict"; from: string; reason: string };

interface PlanItem {
  entry: DotfileEntry;
  // sub-path within the entry ("" for dir mode, the file name for files mode)
  rel: string;
  action: PlanAction;
}

export function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function symlinkResolves(link: string, expected: string): boolean {
  try {
    return path.resolve(path.dirname(link), fs.readlinkSync(link)) === path.resolve(expected);
  } catch {
    return false;
  }
}

// Build the set of (live path, repo path) pairs for an entry.
export function pairsFor(entry: DotfileEntry): { live: string; repo: string; rel: string }[] {
  const repoBase = path.join(dotfilesRepo(), entry.name);
  if (entry.mode === "dir") {
    return [{ live: entry.target, repo: repoBase, rel: "" }];
  }
  return (entry.files ?? []).map((rel) => ({
    live: path.join(entry.target, rel),
    repo: path.join(repoBase, rel),
    rel,
  }));
}

function planItem(
  entry: DotfileEntry,
  live: string,
  repo: string,
  rel: string,
  force: boolean
): PlanItem {
  const repoExists = fs.existsSync(repo);

  if (isSymlink(live)) {
    if (symlinkResolves(live, repo)) {
      return { entry, rel, action: { kind: "already-linked", from: live, to: repo } };
    }
    return {
      entry,
      rel,
      action: { kind: "conflict", from: live, reason: `already a symlink pointing elsewhere` },
    };
  }

  // Past here `live` is not a symlink, so a plain existence check is enough.
  const liveExists = fs.existsSync(live);

  if (!liveExists && repoExists) {
    return { entry, rel, action: { kind: "adopt-from-repo", from: live, to: repo } };
  }

  if (liveExists && repoExists) {
    if (force) {
      return {
        entry,
        rel,
        action: { kind: "overwrite-with-repo", from: live, to: repo, backup: `${live}.bak` },
      };
    }
    return {
      entry,
      rel,
      action: {
        kind: "conflict",
        from: live,
        reason: `exists both live and in repo — re-run with --force to back up the local copy and use the repo version`,
      },
    };
  }

  if (liveExists && !repoExists) {
    return {
      entry,
      rel,
      action: { kind: "migrate", from: live, to: repo, backup: `${live}.bak` },
    };
  }

  return { entry, rel, action: { kind: "skip", from: live, reason: "not found live or in repo" } };
}

// `only` restricts the plan to the named manifest entries (for incremental linking).
// `force` overwrites a live copy that also exists in the repo (backing it up first).
export function buildPlan(only?: string[], force = false): PlanItem[] {
  const items: PlanItem[] = [];
  const wanted = only?.length ? new Set(only) : null;
  for (const entry of loadManifest()) {
    if (wanted && !wanted.has(entry.name)) continue;
    for (const { live, repo, rel } of pairsFor(entry)) {
      items.push(planItem(entry, live, repo, rel, force));
    }
  }
  return items;
}

// Display suffix for an entry's sub-path ("/config.toml" in files mode, "" in dir mode).
export function entryLabel(name: string, rel: string): string {
  return `${name}${rel ? `/${rel}` : ""}`;
}

function printPlan(items: PlanItem[]) {
  const icon: Record<PlanAction["kind"], string> = {
    "already-linked": "✓ ",
    "adopt-from-repo": "→ ",
    migrate: "⇧ ",
    "overwrite-with-repo": "! ",
    skip: "· ",
    conflict: "✗ ",
  };
  for (const it of items) {
    const a = it.action;
    const name = entryLabel(it.entry.name, it.rel);
    switch (a.kind) {
      case "already-linked":
        console.log(`${icon[a.kind]}${name} already linked`);
        break;
      case "adopt-from-repo":
        console.log(`${icon[a.kind]}${name} symlink ${a.from} → repo`);
        break;
      case "migrate":
        console.log(`${icon[a.kind]}${name} move ${a.from} → repo (backup ${a.backup}), then symlink`);
        break;
      case "overwrite-with-repo":
        console.log(`${icon[a.kind]}${name} back up local ${a.from} → ${a.backup}, then symlink to repo`);
        break;
      case "skip":
        console.log(`${icon[a.kind]}${name} skip (${a.reason})`);
        break;
      case "conflict":
        console.log(`${icon[a.kind]}${name} CONFLICT (${a.reason})`);
        break;
    }
  }
}

// Write the per-entry .gitignore for dir-mode entries that declare `ignore`.
function writeIgnore(entry: DotfileEntry) {
  if (entry.mode !== "dir" || !entry.ignore?.length) return;
  const repoBase = path.join(dotfilesRepo(), entry.name);
  if (!fs.existsSync(repoBase)) return;
  const file = path.join(repoBase, ".gitignore");
  const body = entry.ignore.join("\n") + "\n";
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== body) {
    fs.writeFileSync(file, body);
  }
}

function applyItem(it: PlanItem) {
  const a = it.action;
  const name = entryLabel(it.entry.name, it.rel);

  if (a.kind === "already-linked" || a.kind === "skip") return;
  if (a.kind === "conflict") {
    console.log(`✗ ${name} left untouched (${a.reason})`);
    return;
  }

  if (a.kind === "adopt-from-repo") {
    fs.mkdirSync(path.dirname(a.from), { recursive: true });
    fs.symlinkSync(a.to, a.from);
    console.log(`→ ${name} linked`);
    return;
  }

  if (a.kind === "overwrite-with-repo") {
    // Back up the local copy and link to the repo; the repo copy is never overwritten.
    fs.rmSync(a.backup, { recursive: true, force: true });
    fs.renameSync(a.from, a.backup);
    fs.symlinkSync(a.to, a.from);
    console.log(`! ${name} local backed up to ${a.backup}, linked to repo`);
    return;
  }

  // migrate: move live → repo, back up, symlink
  fs.mkdirSync(path.dirname(a.to), { recursive: true });
  fs.cpSync(a.from, `${a.from}.bak`, { recursive: true });
  fs.renameSync(a.from, a.to);
  fs.symlinkSync(a.to, a.from);
  writeIgnore(it.entry);
  console.log(`⇧ ${name} migrated + linked (backup at ${a.from}.bak)`);
}

export function link({
  dryRun,
  only,
  force = false,
}: {
  dryRun: boolean;
  only?: string[];
  force?: boolean;
}) {
  const items = buildPlan(only, force);

  if (items.length === 0) {
    if (only?.length) {
      console.log(`No manifest entries match: ${only.join(", ")}`);
    } else {
      console.log(
        "Manifest has no entries yet. Add configs to manifest.json, then run `link`."
      );
    }
    return { items, applied: 0, conflicts: 0 };
  }

  console.log(dryRun ? "Dry run — no changes will be made:\n" : "Linking dotfiles:\n");
  printPlan(items);

  const isActionable = (k: PlanAction["kind"]) =>
    k === "migrate" || k === "adopt-from-repo" || k === "overwrite-with-repo";
  const conflicts = items.filter((i) => i.action.kind === "conflict");
  const actionable = items.filter((i) => isActionable(i.action.kind));

  console.log("");
  console.log(
    `${actionable.length} to link, ${conflicts.length} conflict(s), ` +
      `${items.length - actionable.length - conflicts.length} unchanged.`
  );

  if (dryRun) {
    console.log("\nRe-run without --dry-run to apply.");
    return { items, applied: 0, conflicts: conflicts.length };
  }

  // Ensure dir-mode ignores exist even for already-linked entries.
  for (const entry of loadManifest()) writeIgnore(entry);

  let applied = 0;
  for (const it of items) {
    if (isActionable(it.action.kind)) {
      applyItem(it);
      applied++;
    } else if (it.action.kind === "conflict") {
      applyItem(it);
    }
  }
  console.log(`\n✅ Linked ${applied} item(s).`);
  return { items, applied, conflicts: conflicts.length };
}
