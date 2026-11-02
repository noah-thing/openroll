import { FONTS, type FontInfo } from "../core/fonts";

const urls = import.meta.glob<string>("../renderer/fonts/*.woff2", { query: "?url", import: "default", eager: true });

const RANGES = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
};

let loading: Promise<void> | null = null;

function faces(f: FontInfo): FontFace[] {
  const subsets = f.latinOnly ? (["latin"] as const) : (["latin", "latin-ext"] as const);
  return subsets.flatMap(subset => {
    const url = urls[`../renderer/fonts/${f.file}-${subset}.woff2`];
    if (!url) return [];
    const weight = f.minWeight === f.maxWeight ? String(f.minWeight) : `${f.minWeight} ${f.maxWeight}`;
    return [new FontFace(f.family, `url(${url})`, { weight, unicodeRange: RANGES[subset] })];
  });
}

/**
 * Workers do not see the page's fonts, so text drawn there needs its faces added again, and
 * the page registers the same list so the interface previews what the renderer draws.
 * Resolves once they are usable; text rasterised before that would cache the fallback face.
 */
export function loadFonts(set: FontFaceSet): Promise<void> {
  loading ??= Promise.all(FONTS.flatMap(faces).map(face => face.load().then(loaded => set.add(loaded)).catch(() => {}))).then(() => {});
  return loading;
}
