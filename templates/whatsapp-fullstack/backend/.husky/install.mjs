// husky only installs from the root of the git repository. In a generated project
// the backend usually sits in a subfolder (backend/ next to frontend/), and before
// `git init` there is no repository at all: then there is nothing to install.
import { execSync } from 'node:child_process';
import path from 'node:path';

let root;
try {
  root = execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  process.exit(0);
}

const { default: husky } = await import('husky');
const hooksDir = path.relative(root, path.resolve('.husky')).split(path.sep).join('/');
process.chdir(root);
const message = husky(hooksDir);
if (message) console.log(message);
