// electron-builder hard-excludes `node_modules` from extraResources, so the
// bundled Next standalone server would ship with no dependencies (and a dangling
// better-sqlite3 symlink under .next/ that breaks code signing). Copy the
// standalone's node_modules into Resources/app/node_modules here — afterPack
// runs once files are staged but BEFORE signing, so the symlink resolves and the
// server can actually run.
const path = require('node:path');
const fs = require('node:fs');

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const resourcesApp =
    process.platform === 'darwin'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app')
      : path.join(appOutDir, 'resources', 'app');

  const src = path.join(packager.projectDir, '.next', 'standalone', 'node_modules');
  const dest = path.join(resourcesApp, 'node_modules');
  if (!fs.existsSync(src)) {
    console.warn('afterPack: .next/standalone/node_modules missing — run `next build` first');
    return;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`afterPack: copied standalone node_modules → ${dest}`);
};
