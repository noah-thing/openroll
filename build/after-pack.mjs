// Flips Electron fuses on the packed app, before it is zipped or put in an installer.
// Anything that lets a plain node flag or environment variable change what the app runs is off.
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";
import { join } from "node:path";

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const name = packager.appInfo.productFilename;
  const exe =
    electronPlatformName === "darwin" ? join(appOutDir, `${name}.app`, "Contents", "MacOS", name) :
    electronPlatformName === "win32" ? join(appOutDir, `${name}.exe`) :
    join(appOutDir, packager.executableName);

  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    // Flipping a fuse breaks the ad hoc signature Apple silicon needs to launch an unsigned build.
    resetAdHocDarwinSignature: electronPlatformName === "darwin",
  });
}
