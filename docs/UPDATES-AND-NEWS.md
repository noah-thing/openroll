# Shipping updates and messages

## Updates

The app checks `releases/latest` on GitHub once a day.

1. Bump `version` in package.json and commit.
2. Build every platform (`npm run dist:*`, or the release workflow) and write `SHA256SUMS.txt` next to the files.
3. Create a GitHub release tagged `vX.Y.Z`, attach every installer plus `SHA256SUMS.txt`, write the notes, publish it (not a draft, not a prerelease).

With automatic updates on (the default) the new version downloads in the background, is checked against its sha256, and installs when the app quits. With them off, people get "OpenRoll X is available" with an Install button. The release notes are shown once as "What's new" on the first launch of the new version, and stay in the bell.

Release notes support a small markdown subset: `## headings`, paragraphs, `- lists`, `**bold**` and `[links](https://…)`.

## Messages

Messages live in `news/feed.json` on the main branch. The app reads that file a few times a day; publishing a message is a commit. Nothing is sent from the app, there is no id and no tracking.

```json
{
  "items": [
    {
      "id": "launch-2027",
      "date": "2027-01-15",
      "level": "popup",
      "title": "Edit together, live",
      "body": "A first look at what comes next.\n\n- Invite a friend\n- See their cursor\n\nJoin on **Friday**.",
      "image": { "url": "https://raw.githubusercontent.com/noah-thing/openroll/main/news/media/launch.jpg", "alt": "Two people editing", "aspect": 1.6 },
      "buttons": [{ "label": "Join the test", "url": "https://example.org" }],
      "platforms": ["darwin", "win32", "linux"],
      "minVersion": "0.2.0",
      "maxVersion": "0.9.9",
      "expires": "2027-02-01"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Unique, letters, digits, dots, dashes. Read state is kept per id, so never reuse one. |
| `level` | `quiet` (only in the bell), `toast` (slides in at the top right and stays until closed, then lives in the bell), `popup` (a centred card, once, for big news). Defaults to quiet. |
| `body` | Same markdown subset as release notes. |
| `image` | Optional, https, up to 3 MB, png, jpeg, webp, gif or avif. The app downloads it itself and keeps a copy, so it shows offline too. `aspect` is width divided by height. |
| `buttons` | Up to two https links. The first is the main button. |
| `platforms`, `minVersion`, `maxVersion`, `expires` | Optional targeting. |

Only one popup shows at a time, never on top of the What's new notes, and toasts wait behind both. People can turn messages off in Settings.

Test a feed locally before committing it:

```sh
cd qa/fixtures/news && python3 -m http.server 4599 &
QA_SEED=qa/fixtures/seed-updated OPENROLL_NEWS_FEED=http://127.0.0.1:4599/feed.json node qa/launch.mjs qa/news.mjs
```
