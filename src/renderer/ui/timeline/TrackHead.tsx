import { setTrack } from "../../../core/edit";
import type { Track } from "../../../core/project";
import type { Editor } from "../../state/editor";
import { Icon, type IconName } from "../kit/Icon";

export function TrackHead({ editor, track }: { editor: Editor; track: Track }) {
  const icon: IconName = track.kind === "audio" ? "audio" : track.kind === "text" ? "text" : track.main ? "video" : "overlay";
  const toggle = (key: "muted" | "hidden" | "locked", label: string) => editor.apply(label, p => setTrack(p, track.id, { [key]: !track[key] }));
  return (
    <div className={"tl-head" + (track.hidden || track.muted ? " tl-head-off" : "")}>
      <Icon name={icon} size={15} />
      <span className="tl-head-name">{track.name}</span>
      <span className="tl-head-tools">
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
