import * as fs from 'fs';
import { expandHome } from './config.js';
import { settings } from './dotfiles/manifest.js';

const DEFAULT_WORKSPACE = ['~/Developer', '~/Developer/personal', '~/Developer/work'];

export default function createWorkspace() {
    const dirs = (settings().workspace ?? DEFAULT_WORKSPACE).map(expandHome);

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            console.log(`Creating directory ${dir} ...`);
            fs.mkdirSync(dir, { recursive: true });
        } else {
            console.log(`${dir} already exists.`);
        }
    }
}
