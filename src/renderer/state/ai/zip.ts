async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Mattes are smooth, so a plain deflate shrinks them to a small part of their size. */
export const deflate = (bytes: Uint8Array) => through(bytes, new CompressionStream("deflate"));
export const inflate = (bytes: Uint8Array) => through(bytes, new DecompressionStream("deflate"));

/** Short stable name for a file on disk, from what identifies its contents. */
export async function digest(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d).slice(0, 10), b => b.toString(16).padStart(2, "0")).join("");
}
