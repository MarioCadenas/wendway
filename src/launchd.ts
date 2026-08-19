import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { CLI_ROOT } from "./dotfiles/paths.js";

const LABEL = "com.wendway.autosync";
const AGENTS_DIR = path.join(os.homedir(), "Library", "LaunchAgents");
const PLIST_PATH = path.join(AGENTS_DIR, `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), "Library", "Logs");
const OUT_LOG = path.join(LOG_DIR, "wendway-autosync.log");

// 15 minutes. launchd coalesces intervals missed during sleep and fires once on wake.
const INTERVAL_SECONDS = 900;

// Skip the real `launchctl` load/unload — the plist is still written/removed. Set for
// sandboxed e2e runs (a redirected $HOME can't sandbox launchctl, which always targets
// the real user's launchd domain) and for environments without launchd (CI, containers).
const skipLaunchctl = () => Boolean(process.env.WENDWAY_SKIP_LAUNCHCTL);

// argv for the agent's `sync`, matching how this process runs: tsx on a .ts entry
// in dev, plain node on the compiled .js entry when installed.
function syncCommand(): string[] {
  const nodeBin = process.execPath; // nvm-aware
  // Resolve to absolute: argv[1] may be relative or a bin symlink, but the plist
  // (loaded by launchd with a different cwd) needs an absolute entry path.
  const entry = path.resolve(process.argv[1] ?? path.join(CLI_ROOT, "dist", "index.js"));

  if (entry.endsWith(".ts")) {
    return [nodeBin, "--import", "tsx", entry, "sync"];
  }
  return [nodeBin, entry, "sync"];
}

function plistBody(): string {
  const args = syncCommand();
  const argXml = args.map((a) => `    <string>${a}</string>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${CLI_ROOT}</string>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${OUT_LOG}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

export function installAgent() {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  // Unload a previous version if present, so the new plist takes effect.
  if (fs.existsSync(PLIST_PATH) && !skipLaunchctl()) {
    try {
      execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
    } catch {
      /* not loaded — fine */
    }
  }

  fs.writeFileSync(PLIST_PATH, plistBody());

  if (skipLaunchctl()) {
    console.log(`⏭️  Skipping launchctl load (WENDWAY_SKIP_LAUNCHCTL set). Plist written to ${PLIST_PATH}.`);
    return;
  }
  execFileSync("launchctl", ["load", PLIST_PATH], { stdio: "inherit" });

  console.log(`✅ Autosync agent installed (${LABEL}).`);
  console.log(`   Runs every ${INTERVAL_SECONDS / 60} min. Logs: ${OUT_LOG}`);
}

export function uninstallAgent() {
  if (!fs.existsSync(PLIST_PATH)) {
    console.log("Autosync agent not installed.");
    return;
  }
  if (!skipLaunchctl()) {
    try {
      execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
    } catch {
      /* already unloaded */
    }
  }
  fs.unlinkSync(PLIST_PATH);
  console.log(`✅ Autosync agent removed (${LABEL}).`);
}
