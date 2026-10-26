import fs from "node:fs";
import path from "node:path";
import { loadManifest, DotfileEntry } from "./manifest.js";
import { dotfilesRepo } from "../config.js";
import { applySharedChild, childPairs, ChildWork, planSharedChildren } from "./children.js";
import { PlanAction, PlanItem } from "./plan.js";
import { isSymlink, symlinkResolves } from "./symlink.js";

export type { PlanAction, PlanItem } from "./plan.js";
export { isSymlink, symlinkResolves } from "./symlink.js";

// Build the set of (live path, repo path) pairs for an entry.
export function pairsFor(entry: DotfileEntry): { live: string; repo: string; rel: string }[] {
  if (entry.mode === "children") return childPairs(entry);
  const repoBase = path.join(dotfilesRepo(), entry.name);
  if (!entry.target) return [];
  if (entry.mode === "dir") {
    return [{ live: entry.target, repo: repoBase, rel: "" }];
  }
  return (entry.files ?? []).map((rel) => ({
    live: path.join(entry.target as string, rel),
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

function collect(
  only?: string[],
  force = false
): { items: PlanItem[]; work: ChildWork[] } {
  const items: PlanItem[] = [];
  const work: ChildWork[] = [];
  const wanted = only?.length ? new Set(only) : null;
  for (const entry of loadManifest()) {
    if (wanted && !wanted.has(entry.name)) continue;
    if (entry.mode === "children") {
      const planned = planSharedChildren(entry);
      items.push(...planned.items);
      work.push(...planned.work);
      continue;
    }
    for (const { live, repo, rel } of pairsFor(entry)) {
      items.push(planItem(entry, live, repo, rel, force));
    }
  }
  return { items, work };
}

// `only` restricts the plan to the named manifest entries (for incremental linking).
// `force` overwrites a live copy that also exists in the repo (backing it up first).
export function buildPlan(only?: string[], force = false): PlanItem[] {
  return collect(only, force).items;
}

// Display suffix for an entry's sub-path ("/config.toml" in files mode, "" in dir mode).
export function entryLabel(name: string, rel: string): string {
  return `${name}${rel ? `/${rel}` : ""}`;
}

function itemLabel(it: PlanItem): string {
  const base = entryLabel(it.entry.name, it.rel);
  if (it.entry.mode === "children" && it.action.from !== it.entry.name) {
    return `${base} @ ${it.action.from}`;
  }
  return base;
}

function printPlan(items: PlanItem[], quiet: boolean) {
  const icon: Record<PlanAction["kind"], string> = {
    "already-linked": "✓ ",
    "adopt-from-repo": "→ ",
    migrate: "⇧ ",
    "overwrite-with-repo": "! ",
    union: "⇧ ",
    retarget: "→ ",
    outside: "· ",
    skip: "· ",
    conflict: "✗ ",
  };
  for (const it of items) {
    const a = it.action;
    if (quiet && a.kind !== "conflict" && !isActionable(a.kind)) continue;
    const name = itemLabel(it);
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
      case "union":
        console.log(`${icon[a.kind]}${name} fold ${a.from} into repo (backup ${a.backup}), then symlink`);
        break;
      case "retarget":
        console.log(`${icon[a.kind]}${name} repoint ${a.from} → repo`);
        break;
      case "outside":
        console.log(`${icon[a.kind]}${name} left in place (symlink points outside the configured directories)`);
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
  if (entry.mode !== "dir" || !entry.ignore?.length || !entry.target) return;
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
  const name = itemLabel(it);

  if (a.kind === "already-linked" || a.kind === "skip" || a.kind === "outside") return;
  if (a.kind === "conflict") {
    console.log(`✗ ${name} left untouched (${a.reason})`);
    return;
  }
  if (a.kind === "union" || a.kind === "retarget") return;

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

function isActionable(k: PlanAction["kind"]): boolean {
  return (
    k === "migrate" ||
    k === "adopt-from-repo" ||
    k === "overwrite-with-repo" ||
    k === "union" ||
    k === "retarget"
  );
}

export function link({
  dryRun,
  only,
  force = false,
  quiet = false,
}: {
  dryRun: boolean;
  only?: string[];
  force?: boolean;
  quiet?: boolean;
}) {
  const entries = loadManifest().filter((e) => !only?.length || only.includes(e.name));
  const { items, work } = collect(only, force);

  if (entries.length === 0) {
    if (!quiet) {
      if (only?.length) {
        console.log(`No manifest entries match: ${only.join(", ")}`);
      } else {
        console.log(
          "Manifest has no entries yet. Add configs to manifest.json, then run `link`."
        );
      }
    }
    return { items, applied: 0, conflicts: 0 };
  }

  if (!quiet) {
    console.log(dryRun ? "Dry run — no changes will be made:\n" : "Linking dotfiles:\n");
  }
  printPlan(items, quiet);

  const conflicts = items.filter((i) => i.action.kind === "conflict");
  const actionable = items.filter((i) => isActionable(i.action.kind));

  if (!quiet || actionable.length || conflicts.length) {
    console.log("");
    console.log(
      `${actionable.length} to link, ${conflicts.length} conflict(s), ` +
        `${items.length - actionable.length - conflicts.length} unchanged.`
    );
  }

  if (dryRun) {
    if (!quiet) console.log("\nRe-run without --dry-run to apply.");
    return { items, applied: 0, conflicts: conflicts.length };
  }

  // Ensure dir-mode ignores exist even for already-linked entries.
  for (const entry of loadManifest()) writeIgnore(entry);

  // A clashing child is left untouched (applySharedChild returns immediately).
  // Its plan items are conflicts, not actionable, so they are not counted as linked.
  for (const w of work) applySharedChild(w);

  let applied = 0;
  for (const it of items) {
    if (it.entry.mode === "children") {
      if (isActionable(it.action.kind)) applied++;
      continue;
    }
    if (isActionable(it.action.kind)) {
      applyItem(it);
      applied++;
    } else if (it.action.kind === "conflict") {
      applyItem(it);
    }
  }
  if (!quiet || applied || conflicts.length) {
    console.log(`\n✅ Linked ${applied} item(s).`);
  }
  return { items, applied, conflicts: conflicts.length };
}
