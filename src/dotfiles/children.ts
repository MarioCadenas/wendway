import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dotfilesRepo } from "../config.js";
import { DotfileEntry } from "./manifest.js";
import { PlanItem } from "./plan.js";
import { isSymlink } from "./symlink.js";

// One manifest entry, one stored tree (`<repo>/<name>/<child>`), symlinked into
// every directory in `targets`. Children are chosen by `children`: "every", or a
// glob (`*` any run, `?` one character). `skip` names are never stored or linked.
// Nothing here knows which tools those directories belong to.

export interface ContentClash {
  rel: string;
  a: string;
  b: string;
}

type LiveKind = "missing" | "linked" | "outside" | "cross" | "dir" | "other";

interface LiveRef {
  live: string;
  state: LiveKind;
}

export interface ChildWork {
  child: string;
  repo: string;
  /** Real directories, in target order, deduped. The stored tree is their union. */
  realDirs: string[];
  repoExists: boolean;
  lives: LiveRef[];
  clashes: ContentClash[];
  /** Set when the repo path cannot be written safely. */
  problem: string | null;
}

interface WalkItem {
  rel: string;
  kind: "dir" | "file" | "symlink";
  sig: string;
}

export function childNameMatches(name: string, selector: string): boolean {
  if (selector === "every") return true;
  let pattern = "^";
  for (const ch of selector) {
    if (ch === "*") pattern += ".*";
    else if (ch === "?") pattern += ".";
    else pattern += ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  pattern += "$";
  return new RegExp(pattern).test(name);
}

function selectorOf(entry: DotfileEntry): string {
  return entry.children && entry.children.length > 0 ? entry.children : "every";
}

function listChildNames(dir: string): string[] {
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw e;
  }
  // Symlinks included so an external link can be recognised and left alone.
  return ents.filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name);
}

function wanted(name: string, entry: DotfileEntry): boolean {
  if (entry.skip?.includes(name)) return false;
  return childNameMatches(name, selectorOf(entry));
}

export function selectedChildNames(entry: DotfileEntry): string[] {
  const raw = new Set<string>();
  const dirs = [...(entry.targets ?? []), path.join(dotfilesRepo(), entry.name)];
  for (const dir of dirs) {
    for (const name of listChildNames(dir)) raw.add(name);
  }
  const names: string[] = [];
  for (const name of raw) {
    if (!wanted(name, entry)) continue;
    // `link` backs a moved child up at `<child>.bak` beside it. That backup is not a second skill.
    if (name.endsWith(".bak")) {
      const stem = name.slice(0, -".bak".length);
      if (raw.has(stem) && wanted(stem, entry)) continue;
    }
    names.push(name);
  }
  names.sort();
  return names;
}

function resolvedLink(live: string): string | null {
  try {
    return path.resolve(path.dirname(live), fs.readlinkSync(live));
  } catch {
    return null;
  }
}

function classify(live: string, repo: string, targets: string[], child: string): LiveKind {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(live);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw e;
  }
  if (st.isSymbolicLink()) {
    const resolved = resolvedLink(live);
    if (resolved === null) return "other";
    if (resolved === path.resolve(repo)) return "linked";
    const sameSkill = targets.some(
      (t) => resolved === path.resolve(path.join(t, child))
    );
    // Points at this child in another configured directory: one skill, not a second copy.
    if (sameSkill) return "cross";
    // Anywhere else — another install, a temp dir, a broken link outside — stays put.
    return "outside";
  }
  if (st.isDirectory()) return "dir";
  return "other";
}

function repoState(repo: string): { exists: boolean; problem: string | null } {
  try {
    const st = fs.lstatSync(repo);
    if (st.isSymbolicLink()) {
      return { exists: false, problem: `stored path is a symlink (${repo}); not following it` };
    }
    if (st.isDirectory()) return { exists: true, problem: null };
    return { exists: false, problem: `stored path is not a directory (${repo})` };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, problem: null };
    throw e;
  }
}

