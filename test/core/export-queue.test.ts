import { beforeEach, describe, expect, it, vi } from "vitest";

const runs: Array<{ cancel: ReturnType<typeof vi.fn> }> = [];
vi.mock("../../src/engine/exporter", () => ({
  Exporter: class {
    cancel = vi.fn();
    dispose = vi.fn();
    constructor() {
      runs.push(this);
    }
    run = vi.fn(async () => ({ bytes: 1, seconds: 1 }));
  },
}));

const closed: Array<[number, boolean | undefined]> = [];
beforeEach(() => {
  runs.length = 0;
  closed.length = 0;
  (globalThis as unknown as { window: unknown }).window = { openroll: { closeWriter: async (id: number, abort?: boolean) => void closed.push([id, abort]) } };
});

const entry = (writerId: number, prepare?: () => Promise<never[]>) => ({
  name: "n",
  label: "MP4",
  project: {} as never,
  urls: {},
  settings: {} as never,
  writer: { id: writerId, path: `/x/${writerId}.mp4` },
  prepare,
});

describe("export queue", () => {
  it("stops a job that is still preparing before it renders anything", async () => {
    const { exportQueue } = await import("../../src/renderer/state/export-queue");
    let release!: () => void;
    const id = exportQueue.add(entry(1, () => new Promise(resolve => (release = () => resolve([])))));
    const done = exportQueue.whenDone(id);
    exportQueue.cancel(id);
    release();
    await done;
    expect(runs).toHaveLength(0);
    expect(closed).toEqual([[1, true]]);
    expect(exportQueue.jobs.find(j => j.id === id)).toBeUndefined();
  });

  it("releases anyone waiting on a queued job that is removed", async () => {
    const { exportQueue } = await import("../../src/renderer/state/export-queue");
    let release!: () => void;
    const first = exportQueue.add(entry(2, () => new Promise(resolve => (release = () => resolve([])))));
    const second = exportQueue.add(entry(3));
    const waiting = exportQueue.whenDone(second);
    exportQueue.cancel(second);
    const job = await waiting;
    expect(job.status).toBe("queued");
    expect(closed).toContainEqual([3, true]);
    release();
    await exportQueue.whenDone(first);
  });
});

describe("export queue when the file will not delete", () => {
  it("still ends the job instead of leaving it running", async () => {
    (globalThis as unknown as { window: unknown }).window = {
      openroll: {
        closeWriter: async () => {
          throw new Error("EPERM");
        },
      },
    };
    const { exportQueue } = await import("../../src/renderer/state/export-queue");
    let release!: () => void;
    const id = exportQueue.add(entry(7, () => new Promise(resolve => (release = () => resolve([])))));
    const done = exportQueue.whenDone(id);
    exportQueue.cancel(id);
    release();
    await done;
    expect(exportQueue.jobs.find(j => j.id === id)).toBeUndefined();
  });
});
