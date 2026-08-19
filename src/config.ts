import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Where the CLI stores its own settings (not synced — this is per machine).
const CONFIG_DIR = path.join(os.homedir(), ".config", "wendway");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Default location of the external dotfiles repo the engine operates on.
const DEFAULT_DOTFILES_REPO = path.join(os.homedir(), ".dotfiles");

interface CliConfig {
  dotfilesRepo: string;
  // Machine name for sync commits — not the hostname, which is the serial number on managed Macs.
  machineLabel: string;
}

function read(): Partial<CliConfig> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Resolve the dotfiles repo path. Precedence: env override → config file → default.
export function dotfilesRepo(): string {
  const fromEnv = process.env.WENDWAY_DOTFILES;
  if (fromEnv) return path.resolve(expandHome(fromEnv));
  const fromFile = read().dotfilesRepo;
  if (fromFile) return path.resolve(expandHome(fromFile));
  return DEFAULT_DOTFILES_REPO;
}

export function machineLabel(): string {
  return read().machineLabel ?? "";
}

export function setMachineLabel(label: string) {
  write({ machineLabel: label });
}

function write(patch: Partial<CliConfig>) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const next = { ...read(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n");
}

export function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}
