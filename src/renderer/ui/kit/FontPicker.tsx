import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FONT_CATEGORIES, FONTS, fontInfo, fontStack, fontWeights } from "../../../core/fonts";
import { Icon } from "./Icon";

interface Entry {
  family: string;
  group: string;
}

const MAX_HEIGHT = 340;

/** "400 to 700", or "One weight" for faces that only come in regular. */
export function weightNote(family: string): string {
  const w = fontWeights(family);
  return w.length === 1 ? "One weight" : `${w[0]} to ${w[w.length - 1]}`;
}

/**
 * A drop down that shows every font in its own face. It is a listbox in a portal so the
 * inspector's scrolling cannot clip it; arrow keys, Home, End and typing a name all work.
 */
export function FontPicker({ value, onChange }: { value: string; onChange(family: string): void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  const label = fontInfo(value)?.family ?? value.split(",")[0].replace(/"/g, "").trim();

  return (
    <div className="font-picker">
      <button
        ref={trigger}
        className="font-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Font, ${label}`}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <span style={{ fontFamily: fontStack(value) }}>{label}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <List
          id={id}
          value={value}
          anchor={trigger.current!}
          onPick={family => {
            setOpen(false);
            trigger.current?.focus();
            if (family !== value) onChange(family);
          }}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function List({ id, value, anchor, onPick, onClose }: { id: string; value: string; anchor: HTMLElement; onPick(family: string): void; onClose(): void }) {
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    // A project from before the picker may use a system font; keep it selectable so opening the list does not lose it.
    if (!fontInfo(value)) out.push({ family: value, group: "In this project" });
    for (const c of FONT_CATEGORIES) for (const f of FONTS) if (f.category === c.id) out.push({ family: f.family, group: c.label });
    return out;
  }, [value]);

  const [active, setActive] = useState(Math.max(0, entries.findIndex(e => e.family === value)));
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    const height = Math.min(MAX_HEIGHT, up ? above : below);
    setBox({ left: r.left, width: r.width, height, top: up ? r.top - height - 4 : r.bottom + 4 });
  }, [anchor]);

  // A hidden element cannot take focus, so wait until the list has a place.
  useEffect(() => {
    if (box) listRef.current?.focus({ preventScroll: true });
  }, [box]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest?.(".font-list") && !anchor.contains(t)) onClose();
    };
    const quiet = () => onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", quiet);
    window.addEventListener("resize", quiet);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", quiet);
      window.removeEventListener("resize", quiet);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  function key(e: React.KeyboardEvent) {
    const last = entries.length - 1;
    const go = (i: number) => setActive(Math.min(last, Math.max(0, i)));
    switch (e.key) {
      case "ArrowDown":
        go(active + 1);
        break;
      case "ArrowUp":
        go(active - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(last);
        break;
      case "PageDown":
        go(active + 6);
        break;
      case "PageUp":
        go(active - 6);
        break;
      case "Enter":
      case " ":
        onPick(entries[active].family);
        break;
      case "Escape":
      case "Tab":
        onClose();
        break;
      default: {
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
        const now = performance.now();
        const t = typed.current;
        t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
        t.at = now;
        const hit = entries.findIndex(en => en.family.toLowerCase().startsWith(t.text));
        if (hit >= 0) setActive(hit);
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }

  let lastGroup = "";
  return createPortal(
    <div
      ref={listRef}
      className="font-list"
      role="listbox"
      tabIndex={-1}
      aria-label="Fonts"
      aria-activedescendant={`${id}-${active}`}
      style={box ? { left: box.left, top: box.top, width: Math.max(box.width, 240), maxHeight: box.height } : { visibility: "hidden" }}
      onKeyDown={key}
    >
      {entries.map((en, i) => {
        const heading = en.group !== lastGroup ? en.group : null;
        lastGroup = en.group;
        const name = fontInfo(en.family)?.family ?? en.family.split(",")[0];
        return (
          <Fragment key={en.family}>
            {heading && (
              <div className="font-group" role="presentation">
                {heading}
              </div>
            )}
            <div
              id={`${id}-${i}`}
              role="option"
              aria-selected={en.family === value}
              className={"font-option" + (i === active ? " active" : "")}
              onPointerEnter={() => setActive(i)}
              onClick={() => onPick(en.family)}
            >
              <span className="font-name" style={{ fontFamily: fontStack(en.family) }}>
                {name}
              </span>
              <span className="font-weights">{fontInfo(en.family) ? weightNote(en.family) : "System font"}</span>
              {en.family === value && <Icon name="check" size={12} />}
            </div>
          </Fragment>
        );
      })}
    </div>,
    document.body,
  );
}
