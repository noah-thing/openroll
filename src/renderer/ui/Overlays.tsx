import { useEffect, useState } from "react";
import { AboutDialog } from "./AboutDialog";
import { ReportDialog } from "./ReportDialog";
import { SettingsDialog } from "./SettingsDialog";
import { UpdateNotice } from "./UpdateNotice";
import { NewsPopup, NewsToasts, WhatsNewDialog } from "./Inbox";
import { inbox } from "../state/inbox";

type Which = "settings" | "report" | "about" | null;

/** Dialogs the menu can open from any screen, and the update notice. */
export function Overlays() {
  const [open, setOpen] = useState<Which>(null);
  useEffect(() => inbox.start(), []);

  useEffect(
    () =>
      window.openroll.onMenu(cmd => {
        if (cmd === "settings" || cmd === "report" || cmd === "about") setOpen(cmd);
      }),
    [],
  );

  useEffect(() => {
    // Cmd+, on macOS arrives through the menu; Ctrl+, is the same on the other systems.
    const onKey = (e: KeyboardEvent) => {
      const mod = window.openroll.platform === "darwin" ? e.metaKey : e.ctrlKey;
      if (mod && e.key === ",") {
        e.preventDefault();
        setOpen("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => setOpen(null);
  return (
    <>
      <UpdateNotice />
      <NewsToasts />
      <WhatsNewDialog />
      <NewsPopup />
      {open === "settings" && <SettingsDialog onClose={close} />}
      {open === "report" && <ReportDialog onClose={close} />}
      {open === "about" && <AboutDialog onClose={close} onReport={() => setOpen("report")} />}
    </>
  );
}
