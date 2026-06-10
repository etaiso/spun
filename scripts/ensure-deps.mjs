// Fresh git worktrees check out the code without node_modules (it's
// gitignored), so the preview dev server fails to boot. Install on demand
// before `next dev` when the tree has no resolvable `next` package.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (!existsSync(new URL('../node_modules/next/package.json', import.meta.url))) {
  console.log('[ensure-deps] node_modules missing — running npm install…');
  execSync('npm install --no-audit --no-fund', { stdio: 'inherit' });
}