function walk(root: string): WalkItem[] {
  const out: WalkItem[] = [];
  const visit = (dir: string, prefix: string) => {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of ents) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) {
        out.push({ rel, kind: "symlink", sig: `symlink:${fs.readlinkSync(abs)}` });
      } else if (ent.isDirectory()) {
        out.push({ rel, kind: "dir", sig: "dir" });
        visit(abs, rel);
      } else if (ent.isFile()) {
        const hash = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
        out.push({ rel, kind: "file", sig: `file:${hash}` });
      }
    }
  };
  visit(root, "");
  return out;
}

function findClashes(sources: string[]): ContentClash[] {
  const maps = sources.map((root) => {
    const m = new Map<string, string>();
    for (const item of walk(root)) m.set(item.rel, item.sig);
    return m;
  });
  const rels = new Set<string>();
  for (const m of maps) for (const rel of m.keys()) rels.add(rel);

  const clashes: ContentClash[] = [];
  for (const rel of [...rels].sort()) {
    const present: { root: string; sig: string }[] = [];
    maps.forEach((m, i) => {
      const sig = m.get(rel);
      if (sig !== undefined) present.push({ root: sources[i], sig });
    });
    for (let i = 1; i < present.length; i++) {
      if (present[i].sig !== present[0].sig) {
        clashes.push({
          rel,
          a: path.join(present[0].root, rel),
          b: path.join(present[i].root, rel),
        });
      }
    }
  }
  return clashes;
}

export function formatClashes(clashes: ContentClash[]): string {
  return (
    "content differs: " +
    clashes.map((c) => `${c.rel} (${c.a} vs ${c.b})`).join("; ")
  );
}

function assess(entry: DotfileEntry, child: string): ChildWork {
  const targets = entry.targets ?? [];
  const repo = path.join(dotfilesRepo(), entry.name, child);
  const stored = repoState(repo);
  const lives: LiveRef[] = targets.map((t) => ({
    live: path.join(t, child),
    state: classify(path.join(t, child), repo, targets, child),
  }));
  const realDirs: string[] = [];
  for (const live of lives) {
    if (live.state !== "dir") continue;
    const resolved = path.resolve(live.live);
    if (!realDirs.some((d) => path.resolve(d) === resolved)) realDirs.push(live.live);
  }
  const sources = [...realDirs];
  if (stored.exists) sources.push(repo);
  const clashes = stored.problem ? [] : findClashes(sources);
  return {
    child,
    repo,
    realDirs,
    repoExists: stored.exists,
    lives,
    clashes,
    problem: stored.problem,
  };
}

function clashReason(work: ChildWork): string {
  if (work.problem) return work.problem;
  return formatClashes(work.clashes);
}

function itemsFor(entry: DotfileEntry, work: ChildWork): PlanItem[] {
  const blocked = work.problem !== null || work.clashes.length > 0;
  const willStore = work.repoExists || work.realDirs.length > 0;
  const primary = !work.repoExists ? work.realDirs[0] : undefined;
  const items: PlanItem[] = [];

  for (const live of work.lives) {
    if (live.state === "outside") {
      items.push({ entry, rel: work.child, action: { kind: "outside", from: live.live } });
      continue;
    }
    if (blocked) {
      items.push({
        entry,
        rel: work.child,
        action: { kind: "conflict", from: live.live, reason: clashReason(work) },
      });
      continue;
    }
    if (live.state === "linked") {
      items.push({
        entry,
        rel: work.child,
        action: { kind: "already-linked", from: live.live, to: work.repo },
      });
      continue;
    }
    if (live.state === "dir") {
      if (primary !== undefined && path.resolve(live.live) === path.resolve(primary)) {
        items.push({
          entry,
          rel: work.child,
          action: { kind: "migrate", from: live.live, to: work.repo, backup: `${live.live}.bak` },
        });
      } else {
        items.push({
          entry,
          rel: work.child,
          action: { kind: "union", from: live.live, to: work.repo, backup: `${live.live}.bak` },
        });
      }
      continue;
    }
    if (live.state === "cross") {
      if (!willStore) {
        items.push({
          entry,
          rel: work.child,
          action: {
            kind: "skip",
            from: live.live,
            reason: "symlink points at another live directory but there is no copy to store",
          },
        });
      } else {
        items.push({
          entry,
          rel: work.child,
          action: { kind: "retarget", from: live.live, to: work.repo },
        });
      }
      continue;
    }
    if (live.state === "missing") {
      if (!willStore) {
        items.push({
          entry,
          rel: work.child,
          action: { kind: "skip", from: live.live, reason: "not found live or in repo" },
        });
      } else {
        items.push({
          entry,
          rel: work.child,
          action: { kind: "adopt-from-repo", from: live.live, to: work.repo },
        });
      }
      continue;
    }
    items.push({
      entry,
      rel: work.child,
      action: { kind: "skip", from: live.live, reason: "not a directory" },
    });
  }
  return items;
}

