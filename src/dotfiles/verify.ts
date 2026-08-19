import fs from "node:fs";
import { loadManifest } from "./manifest.js";
import { pairsFor, isSymlink, symlinkResolves, entryLabel } from "./link.js";

type Health = "ok" | "dangling" | "wrong-target" | "not-linked" | "missing";

interface Check {
  name: string;
  live: string;
  repo: string;
  health: Health;
}

// Check each expected symlink actually resolves to an existing repo file —
// catches dangling links whose target was deleted, which `status` does not.
function checkPairs(): Check[] {
  const checks: Check[] = [];
  for (const entry of loadManifest()) {
    for (const { live, repo, rel } of pairsFor(entry)) {
      const name = entryLabel(entry.name, rel);
      let health: Health;

      if (isSymlink(live)) {
        if (!symlinkResolves(live, repo)) health = "wrong-target";
        else if (!fs.existsSync(repo)) health = "dangling";
        else health = "ok";
      } else if (fs.existsSync(live)) {
        health = "not-linked";
      } else {
        health = "missing";
      }

      checks.push({ name, live, repo, health });
    }
  }
  return checks;
}

// Returns false if any link is broken, so the caller can exit non-zero.
export function verify(): boolean {
  const checks = checkPairs();
  const glyph: Record<Health, string> = {
    ok: "✓",
    dangling: "✗",
    "wrong-target": "✗",
    "not-linked": "!",
    missing: "!",
  };
  const desc: Record<Health, string> = {
    ok: "linked",
    dangling: "DANGLING — symlink target is missing in the repo",
    "wrong-target": "WRONG — symlink points somewhere else",
    "not-linked": "not linked — real file where a symlink is expected",
    missing: "missing — neither a symlink nor a file present",
  };

  console.log("Verifying symlinks:\n");
  for (const c of checks) {
    console.log(`  ${glyph[c.health]} ${c.name.padEnd(28)} ${desc[c.health]}`);
  }

  const broken = checks.filter((c) => c.health === "dangling" || c.health === "wrong-target");
  const unlinked = checks.filter((c) => c.health === "not-linked" || c.health === "missing");

  console.log(
    `\n${checks.filter((c) => c.health === "ok").length} ok, ` +
      `${broken.length} broken, ${unlinked.length} not linked.`
  );

  if (broken.length) {
    console.log("\nBroken links need attention. `link --force` or re-check the manifest.");
  }
  return broken.length === 0;
}
