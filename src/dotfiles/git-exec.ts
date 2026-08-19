import { execFileSync } from "node:child_process";
import { dotfilesRepo } from "../config.js";

// Run a git command in the dotfiles repo. Returns trimmed stdout.
// Throws on non-zero exit (stderr surfaced via the error).
export function git(args: string[], { quiet = false }: { quiet?: boolean } = {}): string {
  const out = execFileSync("git", args, {
    cwd: dotfilesRepo(),
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  });
  return out.trim();
}

// Like `git`, but never throws — returns {code, stdout, stderr}. Used where a
// non-zero exit is an expected branch (e.g. rebase conflict).
export function gitTry(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("git", args, {
      cwd: dotfilesRepo(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: stdout.trim(), stderr: "" };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? "").toString().trim(),
    };
  }
}
