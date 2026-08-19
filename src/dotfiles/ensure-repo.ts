import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dotfilesRepo } from "../config.js";
import { manifestPath, writeManifest } from "./manifest.js";

// Ensure the dotfiles repo exists (clone or init), has a manifest, and has a local
// commit identity — without one, git commits as `<user>@<hostname>.local`, which
// GitHub can't attribute. Returns the repo path.
export function ensureDotfilesRepo({
  cloneUrl,
  name,
  email,
  seedManifest = true,
}: { cloneUrl?: string; name?: string; email?: string; seedManifest?: boolean } = {}): string {
  const repo = dotfilesRepo();

  if (!fs.existsSync(repo)) {
    if (cloneUrl) {
      console.log(`Cloning ${cloneUrl} → ${repo}`);
      execFileSync("git", ["clone", cloneUrl, repo], { stdio: "inherit" });
    } else {
      console.log(`Initializing new dotfiles repo at ${repo}`);
      fs.mkdirSync(repo, { recursive: true });
      execFileSync("git", ["init"], { cwd: repo, stdio: "inherit" });
    }
  } else if (!fs.existsSync(`${repo}/.git`)) {
    execFileSync("git", ["init"], { cwd: repo, stdio: "inherit" });
  }

  if (name) execFileSync("git", ["config", "user.name", name], { cwd: repo });
  if (email) execFileSync("git", ["config", "user.email", email], { cwd: repo });

  if (seedManifest && !fs.existsSync(manifestPath())) {
    console.log(`Seeding ${manifestPath()} with default manifest.`);
    writeManifest();
  }

  return repo;
}

// The machine's existing git identity, for prompt defaults. Empty strings if none.
export function currentGitIdentity(): { name: string; email: string } {
  const read = (key: string) => {
    try {
      return execFileSync("git", ["config", "--get", key], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  return { name: read("user.name"), email: read("user.email") };
}
