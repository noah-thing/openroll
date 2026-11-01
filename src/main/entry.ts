// One binary, two jobs: the editor, or (with --mcp) a bridge an AI tool talks to.
if (process.argv.includes("--mcp")) {
  void import("./mcp").then(m => m.runMcp());
} else {
  void import("./main");
}
