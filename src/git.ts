import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { replaceTemplate } from './utils.js';
import { TEMPLATES_PATH } from './constants.js';
import { settings } from './dotfiles/manifest.js';

// Public signing keys pulled from 1Password, injected into the git identity templates.
// The op:// references and account come from manifest settings.signingKeys.
function readSigningKeys() {
    const keys = settings().signingKeys ?? {};
    const account = keys.account ? ` --account ${keys.account}` : '';
    // No ref configured → empty key (commit signing effectively off for that identity).
    const read = (ref?: string) =>
        ref ? execSync(`op read "${ref}"${account}`).toString().trim() : '';
    return {
        workSigningKey: read(keys.work),
        personalSigningKey: read(keys.personal),
    };
}

const GIT_PATH = os.homedir();
const GIT_TMP_PATH = path.join(os.tmpdir(), 'git-templates');
const GIT_TEMPLATES_PATH = path.join(TEMPLATES_PATH, 'git');

export function generateGitConfigs(config: any) {
    const { publicGithubUser, workEmail, nameAndSurname } = config;
    const { workSigningKey, personalSigningKey } = readSigningKeys();
    const replacement = {
        publicGithubUser,
        workEmail,
        nameAndSurname,
        workSigningKey,
        personalSigningKey,
    };
    const files = fs.readdirSync(GIT_TEMPLATES_PATH);

    if (!fs.existsSync(GIT_TMP_PATH)) {
        fs.mkdirSync(GIT_TMP_PATH);
    }

    for (const file of files) {
        const source = path.join(GIT_TEMPLATES_PATH, file);
        const gitTemplate = fs.readFileSync(source).toString();
        const fileName = file.replace('-template', '');
        const preparedFile = replaceTemplate(gitTemplate, replacement);

        fs.writeFileSync(path.join(GIT_TMP_PATH, fileName), preparedFile);
    }

    return () => {
        const files = fs.readdirSync(GIT_TMP_PATH);

        for (const file of files) {
            const fileContent = fs.readFileSync(path.join(GIT_TMP_PATH, file)).toString();

            console.log(`----- ${file} ----\n`);
            console.log(fileContent);
            console.log(`------${'-'.repeat(file.length - 1)}-------\n`);
            console.log('')
        }
    }
}

export function copyGitConfigs() {
    try {
        const files = fs.readdirSync(GIT_TMP_PATH);

        for (const file of files) {
            const source = path.join(GIT_TMP_PATH, file);
            const dest = path.join(GIT_PATH, file);
    
            fs.copyFileSync(source, dest);
    
            console.log(`✅ Successfully copied ${file} to ${dest}`);
        }
    } catch (error) {
        console.error('❌ There was an error copying git configurations.', error);
    }
}