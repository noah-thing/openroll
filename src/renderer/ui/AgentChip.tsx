import { useEffect, useRef, useState } from "react";
import type { AgentClient } from "../../shared/agent-protocol";
import { Icon } from "./kit/Icon";

/** Who is editing besides you. Quiet unless something is connected. */
export function AgentChip() {
  const [clients, setClients] = useState<AgentClient[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.openroll.agent.clients().then(setClients);
    return window.openroll.agent.onClients(setClients);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!clients.length) return null;
  const names = [...new Set(clients.map(c => c.name))];
  return (
    <div className="agent-chip-wrap no-drag" ref={ref}>
      <button className="agent-chip" onClick={() => setOpen(o => !o)} title="AI tools editing this project" aria-expanded={open}>
        <Icon name="sparkle" size={14} />
        {names.length === 1 ? `${names[0]} connected` : `${names.length} AI tools connected`}
      </button>
      {open && (
        <div className="agent-pop" role="dialog" aria-label="Connected AI tools">
          <p>Changes they make show up here as they happen, and Undo takes them back like your own.</p>
          {clients.map(c => (
            <div key={c.id} className="agent-row">
              <span>{c.name}</span>
              <button className="textbtn" onClick={() => void window.openroll.agent.disconnect(c.id)}>
                Disconnect
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
