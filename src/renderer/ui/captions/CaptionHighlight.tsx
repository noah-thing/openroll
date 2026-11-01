import { HIGHLIGHT_COLORS } from "../../../core/caption-styles";
import type { CaptionItem, Item } from "../../../core/project";
import { Section } from "../kit/Field";

/** Colour of the word being spoken, for one caption. The Captions panel sets it for all of them. */
export function CaptionHighlight({ item, set, done }: { item: CaptionItem; set(label: string, patch: Partial<Item>, group: string): void; done(): void }) {
  const pick = (highlight: string | undefined) => {
    set("Word highlight", { highlight } as Partial<Item>, "highlight");
    done();
  };
  return (
    <Section title="Spoken word">
      <div className="swatches">
        <button className={"swatch swatch-none" + (!item.highlight ? " on" : "")} title="No highlight" aria-label="No highlight" onClick={() => pick(undefined)} />
        {HIGHLIGHT_COLORS.map(c => (
          <button key={c} className={"swatch" + (item.highlight === c ? " on" : "")} style={{ background: c }} title={c} aria-label={`Highlight ${c}`} onClick={() => pick(c)} />
        ))}
      </div>
    </Section>
  );
}
