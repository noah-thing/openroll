const PATHS = {
  media: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
  captions: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M7 14h4M13 14h4M7 11h10"/>',
  effects: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M18 6l-2.6 2.6M8.6 15.4 6 18"/>',
  transitions: '<rect x="3.5" y="6.5" width="9" height="11" rx="1.5"/><rect x="11.5" y="6.5" width="9" height="11" rx="1.5"/>',
  filters: '<circle cx="9.5" cy="10" r="5"/><circle cx="14.5" cy="10" r="5"/><circle cx="12" cy="14.5" r="5"/>',
  stickers: '<path d="M20 12a8 8 0 1 1-8-8h8z"/><path d="M12 4v4a4 4 0 0 0 4 4h4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  split: '<path d="M12 3v18"/><path d="M5 8h4M5 16h4M15 8h4M15 16h4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  freeze: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h3M15 8h3"/>',
  snap: '<path d="M4 12h6M14 12h6M12 4v16"/>',
  zoomIn: '<circle cx="11" cy="11" r="6"/><path d="M8 11h6M11 8v6M20 20l-4.2-4.2"/>',
  zoomOut: '<circle cx="11" cy="11" r="6"/><path d="M8 11h6M20 20l-4.2-4.2"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M4 4l16 16M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.3 7.4C3.9 9.2 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.2-1"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  speakerOff: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5"/>',
  video: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>',
  overlay: '<rect x="3.5" y="4.5" width="13" height="10" rx="1.5"/><rect x="8.5" y="9.5" width="12" height="10" rx="1.5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  export: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 13v6.5h14V13"/>',
  folder: '<path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/>',
  marker: '<path d="M7 3.5h10v13l-5 4-5-4z"/>',
  speed: '<path d="M4.5 16a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4.5"/>',
  sparkle: '<path d="M12 4c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z"/>',
  wand: '<path d="m4 20 11-11M14 5l1-1.5L16 5l1.5 1L16 7l-1 1.5L14 7l-1.5-1zM19 11l.6 1.4L21 13l-1.4.6L19 15l-.6-1.4L17 13l1.4-.6z"/>',
  reverse: '<path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  detach: '<path d="M3.5 7h17M3.5 17h7"/><path d="M14 14l6 6M20 14l-6 6"/>',
  keyframe: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M7 5h2v14H7zM19 5v14l-9-7z" fill="currentColor" stroke="none"/>',
  next: '<path d="M15 5h2v14h-2zM5 5v14l9-7z" fill="currentColor" stroke="none"/>',
  eyedropper: '<path d="m14.5 5.5 4 4M16.5 3.5a2.1 2.1 0 0 1 3 3L10 16l-4 1 1-4z"/><path d="m5 19 1.5-1.5"/>',
  arrowUp: '<path d="m6 14 6-6 6 6"/>',
  arrowDown: '<path d="m6 10 6 6 6-6"/>',
  guides: '<rect x="6.5" y="3" width="11" height="18" rx="2.5"/><path d="M6.5 7.5h11M6.5 16.5h11M14.5 10.5v3"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.7"/><path d="M4 4v4.7h4.7M12 8v4.3l3 1.7"/>',
  version: '<path d="M7 3.5h10a1 1 0 0 1 1 1V20.5l-6-3.6-6 3.6V4.5a1 1 0 0 1 1-1z"/>',
  shapes: '<rect x="3.5" y="10.5" width="9" height="9" rx="1.5"/><circle cx="15.5" cy="8.5" r="5"/>',
  command: '<path d="M9 9h6v6H9z"/><path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9zM15 9V6.5A2.5 2.5 0 1 1 17.5 9zM9 15v2.5A2.5 2.5 0 1 1 6.5 15zM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5z"/>',
  layout: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 12h17"/>',
  beat: '<path d="M3.5 12h3l2-6 3.5 12 2.5-9 1.5 3h4.5"/>',
  warning:'<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17v.2"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
