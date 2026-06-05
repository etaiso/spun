// electron-builder afterSign hook: notarize the macOS app.
// No-op unless APPLE_ID is set, so unsigned local/dev builds still complete.
// Required env for a real notarized build:
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//   (plus CSC_LINK / CSC_KEY_PASSWORD for the Developer ID cert)
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;
  if (!process.env.APPLE_ID) {
    console.log('notarize: APPLE_ID not set — skipping (unsigned build)');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  await notarize({
    appBundleId: 'com.spun.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
