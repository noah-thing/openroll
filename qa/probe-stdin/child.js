const fs = require("node:fs");
const log = m => fs.appendFileSync(process.env.PROBE_LOG, `[utility child] ${m}\n`);
let got = "";
process.stdin.on("data", d => {
  got += d;
  if (got.includes("\n")) { log(`data ${JSON.stringify(got)}`); process.stdout.write(`echo:${got}`, () => process.exit(0)); }
});
process.stdin.on("end", () => { log(`end, had ${JSON.stringify(got)}`); process.exit(0); });
process.stdin.on("error", e => { log(`error ${e.message}`); process.exit(0); });
