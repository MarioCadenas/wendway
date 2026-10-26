import fs from "node:fs";
import { ensureDotfilesRepo } from "./ensure-repo.js";
import { manifestPath, writeScaffoldManifest } from "./manifest.js";

// Create the dotfiles repo (git init if absent) and write a starter manifest.
export function init() {
  const manifest = manifestPath();

  // Never clobber an existing manifest — that would wipe the user's real config.
  if (fs.existsSync(manifest)) {
    console.log(`A manifest already exists at ${manifest} — nothing to do.`);
    console.log("Delete it first if you want to regenerate the starter scaffold.");
    return;
  }

  const repo = ensureDotfilesRepo({ seedManifest: false });
  writeScaffoldManifest();

  console.log(`\n✅ Initialized dotfiles repo at ${repo}`);
  console.log(`   Wrote a starter manifest: ${manifest}\n`);
  console.log("Next steps:");
  console.log("  1. Edit manifest.json — replace the example entry with your real configs:");
  console.log("       • dir mode      — symlink a whole config directory (e.g. ~/.config/nvim)");
  console.log("       • files mode    — symlink only listed files (for dirs that also hold state)");
  console.log("       • children mode — store selected child directories once, symlink each into several live directories");
  console.log("  2. wendway link   — move those configs into the repo and symlink them back");
  console.log("  3. wendway sync   — commit + push (add an 'origin' remote first for cross-machine sync)");
}
