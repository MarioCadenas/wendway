import fs from "node:fs";
import path from "node:path";

export function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function symlinkResolves(link: string, expected: string): boolean {
  try {
    return path.resolve(path.dirname(link), fs.readlinkSync(link)) === path.resolve(expected);
  } catch {
    return false;
  }
}
