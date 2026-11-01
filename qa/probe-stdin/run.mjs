// Spawns Electron the way an MCP client does (piped stdio), writes a line, reports what came back.
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import electron from "electron";

const logFile = join(tmpdir(), "probe-stdin.log");
rmSync(logFile, { force: true });
for (const mode of ["stdin", "fd", "utility"]) {
  const out = await new Promise(res => {
    const p = spawn(electron, [resolve(import.meta.dirname), `--mode=${mode}`], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PROBE_LOG: logFile } });
    let stdout = "", stderr = "";
    p.stdout.on("data", d => (stdout += d));
    p.stderr.on("data", d => (stderr += d));
    setTimeout(() => p.stdin.write("hello from the client\n"), 1500);
    p.on("exit", code => res({ code, stdout, stderr: stderr.slice(-300) }));
  });
  console.log(`== ${mode}: exit ${out.code}, client received ${JSON.stringify(out.stdout)}${out.stderr ? `, stderr ${JSON.stringify(out.stderr)}` : ""}`);
}
console.log("-- log from inside the app --\n" + readFileSync(logFile, "utf8"));
