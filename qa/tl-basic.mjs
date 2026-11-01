import { check, openProject, project, selection } from "./lib.mjs";

export default async function ({ page, shot }) {
  await openProject(page);
  await shot("tl-00-loaded");
  const p = await project(page);
  check("three clips on the main track", p.tracks[0].items.length === 3, String(p.tracks[0].items.length));
}
