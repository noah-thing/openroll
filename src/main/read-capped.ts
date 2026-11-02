/** The body as text, stopping as soon as it passes the limit instead of downloading all of it. */
export async function readCapped(res: Response, limit: number): Promise<string> {
  if (Number(res.headers.get("content-length")) > limit) throw new Error("too large");
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
