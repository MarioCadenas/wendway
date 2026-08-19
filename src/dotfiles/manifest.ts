import fs from "node:fs";
import path from "node:path";
import { dotfilesRepo, expandHome } from "../config.js";

// A shared dotfile entry, stored as data in the repo's manifest.json.
// - "dir": symlink the whole `target` directory into `<repo>/<name>`; `ignore` becomes its .gitignore.
// - "files": symlink only `files` individually, leaving `target` a real directory (for dirs that also hold state).
// `target` may start with `~`.
export interface DotfileEntry {
  name: string;
  target: string;
  mode: "dir" | "files";
  files?: string[];
  ignore?: string[];
}

// Personal, behaviour-driving values that used to be hardcoded in the engine.
// All optional — the engine falls back to sensible defaults when a field is absent.
export interface Settings {
  // Directories `createWorkspace` ensures exist.
  workspace?: string[];
  // 1Password references for git commit-signing keys, injected into the git templates.
  signingKeys?: {
    account?: string;
    personal?: string;
    work?: string;
  };
}

interface Manifest {
  version: number;
  entries: DotfileEntry[];
  settings?: Settings;
}

const MANIFEST_VERSION = 1;

// Seed for a first-ever repo init; you populate manifest.json yourself.
const EMPTY_MANIFEST: Manifest = {
  version: MANIFEST_VERSION,
  entries: [],
};

// Starter manifest for `init`. The example target doesn't exist, so `link` is a no-op until edited.
const SCAFFOLD_MANIFEST: Manifest = {
  version: MANIFEST_VERSION,
  entries: [
    {
      name: "my-tool",
      target: "~/.config/my-tool",
      mode: "dir",
      ignore: ["*.log", "cache/"],
    },
  ],
  settings: {
    workspace: ["~/Developer", "~/Developer/personal", "~/Developer/work"],
  },
};

export function manifestPath(): string {
  return path.join(dotfilesRepo(), "manifest.json");
}

function readManifest(): Manifest {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `No manifest at ${file}. Run \`wendway init\` to create one.`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Entries with `~` expanded in targets, for filesystem use.
export function loadManifest(): DotfileEntry[] {
  return readManifest().entries.map((e) => ({ ...e, target: expandHome(e.target) }));
}

// Entries as stored (targets keep `~`); use when rewriting the manifest so absolute paths aren't persisted.
export function loadRawEntries(): DotfileEntry[] {
  return readManifest().entries;
}

// Manifest settings, with defaults applied. Tolerates a missing manifest (returns
// {}) so settings-driven commands like `createWorkspace` still work before the repo
// exists — the callers' own fallbacks then take over.
export function settings(): Settings {
  try {
    return readManifest().settings ?? {};
  } catch {
    return {};
  }
}

export function writeManifest(m: Manifest = EMPTY_MANIFEST) {
  fs.writeFileSync(manifestPath(), JSON.stringify(m, null, 2) + "\n");
}

export function writeScaffoldManifest() {
  writeManifest(SCAFFOLD_MANIFEST);
}

export function writeManifestEntries(entries: DotfileEntry[]) {
  writeManifest({ version: readManifest().version ?? MANIFEST_VERSION, entries });
}
