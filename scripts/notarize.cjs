/**
 * electron-builder `afterSign` hook: notarises the app with Apple's notary
 * service. It only runs when credentials are present, so unsigned local builds
 * keep working.
 *
 * Required environment variables (create an app-specific password at
 * https://appleid.apple.com):
 *   APPLE_ID                  your Apple ID e-mail
 *   APPLE_APP_SPECIFIC_PASSWORD
 *   APPLE_TEAM_ID             10-character Team ID
 *
 * Signing itself is handled by electron-builder: set CSC_LINK/CSC_KEY_PASSWORD
 * (exported .p12) or CSC_NAME (certificate in the login keychain).
 */
const { notarize } = require('@electron/notarize')

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context

  if (electronPlatformName !== 'darwin') return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, CSC_LINK, CSC_NAME } = process.env

  // Notarisation only makes sense for a signed build with credentials available.
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      '[notarize] skipped — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID to notarise this build.'
    )
    return
  }
  if (!CSC_LINK && !CSC_NAME) {
    console.log('[notarize] skipped — no signing certificate configured (CSC_LINK or CSC_NAME).')
    return
  }

  const appName = packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`[notarize] submitting ${appPath}`)
  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID
  })
  console.log('[notarize] done — the build is ready to distribute.')
}
