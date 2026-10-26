import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { link } from "../src/dotfiles/link.js";
import { sync } from "../src/dotfiles/sync.js";

const originalDotfiles = process.env.WENDWAY_DOTFILES;

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function setup(): { root: string; repo: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wendway-"));
  const repo = path.join(root, "dotfiles");
  fs.mkdirSync(repo);
  process.env.WENDWAY_DOTFILES = repo;
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return { root, repo };
}

function writeManifest(repo: string, entries: unknown[]) {
  fs.writeFileSync(
    path.join(repo, "manifest.json"),
    JSON.stringify({ version: 1, entries }, null, 2) + "\n"
  );
}

function writeTree(dir: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
}

function assertLinked(live: string, repoPath: string) {
  const st = fs.lstatSync(live);
  assert.equal(st.isSymbolicLink(), true, `${live} should be a symlink`);
  assert.equal(path.resolve(path.dirname(live), fs.readlinkSync(live)), path.resolve(repoPath));
}

function assertRealDir(p: string) {
  const st = fs.lstatSync(p);
  assert.equal(st.isSymbolicLink(), false, `${p} should not be a symlink`);
  assert.equal(st.isDirectory(), true);
}

afterEach(() => {
  if (originalDotfiles === undefined) delete process.env.WENDWAY_DOTFILES;
  else process.env.WENDWAY_DOTFILES = originalDotfiles;
});

