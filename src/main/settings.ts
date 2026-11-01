import { app } from "electron";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeSettings, type Settings } from "../shared/settings";
import { renameBusy } from "./fs-retry";

let current: Settings | null = null;

function file(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function getSettings(): Settings {
  if (current) return current;
  try {
    current = sanitizeSettings(JSON.parse(readFileSync(file(), "utf8")));
  } catch {
    current = sanitizeSettings(null);
  }
  return current;
}

export async function updateSettings(patch: unknown): Promise<Settings> {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  // Run the merged object back through sanitize so a bad value from the page cannot land on disk.
  current = sanitizeSettings({ ...getSettings(), ...p });
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = file() + ".tmp";
  await writeFile(tmp, JSON.stringify(current, null, 2), "utf8");
  await renameBusy(tmp, file());
  return current;
}
