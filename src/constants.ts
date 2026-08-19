import * as path from 'path';
import { dotfilesRepo } from './config.js';

export const TEMPLATES_PATH = path.join(dotfilesRepo(), 'provision', 'templates');
