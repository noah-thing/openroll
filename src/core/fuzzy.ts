// Fuzzy matching for the command bar. Every word typed has to appear, in order, inside
// the label or its keywords. Starts of words and runs of consecutive letters score
// higher, so "sp2" finds "Speed 2x" before it finds "Split to two".

export interface Match {
  score: number;
  /** Character positions in the label that matched, for highlighting. */
  hits: number[];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_/:.,]/.test(text[i - 1]);

/** Best alignment of one word inside `text`, or null. Case insensitive. */
function matchWord(word: string, text: string): Match | null {
  const hay = text.toLowerCase();
  const exact = hay.indexOf(word);
  if (exact >= 0) {
    // Prefer an occurrence that starts a word.
    let at = exact;
    for (let i = exact; i >= 0; i = hay.indexOf(word, i + 1)) {
      if (isBoundary(hay, i)) {
        at = i;
        break;
      }
    }
    const bonus = isBoundary(hay, at) ? 40 : 0;
    return { score: 100 + bonus + word.length * 4 - at * 0.5, hits: Array.from({ length: word.length }, (_, k) => at + k) };
  }
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of word) {
    let found = -1;
    // Take a word start when one is close, otherwise the next occurrence.
    for (let i = from; i < hay.length; i++) {
      if (hay[i] !== ch) continue;
      if (found < 0) found = i;
      if (isBoundary(hay, i) || i === prev + 1) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    score += 10 + (found === prev + 1 ? 14 : 0) + (isBoundary(hay, found) ? 12 : 0) - Math.min(8, found - from);
    hits.push(found);
    prev = found;
    from = found + 1;
  }
  return { score, hits };
}

/** Score a query against a label plus extra searchable words. Null when it does not match. */
export function fuzzyMatch(query: string, label: string, keywords = ""): Match | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, hits: [] };
  let total = 0;
  const hits = new Set<number>();
  for (const w of words) {
    const inLabel = matchWord(w, label);
    const inWords = keywords ? matchWord(w, keywords) : null;
    // A hit in the label beats the same hit in keywords.
    const best = inLabel && (!inWords || inLabel.score + 25 >= inWords.score) ? inLabel : inWords;
    if (!best) return null;
    // Keywords are a way in, not the headline: they count for about half a label hit.
    total += best === inLabel ? best.score + 25 : best.score * 0.5;
    if (best === inLabel) for (const h of best.hits) hits.add(h);
  }
  // Shorter labels win ties: "Export" before "Export captions" for "export".
  return { score: total - label.length * 0.4, hits: [...hits].sort((a, b) => a - b) };
}

export interface Searchable {
  id: string;
  label: string;
  keywords?: string;
}

export interface Ranked<T> {
  item: T;
  match: Match;
}

/**
 * Rank entries for a query. `recent` lists ids newest first; a recent entry gets a lift
 * that fades with age, and with an empty query recents come first in that order.
 */
export function rank<T extends Searchable>(items: T[], query: string, recent: string[] = [], limit = 60): Ranked<T>[] {
  const age = new Map(recent.map((id, i) => [id, i]));
  if (!query.trim()) {
    const first = recent.map(id => items.find(i => i.id === id)).filter((i): i is T => !!i);
    const rest = items.filter(i => !age.has(i.id));
    return [...first, ...rest].slice(0, limit).map(item => ({ item, match: { score: 0, hits: [] } }));
  }
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, item.label, item.keywords);
    if (!match) continue;
    const a = age.get(item.id);
    out.push({ item, match: a === undefined ? match : { ...match, score: match.score + Math.max(6, 30 - a * 4) } });
  }
  return out.sort((x, y) => y.match.score - x.match.score).slice(0, limit);
}
