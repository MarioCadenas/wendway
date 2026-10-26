import { DotfileEntry } from "./manifest.js";

export type PlanAction =
  | { kind: "already-linked"; from: string; to: string }
  | { kind: "adopt-from-repo"; from: string; to: string } // repo has it, live missing → just symlink
  | { kind: "migrate"; from: string; to: string; backup: string } // move live → repo, then symlink
  | { kind: "overwrite-with-repo"; from: string; to: string; backup: string } // --force: back up live, symlink to repo
  | { kind: "union"; from: string; to: string; backup: string } // copy files the repo lacks, then symlink
  | { kind: "retarget"; from: string; to: string } // symlink pointed at another live copy → point at the repo
  | { kind: "outside"; from: string } // symlink points outside every live directory; leave it
  | { kind: "skip"; from: string; reason: string }
  | { kind: "conflict"; from: string; reason: string };

export interface PlanItem {
  entry: DotfileEntry;
  // sub-path within the entry ("" for dir mode, the file name for files mode, the child name for children mode)
  rel: string;
  action: PlanAction;
}
