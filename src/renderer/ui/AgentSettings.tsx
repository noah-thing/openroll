import { useEffect, useState } from "react";

interface Tool {
  name: string;
  how: string;
  text: string;
}

function quote(s: string): string {
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/** Copyable setup for the common AI tools, built from where this copy of OpenRoll lives. */
export function AgentConnect() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void window.openroll.agent.connectInfo().then(({ executable, args }) => {
      const cmd = [executable, ...args].map(quote).join(" ");
      setTools([
        { name: "Claude Code", how: "Run in a terminal:", text: `claude mcp add openroll -- ${cmd}` },
        { name: "Codex", how: "Run in a terminal:", text: `codex mcp add openroll -- ${cmd}` },
        { name: "Cursor and others", how: "Add to the tool's MCP settings:", text: JSON.stringify({ mcpServers: { openroll: { command: executable, args } } }, null, 2) },
      ]);
    });
  }, []);

  async function copy(t: Tool) {
    try {
      await navigator.clipboard.writeText(t.text);
      setCopied(t.name);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="agent-connect">
      {tools.map(t => (
        <div key={t.name} className="agent-tool">
          <div className="agent-tool-head">
            <b>{t.name}</b>
            <small>{t.how}</small>
            <button className="textbtn" onClick={() => void copy(t)}>
              {copied === t.name ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="agent-cmd">{t.text}</pre>
        </div>
      ))}
    </div>
  );
}
