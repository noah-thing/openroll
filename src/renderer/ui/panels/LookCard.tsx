import { useEffect, useRef } from "react";

interface Props {
  name: string;
  active?: boolean;
  /** Draw the resting picture, and a moving one while the pointer is over the card. */
  paint(canvas: HTMLCanvasElement, t: number | null): void;
  /** Redraw the resting picture when this changes: the footage, the project LUTs. */
  deps: unknown[];
  onPick(): void;
  drag?: { type: string; value: string };
  title?: string;
}

/** A preview card. The picture is the user's own footage, and moves while hovered. */
export function LookCard({ name, active, paint, deps, onPick, drag, title }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    paintRef.current(ref.current!, null);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  function play() {
    const start = performance.now();
    const tick = (now: number) => {
      paintRef.current(ref.current!, (now - start) / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(raf.current);
    paintRef.current(ref.current!, null);
  }

  return (
    <button
      className={"fx-card" + (active ? " on" : "")}
      title={title}
      onClick={onPick}
      onPointerEnter={play}
      onPointerLeave={stop}
      draggable={!!drag}
      onDragStart={e => {
        if (!drag) return;
        e.dataTransfer.setData(drag.type, drag.value);
        e.dataTransfer.effectAllowed = "copy";
        cancelAnimationFrame(raf.current);
      }}
    >
      <canvas ref={ref} className="fx-canvas" />
      <span className="fx-name">{name}</span>
    </button>
  );
}
