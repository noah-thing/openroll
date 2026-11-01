// Which way can an Electron main process on Windows read what an MCP client writes to it?
const { app, utilityProcess } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const mode = process.argv.find(a => a.startsWith("--mode="))?.slice(7);
const log = m => fs.appendFileSync(process.env.PROBE_LOG, `[${mode}] ${m}\n`);
const done = () => setTimeout(() => app.exit(0), 300);
setTimeout(() => { log("timed out"); app.exit(0); }, 10000);

if (mode === "stdin") {
  let got = "";
  process.stdin.on("data", d => {
    got += d;
    if (got.includes("\n")) { log(`data ${JSON.stringify(got)}`); process.stdout.write(`echo:${got}`); done(); }
  });
  process.stdin.on("end", () => { log(`end, had ${JSON.stringify(got)}`); done(); });
  process.stdin.on("error", e => { log(`error ${e.message}`); done(); });
} else if (mode === "fd") {
  try {
    const buf = Buffer.alloc(256);
    const n = fs.readSync(0, buf);
    const s = buf.subarray(0, n).toString();
    log(`read ${n} bytes ${JSON.stringify(s)}`);
    fs.writeSync(1, `echo:${s}`);
  } catch (e) {
    log(`error ${e.code} ${e.message}`);
  }
  done();
} else if (mode === "utility") {
  app.whenReady().then(() => {
    const child = utilityProcess.fork(path.join(__dirname, "child.js"), [], { stdio: "inherit", env: process.env });
    child.on("exit", code => { log(`child exit ${code}`); done(); });
  });
}
