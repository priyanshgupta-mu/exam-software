const { exec } = require('child_process')
const path = require('path')

// After packing on macOS, remove the quarantine attribute and fix permissions
// so the unsigned app can be opened without "can't be opened" errors.
exports.default = async function (context) {
  if (process.platform !== 'darwin') return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  await new Promise((resolve) => {
    // Remove quarantine extended attribute
    exec(`xattr -cr "${appPath}"`, () => {
      // Fix executable permissions
      exec(`chmod -R 755 "${appPath}"`, () => {
        resolve()
      })
    })
  })
}
