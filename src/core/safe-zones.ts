// Guides for where phone apps draw their own buttons and captions over a video. These
// are our own rough shapes, measured against a tall frame, not copies of any app's
// artwork, and apps move things around, so treat them as a guide and not a promise.

export interface Zone {
  /** Fractions of the frame, from the top left. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export type GuideId = "tiktok" | "shorts" | "reels" | "title" | "action";

export interface Guide {
  id: GuideId;
  label: string;
  /** Areas the app covers, shaded. */
  covered: Zone[];
  /** An inset frame drawn as an outline instead, for the broadcast guides. */
  inset?: number;
}

export const GUIDES: Guide[] = [
  {
    id: "tiktok",
    label: "TikTok",
    covered: [
      { x: 0, y: 0, w: 1, h: 0.09, label: "Top bar" },
      { x: 0.84, y: 0.4, w: 0.16, h: 0.42, label: "Buttons" },
      { x: 0, y: 0.78, w: 0.84, h: 0.22, label: "Caption" },
    ],
  },
  {
    id: "shorts",
    label: "YouTube Shorts",
    covered: [
      { x: 0, y: 0, w: 1, h: 0.08, label: "Top bar" },
      { x: 0.85, y: 0.46, w: 0.15, h: 0.4, label: "Buttons" },
      { x: 0, y: 0.8, w: 0.85, h: 0.2, label: "Channel and title" },
    ],
  },
  {
    id: "reels",
    label: "Instagram Reels",
    covered: [
      { x: 0, y: 0, w: 1, h: 0.1, label: "Top bar" },
      { x: 0.86, y: 0.5, w: 0.14, h: 0.38, label: "Buttons" },
      { x: 0, y: 0.8, w: 0.86, h: 0.2, label: "Caption" },
    ],
  },
  { id: "title", label: "Title safe", covered: [], inset: 0.1 },
  { id: "action", label: "Action safe", covered: [], inset: 0.05 },
];

export function guideById(id: GuideId): Guide {
  return GUIDES.find(g => g.id === id)!;
}

/** Whether a point (fractions of the frame) lies in a covered area of the guide. */
export function covered(guide: Guide, x: number, y: number): boolean {
  return guide.covered.some(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
}
