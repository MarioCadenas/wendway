import fs from "node:fs";
import path from "node:path";
import { loadManifest, loadRawEntries, writeManifestEntries } from "./manifest.js";
import { dotfilesRepo } from "../config.js";
import { isSymlink, symlinkResolves, pairsFor, entryLabel } from "./link.js";

// Reverse of `link`: replace each symlink with a real copy of the repo content.
// With `remove`, also delete from the repo + manifest, which propagates the removal on sync.
export function unlink({
  names,
  remove,
  dryRun,
}: {
  names: string[];
  remove: boolean;
  dryRun: boolean;
}) {
  const wanted = new Set(names);
  const entries = loadManifest().filter((e) => wanted.has(e.name));

  const unknown = names.filter((n) => !entries.some((e) => e.name === n));
  if (unknown.length) {
    console.log(`Unknown manifest entries: ${unknown.join(", ")}`);
  }
  if (entries.length === 0) {
    console.log("Nothing to unlink.");
    return;
  }

  console.log(dryRun ? "Dry run — no changes will be made:\n" : "Unlinking:\n");

  for (const entry of entries) {
    for (const { live, repo, rel } of pairsFor(entry)) {
      const label = entryLabel(entry.name, rel);

      if (!isSymlink(live) || !symlinkResolves(live, repo)) {
        console.log(`· ${label} not linked here — skipping restore`);
        continue;
      }
      if (!fs.existsSync(repo)) {
        console.log(`✗ ${label} symlink present but repo file missing — skipping`);
        continue;
      }

      console.log(`→ ${label} restore real file to ${live}`);
      if (!dryRun) {
        fs.rmSync(live); // remove the symlink (not its target)
        fs.cpSync(repo, live, { recursive: true });
      }
    }

    if (remove) {
      const repoBase = path.join(dotfilesRepo(), entry.name);
      console.log(`🗑  ${entry.name} remove from repo (${repoBase}) and manifest`);
      if (!dryRun) {
        fs.rmSync(repoBase, { recursive: true, force: true });
      }
    }
  }

  if (remove && !dryRun) {
    // Use raw entries so unaffected targets keep their `~` instead of an absolute path.
    const kept = loadRawEntries().filter((e) => !wanted.has(e.name));
    writeManifestEntries(kept);
    console.log("\nUpdated manifest.json. Run `sync` to propagate the removal.");
  }

  if (dryRun) {
    console.log("\nRe-run without --dry-run to apply.");
  } else {
    console.log("\n✅ Done.");
  }
}
