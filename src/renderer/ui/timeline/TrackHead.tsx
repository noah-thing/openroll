import { useState } from "react";
import { renameTrack } from "../../../core/timeline-edit";
import { setTrack } from "../../../core/edit";
import type { Track } from "../../../core/project";
import type { Editor } from "../../state/editor";
import { toggleMagnet } from "../../state/timeline-actions";
import { Icon, type IconName } from "../kit/Icon";

interface Props {
  editor: Editor;
  track: Track;
  dragging?: boolean;
  onReorderStart(e: React.PointerEvent, track: Track): void;
  onContextMenu(e: React.MouseEvent, track: Track): void;
}

export function TrackHead({ editor, track, dragging, onReorderStart, onContextMenu }: Props) {
  const [renaming, setRenaming] = useState(false);
  const icon: IconName = track.kind === "audio" ? "audio" : track.kind === "text" ? "text" : track.main ? "video" : "overlay";
  const toggle = (key: "muted" | "hidden" | "locked", label: string) => editor.apply(label, p => setTrack(p, track.id, { [key]: !track[key] }));
  const magnetic = track.magnetic !== false;
  return (
    <div
      className={"tl-head" + (track.hidden || track.muted ? " tl-head-off" : "") + (dragging ? " tl-head-drag" : "")}
      onPointerDown={e => {
        if ((e.target as Element).closest("button, input")) return;
        onReorderStart(e, track);
      }}
      onContextMenu={e => onContextMenu(e, track)}
      onDoubleClick={e => !(e.target as Element).closest("button, input") && setRenaming(true)}
    >
      <Icon name={icon} size={15} />
      {renaming ? (
        <input
          className="tl-head-input"
          autoFocus
          defaultValue={track.name}
          aria-label="Track name"
          onFocus={e => e.currentTarget.select()}
          onBlur={e => {
            editor.apply("Rename track", p => renameTrack(p, track.id, e.currentTarget.value));
            setRenaming(false);
          }}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <span className="tl-head-name" title="Double click to rename">
          {track.name}
        </span>
      )}
      <span className="tl-head-tools">
        {track.main && (
          <button className="iconbtn sm" title={magnetic ? "Magnetic: clips close up. Click to place clips freely" : "Free: clips stay where you put them. Click for magnetic"} aria-pressed={magnetic} onClick={() => toggleMagnet(editor)}>
            <Icon name="magnet" size={14} />
          </button>
        )}
        {track.kind !== "audio" && (
          <button className="iconbtn sm" title={track.hidden ? "Show track" : "Hide track"} onClick={() => toggle("hidden", track.hidden ? "Show track" : "Hide track")}>
            <Icon name={track.hidden ? "eyeOff" : "eye"} size={14} />
          </button>
        )}
        {track.kind !== "text" && (
          <button className="iconbtn sm" title={track.muted ? "Unmute track" : "Mute track"} onClick={() => toggle("muted", track.muted ? "Unmute track" : "Mute track")}>
            <Icon name={track.muted ? "speakerOff" : "speaker"} size={14} />
          </button>
        )}
        <button className="iconbtn sm" title={track.locked ? "Unlock track" : "Lock track"} onClick={() => toggle("locked", track.locked ? "Unlock track" : "Lock track")}>
          <Icon name={track.locked ? "lock" : "unlock"} size={14} />
        </button>
      </span>
    </div>
  );
}
