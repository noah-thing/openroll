/**
 * The file that starts OpenRoll again. An AppImage runs from a mount that changes on every launch and a
 * portable exe from a temporary folder, so their own execPath is useless in a saved command.
 */
export function launcherPath(execPath: string, env: Record<string, string | undefined>): string {
  return env.APPIMAGE || env.PORTABLE_EXECUTABLE_FILE || execPath;
}
