import path from "node:path";
import { fileURLToPath } from "node:url";

// The CLI's own install root (the engine, not the dotfiles repo), used to locate
// the entry point the launchd agent runs.
const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = path.resolve(here, "..", "..");
