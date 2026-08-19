#!/usr/bin/env node
// Identify as wendway in ps / Activity Monitor instead of the default "node".
process.title = 'wendway';
import {Command} from 'commander';
import {link} from './dotfiles/link.js';
import {unlink} from './dotfiles/unlink.js';
import {sync} from './dotfiles/sync.js';
import {status} from './dotfiles/status.js';
import {verify} from './dotfiles/verify.js';
import {installAgent, uninstallAgent} from './launchd.js';
import {bootstrap} from './bootstrap.js';
import {init} from './dotfiles/init.js';
import {machineLabel, setMachineLabel} from './config.js';

const program = new Command();

program
  .name('wendway')
  .description('Set up a Mac and keep shared config files in sync across machines');

program
  .command('init')
  .description('Create the dotfiles repo (if needed) and write a starter manifest.json')
  .action(init);

program
  .command('bootstrap')
  .description('Full new-machine setup: machine-specific configs, link dotfiles, install autosync')
  .action(bootstrap);

program
  .command('link')
  .description('Symlink shared dotfiles into the dotfiles repo')
  .argument('[names...]', 'only link these manifest entries (e.g. link herdr)')
  .option('--dry-run', 'preview actions without changing anything')
  .option('--force', 'when a config exists both locally and in the repo, back up the local copy and use the repo version')
  .action((names: string[], opts: {dryRun?: boolean; force?: boolean}) => {
    link({dryRun: Boolean(opts.dryRun), only: names, force: Boolean(opts.force)});
  });

program
  .command('unlink')
  .description('Restore real files and stop symlinking the named configs')
  .argument('<names...>', 'manifest entries to unlink')
  .option('--remove', 'also delete from the dotfiles repo + manifest (syncs the removal)')
  .option('--dry-run', 'preview actions without changing anything')
  .action((names: string[], opts: {remove?: boolean; dryRun?: boolean}) => {
    unlink({names, remove: Boolean(opts.remove), dryRun: Boolean(opts.dryRun)});
  });

program
  .command('sync')
  .description('Commit + pull --rebase + push shared dotfiles')
  .action(() => {
    sync();
  });

program
  .command('status')
  .description('Show link state and repo sync position')
  .action(status);

program
  .command('verify')
  .description('Check every expected symlink resolves to an existing repo file')
  .action(() => {
    const ok = verify();
    if (!ok) process.exitCode = 1;
  });

const autosync = program
  .command('autosync')
  .description('Manage the background sync agent');
autosync
  .command('install')
  .description('Install the launchd agent (sync every 15 min + on wake)')
  .action(installAgent);
autosync
  .command('uninstall')
  .description('Remove the launchd agent')
  .action(uninstallAgent);

program
  .command('machine')
  .description("Show or set this machine's label (used in sync commit messages)")
  .argument('[name...]', 'set the label; omit to show the current one')
  .action((name: string[]) => {
    if (name.length) {
      const label = name.join(' ');
      setMachineLabel(label);
      console.log(`Machine label set to "${label}".`);
    } else {
      const current = machineLabel();
      console.log(current ? `Machine label: ${current}` : 'No machine label set.');
    }
  });

// Reject unknown commands instead of silently doing nothing.
program.showHelpAfterError();

// No subcommand → show help; otherwise dispatch normally.
if (process.argv.length <= 2) {
  program.help();
} else {
  program.parseAsync();
}
