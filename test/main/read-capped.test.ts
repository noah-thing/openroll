import { describe, expect, it } from "vitest";
import { readCapped } from "../../src/main/read-capped";

const body = (chunks: string[], headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    }),
    { headers },
  );

describe("readCapped", () => {
  it("reads a body that fits", async () => {
    expect(await readCapped(body(['{"a":', "1}"]), 100)).toBe('{"a":1}');
  });

  it("refuses a body that says it is too large without reading it", async () => {
    await expect(readCapped(body(["x"], { "content-length": "5000" }), 100)).rejects.toThrow("too large");
  });

  it("stops a body that grows past the limit even when it said nothing", async () => {
    await expect(readCapped(body(["x".repeat(60), "x".repeat(60)]), 100)).rejects.toThrow("too large");
  });
});
