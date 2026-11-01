import { Compositor, type Layer } from "../../../engine/compositor";

const W = 320, H = 180;
let shared: Compositor | null = null;

function compositor(): Compositor {
  if (!shared) shared = new Compositor(new OffscreenCanvas(W, H));
  return shared;
}

/** A plain stand-in for footage when the project has none: two flat fields and a shape. */
export function abstractFrames(): [OffscreenCanvas, OffscreenCanvas] {
  const a = new OffscreenCanvas(W, H), b = new OffscreenCanvas(W, H);
  const ga = a.getContext("2d")!;
  ga.fillStyle = "#3e5a49";
  ga.fillRect(0, 0, W, H);
  ga.fillStyle = "#ece7da";
  ga.beginPath();
  ga.arc(W * 0.34, H * 0.52, H * 0.26, 0, Math.PI * 2);
  ga.fill();
  const gb = b.getContext("2d")!;
  gb.fillStyle = "#d9cfb8";
  gb.fillRect(0, 0, W, H);
  gb.fillStyle = "#1b1f1d";
  gb.beginPath();
  gb.moveTo(W * 0.52, H);
  gb.lineTo(W * 0.78, 0);
  gb.lineTo(W, 0);
  gb.lineTo(W * 0.74, H);
  gb.fill();
  return [a, b];
}

/** Render one moment of a transition between two pictures into a 2D canvas. */
export function drawTransition(target: HTMLCanvasElement, kind: string, progress: number, a: CanvasImageSource, b: CanvasImageSource): void {
  const c = compositor();
  c.resize(W, H, W, H);
  const layer = (src: CanvasImageSource, key: string): Layer => ({
    x: 0,
    y: 0,
    width: W,
    height: H,
    rotation: 0,
    opacity: 1,
    source: { key, pixels: src as OffscreenCanvas, version: keyOf(src), width: W, height: H },
  });
  c.render([{ kind: "transition", a: [layer(a, "a")], b: [layer(b, "b")], transition: kind, progress }], [0, 0, 0]);
  const bmp = (c.canvas as OffscreenCanvas).transferToImageBitmap();
  target.width = W;
  target.height = H;
  target.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function keyOf(o: object): number {
  let id = ids.get(o);
  if (!id) ids.set(o, (id = nextId++));
  return id;
}
