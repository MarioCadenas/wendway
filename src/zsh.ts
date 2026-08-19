import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TEMPLATES_PATH } from './constants.js';

const ZSH_PATH = os.homedir();
const ZSH_TEMPLATES_PATH = path.join(TEMPLATES_PATH, 'zsh');

// Seeds the per-machine zsh files (.zshrc_personal, .zshrc_work). These are NOT
// synced via the dotfiles repo — .zshrc (which is synced) sources them conditionally,
// so each machine keeps its own. The shared .zshrc/.zshenv/.zprofile live in the
// dotfiles repo as symlinks; we skip any destination that is already a symlink so a
// re-run never writes a stale copy back through the link into the repo.
export function copyZshFiles() {
    const files = fs.readdirSync(ZSH_TEMPLATES_PATH);

    for (const file of files) {
        const source = path.join(ZSH_TEMPLATES_PATH, file);
        const dest = path.join(ZSH_PATH, file);

        if (fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink()) {
            console.log(`⏭️  Skipping ${file} (symlinked to the dotfiles repo)`);
            continue;
        }

        fs.copyFileSync(source, dest);

        console.log(`✅ Successfully copied ${file} to ${dest}`);
    }
}
