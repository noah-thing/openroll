import { describe, expect, it } from "vitest";
import { appliesTo, parseBody, parseFeed, parseInline } from "../../src/shared/news";

const ctx = { version: "0.3.0", platform: "win32", now: Date.parse("2026-12-01") };

describe("parseFeed", () => {
  it("keeps valid items and drops broken ones", () => {
    const items = parseFeed({
      items: [
        { id: "welcome", date: "2026-11-20", title: "Hi", body: "Text", link: { label: "Read", url: "https://example.org" } },
        { id: "../bad", date: "2026-11-20", title: "x" },
        { id: "nodate", title: "x" },
        { id: "js", date: "2026-11-20", title: "x", link: { label: "Go", url: "javascript:alert(1)" } },
      ],
    });
    expect(items.map(i => i.id)).toEqual(["welcome", "js"]);
    expect(items[0].buttons).toEqual([{ label: "Read", url: "https://example.org" }]);
    expect(items[0].level).toBe("quiet");
    expect(items[1].buttons).toBeUndefined();
  });

  it("reads levels, buttons and images", () => {
    const [item] = parseFeed({
      items: [
        {
          id: "launch",
          date: "2026-12-01",
          title: "Meet the new app",
          level: "popup",
          image: { url: "https://example.org/a.jpg", alt: "A phone", aspect: 1.5 },
          buttons: [{ label: "See it", url: "https://example.org" }, { label: "Later", url: "http://insecure" }, { label: "x", url: "https://y.z" }, { label: "n", url: "https://n.n" }],
        },
      ],
    });
    expect(item.level).toBe("popup");
    expect(item.image).toEqual({ url: "https://example.org/a.jpg", alt: "A phone", aspect: 1.5 });
    expect(item.buttons?.map(b => b.label)).toEqual(["See it", "x"]);
  });

  it("survives junk", () => {
    expect(parseFeed(null)).toEqual([]);
    expect(parseFeed({ items: "nope" })).toEqual([]);
  });
});

describe("appliesTo", () => {
  it("filters by platform, version range and expiry", () => {
    const base = { id: "a", date: "2026-11-01", title: "t", body: "", level: "quiet" as const };
    expect(appliesTo({ ...base, platforms: ["darwin"] }, ctx)).toBe(false);
    expect(appliesTo({ ...base, platforms: ["win32", "linux"] }, ctx)).toBe(true);
    expect(appliesTo({ ...base, minVersion: "0.4.0" }, ctx)).toBe(false);
    expect(appliesTo({ ...base, maxVersion: "0.2.9" }, ctx)).toBe(false);
    expect(appliesTo({ ...base, minVersion: "0.3.0", maxVersion: "0.3.0" }, ctx)).toBe(true);
    expect(appliesTo({ ...base, expires: "2026-11-30" }, ctx)).toBe(false);
  });
});

describe("markdown subset", () => {
  it("splits bold and https links, ignores other schemes", () => {
    expect(parseInline("Try **auto captions** at [the guide](https://openroll.app/g) or [this](http://x.y)")).toEqual([
      { kind: "text", text: "Try " },
      { kind: "bold", text: "auto captions" },
      { kind: "text", text: " at " },
      { kind: "link", text: "the guide", url: "https://openroll.app/g" },
      { kind: "text", text: " or [this](http://x.y)" },
    ]);
  });

  it("builds headings, paragraphs and lists", () => {
    const blocks = parseBody("## New\nFaster export.\nReally.\n\n- One\n- Two\nAfter");
    expect(blocks.map(b => b.kind)).toEqual(["heading", "p", "list", "p"]);
    expect(blocks[2].kind === "list" && blocks[2].items.length).toBe(2);
  });
});
