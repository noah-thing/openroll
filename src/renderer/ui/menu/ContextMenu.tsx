import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keyCaps } from "../../state/commands";
import { Icon, type IconName } from "../kit/Icon";
import "./menu.css";

export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      /** Key descriptor from the command table, shown on the right. */
      keys?: string;
      icon?: IconName;
      swatch?: string;
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      onSelect?(): void;
      items?: MenuItem[];
    };

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** One menu at a time, opened from a pointer event. */
export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const open = useCallback((e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation?(): void }, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation?.();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  const openAt = useCallback((x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }), []);
  const close = useCallback(() => setMenu(null), []);
  const element = menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} /> : null;
  return { open, openAt, close, element, isOpen: !!menu };
}

export function ContextMenu({ x, y, items, onClose }: MenuState & { onClose(): void }) {
  const restore = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".ctxmenu")) onClose();
    };
    const quiet = () => onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", quiet);
    window.addEventListener("resize", quiet);
    window.addEventListener("wheel", quiet, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", quiet);
      window.removeEventListener("resize", quiet);
      window.removeEventListener("wheel", quiet);
      (restore.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return createPortal(<Panel x={x} y={y} items={items} onClose={onClose} root />, document.body);
}

interface PanelProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
  /** For submenus: step back to the parent. */
  onBack?(): void;
  root?: boolean;
  /** For submenus anchored to a row: x to flip to when there is no room on the right. */
  flipX?: number;
}

function Panel({ x, y, items, onClose, onBack, root, flipX }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const [openSub, setOpenSub] = useState(-1);
  const mac = window.openroll.platform === "darwin";

  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > innerWidth - 8) left = flipX !== undefined ? flipX - r.width : Math.max(8, innerWidth - r.width - 8);
    if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    setPos({ left, top });
    el.focus({ preventScroll: true });
    if (!root) setActive(items.findIndex(isEnabled));
  }, [x, y, flipX, items, root]);

  const move = (dir: 1 | -1, from = active) => {
    const n = items.length;
    for (let step = 1; step <= n; step++) {
      const i = (((from + dir * step) % n) + n) % n;
      if (isEnabled(items[i])) return setActive(i);
    }
  };

  const choose = (i: number) => {
    const it = items[i];
    if (!it || it.separator || it.disabled) return;
    if (it.items) {
      setOpenSub(i);
      return;
    }
    onClose();
    // Run after the menu is gone so focus restore does not fight what the action opens.
    queueMicrotask(() => it.onSelect?.());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown") move(1);
    else if (k === "ArrowUp") move(-1, active < 0 ? 0 : active);
    else if (k === "Home") move(1, -1);
    else if (k === "End") move(-1, 0);
    else if (k === "ArrowRight") {
      const it = items[active];
      if (it && !it.separator && it.items) setOpenSub(active);
      else return;
    } else if (k === "ArrowLeft") {
      if (openSub >= 0) setOpenSub(-1);
      else if (onBack) onBack();
      else return;
    } else if (k === "Enter" || k === " ") choose(active);
    else if (k === "Escape") {
      if (openSub >= 0) setOpenSub(-1);
      else if (onBack) onBack();
      else onClose();
    } else if (k === "Tab") onClose();
    else if (k.length === 1 && /\S/.test(k)) {
      const n = items.length;
      for (let step = 1; step <= n; step++) {
        const i = (active + step + n) % n;
        const it = items[i];
        if (!it.separator && isEnabled(it) && it.label.toLowerCase().startsWith(k.toLowerCase())) return void setActive(i), e.preventDefault();
      }
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} className={"ctxmenu" + (root ? " ctxmenu-root" : " ctxmenu-sub")} role="menu" tabIndex={-1} style={pos} onKeyDown={onKeyDown} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <div
            key={i}
            role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={it.checked}
            aria-disabled={it.disabled || undefined}
            aria-haspopup={it.items ? "menu" : undefined}
            aria-expanded={it.items ? openSub === i : undefined}
            className={"ctx-item" + (active === i ? " on" : "") + (it.disabled ? " off" : "") + (it.danger ? " danger" : "")}
            onPointerEnter={() => {
              if (it.disabled) return;
              setActive(i);
              setOpenSub(it.items ? i : -1);
            }}
            onClick={() => choose(i)}
          >
            <span className="ctx-lead">
              {it.checked ? <Icon name="check" size={14} /> : it.swatch ? <span className="ctx-swatch" style={{ background: it.swatch }} /> : it.icon ? <Icon name={it.icon} size={15} /> : null}
            </span>
            <span className="ctx-label">{it.label}</span>
            {it.keys && (
              <span className="ctx-keys">
                {keyCaps(it.keys, mac).map((c, j) => (
                  <kbd key={j}>{c}</kbd>
                ))}
              </span>
            )}
            {it.items && <Icon name="chevron" size={13} className="ctx-more" />}
            {it.items && openSub === i && <SubPanel anchor={ref} row={items.slice(0, i).filter(x => !x.separator).length} items={it.items} onClose={onClose} onBack={() => setOpenSub(-1)} />}
          </div>
        ),
      )}
    </div>
  );
}

function SubPanel({ anchor, row, items, onClose, onBack }: { anchor: React.RefObject<HTMLDivElement | null>; row: number; items: MenuItem[]; onClose(): void; onBack(): void }) {
  const [rect, setRect] = useState<{ x: number; y: number; flip: number } | null>(null);
  useLayoutEffect(() => {
    const parent = anchor.current!;
    const r = (parent.querySelectorAll<HTMLElement>(":scope > .ctx-item")[row] ?? parent).getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    setRect({ x: p.right - 4, y: r.top - 6, flip: p.left + 4 });
  }, [anchor, row]);
  if (!rect) return null;
  return createPortal(<Panel x={rect.x} y={rect.y} flipX={rect.flip} items={items} onClose={onClose} onBack={onBack} />, document.body);
}

function isEnabled(it: MenuItem): boolean {
  return !it.separator && !it.disabled;
}