export function planSharedChildren(entry: DotfileEntry): { items: PlanItem[]; work: ChildWork[] } {
  if (!entry.targets?.length) {
    return {
      items: [
        {
          entry,
          rel: "",
          action: { kind: "skip", from: entry.name, reason: "children entry has no targets" },
        },
      ],
      work: [],
    };
  }
  const items: PlanItem[] = [];
  const work: ChildWork[] = [];
  for (const child of selectedChildNames(entry)) {
    const assessed = assess(entry, child);
    work.push(assessed);
    items.push(...itemsFor(entry, assessed));
  }
  return { items, work };
}

/** Pairs we expect to manage. Symlinks that point outside every target are omitted. */
export function childPairs(entry: DotfileEntry): { live: string; repo: string; rel: string }[] {
  if (!entry.targets?.length) return [];
  const pairs: { live: string; repo: string; rel: string }[] = [];
  for (const child of selectedChildNames(entry)) {
    const repo = path.join(dotfilesRepo(), entry.name, child);
    for (const target of entry.targets) {
      const live = path.join(target, child);
      if (classify(live, repo, entry.targets, child) === "outside") continue;
      pairs.push({ live, repo, rel: child });
    }
  }
  return pairs;
}

function copyMissing(destRoot: string, srcRoot: string) {
  for (const item of walk(srcRoot)) {
    const dest = path.join(destRoot, item.rel);
    const src = path.join(srcRoot, item.rel);
    if (exists(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (item.kind === "dir") fs.mkdirSync(dest, { recursive: true });
    else if (item.kind === "symlink") fs.symlinkSync(fs.readlinkSync(src), dest);
    else fs.copyFileSync(src, dest);
  }
}

function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// Same backup as dir/files migrate: a full copy at `<path>.bak`, then the live path becomes a symlink.
function backupAndRemove(dir: string) {
  fs.cpSync(dir, `${dir}.bak`, { recursive: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

export function applySharedChild(work: ChildWork) {
  if (work.problem || work.clashes.length > 0) return;

  const { repo, realDirs } = work;
  const willStore = work.repoExists || realDirs.length > 0;
  if (!willStore) return;

  if (!work.repoExists) {
    const primary = realDirs[0];
    fs.mkdirSync(path.dirname(repo), { recursive: true });
    fs.cpSync(primary, `${primary}.bak`, { recursive: true });
    fs.renameSync(primary, repo);
    fs.symlinkSync(repo, primary);
    for (const dir of realDirs.slice(1)) {
      copyMissing(repo, dir);
      backupAndRemove(dir);
      fs.symlinkSync(repo, dir);
    }
  } else {
    for (const dir of realDirs) {
      copyMissing(repo, dir);
      backupAndRemove(dir);
      fs.symlinkSync(repo, dir);
    }
  }

  for (const live of work.lives) {
    if (live.state === "missing") {
      fs.mkdirSync(path.dirname(live.live), { recursive: true });
      fs.symlinkSync(repo, live.live);
    } else if (live.state === "cross") {
      if (isSymlink(live.live)) fs.unlinkSync(live.live);
      fs.symlinkSync(repo, live.live);
    }
  }
}
