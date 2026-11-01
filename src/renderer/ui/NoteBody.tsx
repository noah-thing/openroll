import { parseBody, type Inline } from "../../shared/news";

function Parts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "bold" ? (
          <b key={i}>{p.text}</b>
        ) : p.kind === "link" ? (
          <a key={i} href={p.url} target="_blank" rel="noreferrer">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Release notes and team messages. A tiny markdown subset, rendered as elements, never as HTML. */
export function NoteBody({ body }: { body: string }) {
  return (
    <div className="note-body">
      {parseBody(body).map((b, i) =>
        b.kind === "heading" ? (
          <h4 key={i}>
            <Parts parts={b.parts} />
          </h4>
        ) : b.kind === "list" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Parts parts={it} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Parts parts={b.parts} />
          </p>
        ),
      )}
    </div>
  );
}
