// One binary, two jobs: the editor, or (with --mcp) a bridge an AI tool talks to.
import { app } from "electron";

if (process.argv.includes("--mcp")) {
  // The bridge has no window. Without this, Linux refuses to start it when there is no display,
  // such as over SSH or when the AI tool was started outside the desktop session.
  if (process.platform === "linux") app.commandLine.appendSwitch("ozone-platform", "headless");
  void import("./mcp").then(m => m.runMcp());
} else {
  void import("./main");
}
