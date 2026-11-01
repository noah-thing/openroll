import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
import { bundleMain } from "./bundle.mjs";

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const url = server.resolvedUrls.local[0];

let child = null;
let restarting = false;

function launch() {
  child = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, OPENROLL_DEV_URL: url } });
  child.on("exit", code => {
    if (restarting) return;
    server.close();
    process.exit(code ?? 0);
  });
}

let first = true;
await bundleMain({
  watch: true,
  onRebuild() {
    if (first) return;
    restarting = true;
    child?.kill();
    setTimeout(() => {
      restarting = false;
      launch();
    }, 300);
  },
});
first = false;
launch();
