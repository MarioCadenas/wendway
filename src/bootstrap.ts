import { intro, outro, text, confirm, log, isCancel, cancel } from "@clack/prompts";
import { link } from "./dotfiles/link.js";
import { installAgent } from "./launchd.js";
import { ensureDotfilesRepo, currentGitIdentity } from "./dotfiles/ensure-repo.js";
import { generateGitConfigs, copyGitConfigs } from "./git.js";
import { copyZshFiles } from "./zsh.js";
import createWorkspace from "./workspace.js";
import { dotfilesRepo, machineLabel, setMachineLabel } from "./config.js";

// Clack prompts return a cancel symbol on Ctrl-C; turn that into a clean exit.
function orCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Bootstrap cancelled.");
    process.exit(0);
  }
  return value;
}

// New-machine orchestrator: ensure the dotfiles repo, generate the per-machine git
// identity, create the workspace dirs, link the shared configs, seed the per-machine
// zsh files, install the autosync agent.
export async function bootstrap() {
  intro("Bootstrapping this machine");

  // Name this machine (used in sync commit messages). Skip if already set.
  if (!machineLabel()) {
    const label = orCancel(
      await text({
        message: "A short name for this machine (used in sync commits):",
        placeholder: "optional — press enter to skip",
        defaultValue: "",
      })
    );
    if (label.trim()) setMachineLabel(label.trim());
  }

  // 1. The dotfiles repo must exist first — the git identity templates live inside it.
  log.step(`Step 1/6 — dotfiles repo (${dotfilesRepo()})`);
  const existing = currentGitIdentity();
  const cloneUrl = orCancel(
    await text({
      message: "Clone URL for your dotfiles repo (leave blank to init a fresh one locally):",
      placeholder: "git@github.com:you/dotfiles.git",
      defaultValue: "",
    })
  );
  const name = orCancel(
    await text({
      message: "Git name for sync commits (so they're attributed to you):",
      placeholder: existing.name || undefined,
      defaultValue: existing.name,
    })
  );
  const email = orCancel(
    await text({
      message: "Git email for sync commits:",
      placeholder: existing.email || undefined,
      defaultValue: existing.email,
    })
  );
  ensureDotfilesRepo({
    cloneUrl: cloneUrl.trim() || undefined,
    name: name.trim() || undefined,
    email: email.trim() || undefined,
  });

  // 2. Per-machine git identity files (.gitconfig-personal / -work), generated from
  //    the repo's templates. Not synced — the synced .gitconfig just includes them.
  log.step("Step 2/6 — git identity (per-machine, not synced)");
  const doGit = orCancel(
    await confirm({ message: "Generate git identity files now?", initialValue: true })
  );
  if (doGit) {
    const nameAndSurname = orCancel(
      await text({ message: "Name for git commits:", placeholder: name || undefined, defaultValue: name })
    );
    const publicGithubUser = orCancel(
      await text({
        message: "Public GitHub username:",
        placeholder: existing.name || undefined,
        defaultValue: existing.name,
      })
    );
    const workEmail = orCancel(await text({ message: "Work email:", placeholder: "you@company.com" }));
    const preview = generateGitConfigs({ nameAndSurname, publicGithubUser, workEmail });
    preview();
    const save = orCancel(
      await confirm({ message: "Save these git identity files?", initialValue: true })
    );
    if (save) copyGitConfigs();
  }

  // 3. Workspace directories (~/Developer, etc.) from manifest settings.
  log.step("Step 3/6 — workspace directories");
  const doWorkspace = orCancel(
    await confirm({ message: "Create workspace directories now?", initialValue: true })
  );
  if (doWorkspace) {
    createWorkspace();
  }

  log.step("Step 4/6 — link shared dotfiles");
  // Preview first, then confirm before touching live files.
  link({ dryRun: true });
  const doLink = orCancel(await confirm({ message: "Apply these links now?", initialValue: true }));
  if (doLink) {
    link({ dryRun: false });
  }

  // 5. Seed per-machine zsh files (.zshrc_personal / -work), sourced by the synced
  //    .zshrc. Runs after linking so any shared zsh files that just became symlinks
  //    are skipped rather than overwritten with a stale template copy.
  log.step("Step 5/6 — zsh per-machine files");
  const doZsh = orCancel(
    await confirm({ message: "Seed per-machine zsh files now?", initialValue: true })
  );
  if (doZsh) {
    copyZshFiles();
  }

  log.step("Step 6/6 — background autosync");
  const doAgent = orCancel(
    await confirm({
      message: "Install the launchd agent to auto push/pull configs?",
      initialValue: true,
    })
  );
  if (doAgent) {
    installAgent();
  }

  outro("Bootstrap complete.");
}