describe("shared children", { concurrency: false }, () => {
  it("a pattern shares that family and leaves other children alone", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    writeTree(a, { "team-red/SKILL.md": "red\n", "solo/SKILL.md": "solo-a\n" });
    writeTree(b, { "team-red/SKILL.md": "red\n", "team-blue/SKILL.md": "blue\n", "solo/SKILL.md": "solo-b\n" });
    writeManifest(repo, [
      {
        name: "skills",
        mode: "children",
        targets: [a, b],
        children: "team-*",
      },
    ]);

    const result = link({ dryRun: false });
    assert.equal(result.conflicts, 0);

    const stored = path.join(repo, "skills");
    assert.deepEqual(fs.readdirSync(stored).sort(), ["team-blue", "team-red"]);
    assertLinked(path.join(a, "team-red"), path.join(stored, "team-red"));
    assertLinked(path.join(b, "team-red"), path.join(stored, "team-red"));
    assertLinked(path.join(a, "team-blue"), path.join(stored, "team-blue"));
    assertLinked(path.join(b, "team-blue"), path.join(stored, "team-blue"));
    assert.equal(fs.readlinkSync(path.join(a, "team-red")), fs.readlinkSync(path.join(b, "team-red")));
    assertRealDir(path.join(a, "solo"));
    assertRealDir(path.join(b, "solo"));
    assert.equal(fs.existsSync(path.join(stored, "solo")), false);
    assert.equal(fs.readFileSync(path.join(a, "solo", "SKILL.md"), "utf8"), "solo-a\n");
  });

  it("every child is shared, and skipped names stay where they are", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    writeTree(a, {
      "alpha/SKILL.md": "alpha\n",
      "bucket/data.txt": "cloud\n",
      "bucket-notes/SKILL.md": "notes\n",
    });
    writeTree(b, { "beta/SKILL.md": "beta\n" });
    writeManifest(repo, [
      {
        name: "skills",
        mode: "children",
        targets: [a, b],
        children: "every",
        skip: ["bucket"],
      },
    ]);

    link({ dryRun: false });

    const stored = path.join(repo, "skills");
    assert.deepEqual(fs.readdirSync(stored).sort(), ["alpha", "beta", "bucket-notes"]);
    assertLinked(path.join(a, "alpha"), path.join(stored, "alpha"));
    assertLinked(path.join(b, "alpha"), path.join(stored, "alpha"));
    assertLinked(path.join(a, "beta"), path.join(stored, "beta"));
    assertLinked(path.join(b, "beta"), path.join(stored, "beta"));
    assertLinked(path.join(a, "bucket-notes"), path.join(stored, "bucket-notes"));
    assertRealDir(path.join(a, "bucket"));
    assert.equal(fs.readFileSync(path.join(a, "bucket", "data.txt"), "utf8"), "cloud\n");
    assert.equal(fs.existsSync(path.join(stored, "bucket")), false);
    assert.equal(fs.existsSync(path.join(b, "bucket")), false);
  });

  it("a symlink that points outside every live directory is left alone", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    const install = path.join(root, "install", "tool");
    const broken = path.join(root, "gone", "xavier");
    writeTree(a, { "keep/SKILL.md": "keep\n" });
    writeTree(install, { "SKILL.md": "app\n" });
    fs.mkdirSync(b);
    fs.symlinkSync(install, path.join(a, "external-tool"));
    fs.symlinkSync(broken, path.join(a, "stale-link"));
    fs.symlinkSync(install, path.join(b, "external-tool"));
    writeManifest(repo, [
      {
        name: "skills",
        mode: "children",
        targets: [a, b],
        children: "every",
      },
    ]);

    const result = link({ dryRun: false });
    assert.equal(result.conflicts, 0);

    assert.equal(fs.readlinkSync(path.join(a, "external-tool")), install);
    assert.equal(fs.readlinkSync(path.join(b, "external-tool")), install);
    assert.equal(fs.readlinkSync(path.join(a, "stale-link")), broken);
    assert.equal(fs.existsSync(path.join(repo, "skills", "external-tool")), false);
    assert.equal(fs.existsSync(path.join(repo, "skills", "stale-link")), false);
    assertLinked(path.join(a, "keep"), path.join(repo, "skills", "keep"));
    assertLinked(path.join(b, "keep"), path.join(repo, "skills", "keep"));
    assert.equal(fs.readFileSync(path.join(install, "SKILL.md"), "utf8"), "app\n");
  });

  it("several targets share one stored path, including files only one copy had", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    const c = path.join(root, "agent-c");
    writeTree(a, {
      "shared/SKILL.md": "same\n",
      "shared/extra.txt": "from-a\n",
      "via-link/SKILL.md": "one\n",
    });
    writeTree(b, {
      "shared/SKILL.md": "same\n",
      "shared/agents/openai.yaml": "name: shared\n",
    });
    fs.symlinkSync(path.join(a, "via-link"), path.join(b, "via-link"));
    fs.mkdirSync(c);
    writeManifest(repo, [
      {
        name: "skills",
        mode: "children",
        targets: [a, b, c],
        children: "every",
      },
    ]);

    link({ dryRun: false });

    const shared = path.join(repo, "skills", "shared");
    const via = path.join(repo, "skills", "via-link");
    assert.equal(fs.lstatSync(shared).isDirectory() && !fs.lstatSync(shared).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(via).isDirectory() && !fs.lstatSync(via).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(shared, "SKILL.md"), "utf8"), "same\n");
    assert.equal(fs.readFileSync(path.join(shared, "extra.txt"), "utf8"), "from-a\n");
    assert.equal(fs.readFileSync(path.join(shared, "agents", "openai.yaml"), "utf8"), "name: shared\n");
    assert.equal(fs.readFileSync(path.join(via, "SKILL.md"), "utf8"), "one\n");
    for (const live of [a, b, c]) {
      assertLinked(path.join(live, "shared"), shared);
      assertLinked(path.join(live, "via-link"), via);
    }
    assert.equal(fs.readlinkSync(path.join(a, "shared")), fs.readlinkSync(path.join(b, "shared")));
    assert.equal(fs.readlinkSync(path.join(b, "via-link")), fs.readlinkSync(path.join(a, "via-link")));
    assertRealDir(path.join(a, "shared.bak"));
    assert.equal(fs.readFileSync(path.join(a, "shared.bak", "extra.txt"), "utf8"), "from-a\n");
  });

  it("a second link changes nothing", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    writeTree(a, { "skill/SKILL.md": "body\n" });
    writeTree(b, { "skill/SKILL.md": "body\n", "skill/agents/openai.yaml": "name: skill\n" });
    writeManifest(repo, [
      { name: "skills", mode: "children", targets: [a, b], children: "every" },
    ]);

    const first = link({ dryRun: false });
    assert.ok(first.applied > 0);

    const storedFile = path.join(repo, "skills", "skill", "SKILL.md");
    const extra = path.join(repo, "skills", "skill", "agents", "openai.yaml");
    const linkPath = path.join(a, "skill");
    const before = {
      file: fs.readFileSync(storedFile),
      extra: fs.readFileSync(extra),
      fileMtime: fs.statSync(storedFile).mtimeMs,
      linkIno: fs.lstatSync(linkPath).ino,
      linkTarget: fs.readlinkSync(linkPath),
      bakIsDir: fs.lstatSync(path.join(a, "skill.bak")).isDirectory() && !fs.lstatSync(path.join(a, "skill.bak")).isSymbolicLink(),
      names: fs.readdirSync(a).sort(),
      stored: fs.readdirSync(path.join(repo, "skills")).sort(),
    };

    const second = link({ dryRun: false });
    assert.equal(second.applied, 0);
    assert.equal(second.conflicts, 0);
    assert.equal(second.items.every((it) => it.action.kind === "already-linked"), true);
    assert.deepEqual(fs.readFileSync(storedFile), before.file);
    assert.deepEqual(fs.readFileSync(extra), before.extra);
    assert.equal(fs.statSync(storedFile).mtimeMs, before.fileMtime);
    assert.equal(fs.lstatSync(linkPath).ino, before.linkIno);
    assert.equal(fs.readlinkSync(linkPath), before.linkTarget);
    assert.equal(
      fs.lstatSync(path.join(a, "skill.bak")).isDirectory() && !fs.lstatSync(path.join(a, "skill.bak")).isSymbolicLink(),
      before.bakIsDir
    );
    assert.deepEqual(fs.readdirSync(a).sort(), before.names);
    assert.deepEqual(fs.readdirSync(path.join(repo, "skills")).sort(), before.stored);
  });

  it("a content clash refuses to link and reports both paths", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    writeTree(a, { "clash/SKILL.md": "one\n", "clash/only-a.txt": "a\n" });
    writeTree(b, { "clash/SKILL.md": "two\n", "clash/agents/openai.yaml": "name: clash\n" });
    writeManifest(repo, [
      { name: "skills", mode: "children", targets: [a, b], children: "every" },
    ]);

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    let result: ReturnType<typeof link>;
    try {
      result = link({ dryRun: false });
    } finally {
      console.log = orig;
    }

    assert.ok(result.conflicts > 0);
    assert.equal(result.applied, 0);
    const reported = lines.join("\n");
    const fileA = path.join(a, "clash", "SKILL.md");
    const fileB = path.join(b, "clash", "SKILL.md");
    assert.ok(reported.includes(fileA), reported);
    assert.ok(reported.includes(fileB), reported);
    assert.ok(reported.includes("SKILL.md"), reported);
    assertRealDir(path.join(a, "clash"));
    assertRealDir(path.join(b, "clash"));
    assert.equal(fs.readFileSync(fileA, "utf8"), "one\n");
    assert.equal(fs.readFileSync(fileB, "utf8"), "two\n");
    assert.equal(fs.readFileSync(path.join(a, "clash", "only-a.txt"), "utf8"), "a\n");
    assert.equal(fs.readFileSync(path.join(b, "clash", "agents", "openai.yaml"), "utf8"), "name: clash\n");
    assert.equal(fs.existsSync(path.join(repo, "skills", "clash")), false);
  });

  it("sync adopts a new skill and links the other live directories before committing", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    fs.mkdirSync(a);
    writeTree(b, { "newskill/SKILL.md": "fresh\n" });
    writeManifest(repo, [
      { name: "skills", mode: "children", targets: [a, b], children: "every" },
    ]);

    const marker = path.join(root, "hook-saw");
    const hook = path.join(repo, ".git", "hooks", "pre-commit");
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nif [ -L "${path.join(a, "newskill")}" ]; then echo linked > "${marker}"; else echo missing > "${marker}"; fi\nexit 0\n`
    );
    fs.chmodSync(hook, 0o755);

    const ok = sync();
    assert.equal(ok, true);
    assert.equal(fs.readFileSync(marker, "utf8").trim(), "linked");

    const stored = path.join(repo, "skills", "newskill");
    assert.equal(fs.readFileSync(path.join(stored, "SKILL.md"), "utf8"), "fresh\n");
    assertLinked(path.join(a, "newskill"), stored);
    assertLinked(path.join(b, "newskill"), stored);
    assert.equal(fs.readlinkSync(path.join(a, "newskill")), fs.readlinkSync(path.join(b, "newskill")));
    const committed = git(repo, ["ls-tree", "-r", "--name-only", "HEAD"]);
    assert.ok(committed.includes("skills/newskill/SKILL.md"), committed);
    assert.equal(git(repo, ["status", "--porcelain"]), "");
    assert.match(git(repo, ["log", "-1", "--format=%s"]), /^chore\(sync\):/);
  });

  it("a content clash stops sync before commit and push", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    const bare = path.join(root, "origin.git");
    writeTree(a, { "clash/SKILL.md": "one\n" });
    writeTree(b, { "clash/SKILL.md": "two\n" });
    writeManifest(repo, [
      { name: "skills", mode: "children", targets: [a, b], children: "every" },
    ]);
    fs.writeFileSync(path.join(repo, "notes.txt"), "v1\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "initial"]);
    execFileSync("git", ["init", "--bare", "-b", "main", bare], { stdio: "ignore" });
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "main"]);
    const local = git(repo, ["rev-parse", "HEAD"]);
    const remote = git(bare, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(repo, "notes.txt"), "v2\n");

    const ok = sync();
    assert.equal(ok, false);
    assert.equal(git(repo, ["rev-parse", "HEAD"]), local);
    assert.equal(git(bare, ["rev-parse", "HEAD"]), remote);
    assert.match(git(repo, ["status", "--porcelain"]), /notes\.txt/);
    assert.equal(fs.readFileSync(path.join(repo, "notes.txt"), "utf8"), "v2\n");
    assertRealDir(path.join(a, "clash"));
    assertRealDir(path.join(b, "clash"));
    assert.equal(fs.readFileSync(path.join(a, "clash", "SKILL.md"), "utf8"), "one\n");
    assert.equal(fs.readFileSync(path.join(b, "clash", "SKILL.md"), "utf8"), "two\n");
    assert.equal(fs.existsSync(path.join(repo, "skills", "clash")), false);
  });

  it("sync links a skill that arrived from the other machine before pushing", () => {
    const { root, repo } = setup();
    const a = path.join(root, "agent-a");
    const b = path.join(root, "agent-b");
    const bare = path.join(root, "origin.git");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    writeManifest(repo, [
      { name: "skills", mode: "children", targets: [a, b], children: "every" },
    ]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "manifest"]);
    execFileSync("git", ["init", "--bare", "-b", "main", bare], { stdio: "ignore" });
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "main"]);

    writeTree(path.join(repo, "skills"), { "arrived/SKILL.md": "from-remote\n" });
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "skill from elsewhere"]);
    git(repo, ["push", "origin", "main"]);
    git(repo, ["reset", "--hard", "HEAD~1"]);
    assert.equal(fs.existsSync(path.join(repo, "skills", "arrived")), false);

    const ok = sync();
    assert.equal(ok, true);
    const stored = path.join(repo, "skills", "arrived");
    assert.equal(fs.readFileSync(path.join(stored, "SKILL.md"), "utf8"), "from-remote\n");
    assertLinked(path.join(a, "arrived"), stored);
    assertLinked(path.join(b, "arrived"), stored);
    assert.equal(git(repo, ["rev-parse", "HEAD"]), git(bare, ["rev-parse", "HEAD"]));
  });

  it("dir mode still moves one directory and symlinks it", () => {
    const { root, repo } = setup();
    const live = path.join(root, "nvim");
    writeTree(live, { "init.lua": "vim.opt.number = true\n" });
    writeManifest(repo, [{ name: "nvim", mode: "dir", target: live }]);

    const result = link({ dryRun: false });
    assert.equal(result.conflicts, 0);
    assert.equal(result.applied, 1);
    assertLinked(live, path.join(repo, "nvim"));
    assert.equal(fs.readFileSync(path.join(repo, "nvim", "init.lua"), "utf8"), "vim.opt.number = true\n");
    assert.equal(fs.readFileSync(path.join(root, "nvim.bak", "init.lua"), "utf8"), "vim.opt.number = true\n");

    const again = link({ dryRun: false });
    assert.equal(again.applied, 0);
    assert.equal(again.items[0].action.kind, "already-linked");
  });
});
