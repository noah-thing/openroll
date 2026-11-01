import { useRef, useState } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Value the double click resets to. */
  reset?: number;
  format?(v: number): string;
  onChange(v: number): void;
  onCommit?(): void;
}

/** Label, track and a number you can drag or type into. Double click resets. */
export function Slider({ label, value, min, max, step = 1, unit = "", reset, format, onChange, onCommit }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState(false);
  const p = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const clampStep = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const shown = format ? format(value) : `${Number.isInteger(step) ? Math.round(value) : value.toFixed(step < 0.1 ? 2 : 1)}${unit}`;

  function down(e: React.PointerEvent) {
    const el = trackRef.current!;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const set = (x: number) => onChange(clampStep(min + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (max - min)));
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      onCommit?.();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  // Dragging sideways on the number scrubs it, like in most pro tools.
  function scrub(e: React.PointerEvent) {
    if (typing) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 2) moved = true;
      const per = (max - min) / 300;
      onChange(clampStep(v0 + dx * per * (ev.shiftKey ? 0.1 : 1)));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (moved) onCommit?.();
      else setTyping(true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  return (
    <div className="field" onDoubleClick={() => reset !== undefined && (onChange(reset), onCommit?.())}>
      <span className="field-label">{label}</span>
      <div className="slider" ref={trackRef} onPointerDown={down}>
        <span className="slider-track" />
        <span className="slider-fill" style={{ width: `${p * 100}%` }} />
        <span className="slider-knob" style={{ left: `${p * 100}%` }} />
      </div>
      {typing ? (
        <input
          className="field-input num"
          autoFocus
          defaultValue={String(Math.round(value * 100) / 100)}
          onFocus={e => e.currentTarget.select()}
          onBlur={e => {
            const v = parseFloat(e.currentTarget.value);
            if (!Number.isNaN(v)) {
              onChange(clampStep(v));
              onCommit?.();
            }
            setTyping(false);
          }}
          onKeyDown={e => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setTyping(false);
          }}
        />
      ) : (
        <span className="field-value num" onPointerDown={scrub}>
          {shown}
        </span>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange(v: T): void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(o => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <button role="switch" aria-checked={value} className={"switch" + (value ? " on" : "")} onClick={() => onChange(!value)} />
    </label>
  );
}

export function Section({ title, onReset, children }: { title: string; onReset?(): void; children: React.ReactNode }) {
  return (
    <section className="group">
      <h3>
        {title}
        {onReset && (
          <button className="reset" onClick={onReset}>
            Reset
          </button>
        )}
      </h3>
      {children}
    </section>
  );
}
