// Install commands, the download list and the star count. File names and sizes come from the latest release.
import { C, P, drawSmall } from "./pixel.js";
const REPO = "noah-thing/openroll";
const RELEASES = `https://github.com/${REPO}/releases/latest`;

export const COMMANDS = {
  mac: { prompt: "$", raw: "curl -fsSL openroll.dev/install | sh", where: "Terminal" },
  win: { prompt: ">", raw: "irm openroll.dev/install.ps1 | iex", where: "PowerShell" },
  linux: { prompt: "$", raw: "curl -fsSL openroll.dev/install | sh", where: "a terminal" },
};
const NOTES = {
  mac: "Paste into Terminal. It lands in Applications.",
  win: "Paste into PowerShell. Installs for your user only.",
  linux: "A .deb on Ubuntu and Debian, an AppImage anywhere else.",
};

// What each file is, matched against the release asset names, with the sizes of 0.2.0 until the API answers.
const FILES = [
  { os: "mac", id: "mac-arm", label: "Apple silicon", kind: ".dmg", match: /mac-arm64\.dmg$/, mb: 142 },
  { os: "mac", id: "mac-x64", label: "Intel", kind: ".dmg", match: /mac-x64\.dmg$/, mb: 152 },
  { os: "win", id: "win-setup", label: "Installer", kind: ".exe", match: /Setup-.*win-x64\.exe$/, mb: 169 },
  { os: "win", id: "win-portable", label: "Portable", kind: ".exe", match: /win-x64-portable\.exe$/, mb: 150 },
  { os: "win", id: "win-arm64", label: "Windows on Arm", kind: ".exe", match: /Setup-.*win-arm64\.exe$/, mb: 0, later: true },
  { os: "linux", id: "linux-deb", label: "Debian, Ubuntu", kind: ".deb", match: /\.deb$/, mb: 130 },
  { os: "linux", id: "linux-appimage", label: "Any distribution", kind: ".AppImage", match: /\.AppImage$/, mb: 129 },
];

// a phone can't run the installer, so it gets no "this computer" and a way to pass the link on instead
export const phone = navigator.userAgentData?.mobile || /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);

export function detectOS() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  if (phone) return "mac";
  if (p.includes("win")) return "win";
  if (p.includes("linux") || p.includes("x11") || p.includes("cros")) return "linux";
  return "mac";
}

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// the address and the pipe after it stay on one line, so a narrow screen breaks the command before the url
const lineHTML = raw => {
  const at = raw.indexOf("openroll.dev");
  return esc(raw.slice(0, at)) + `<b>${esc(raw.slice(at)).replace(" | ", " <em>|</em> ")}</b>`;
};

async function copy(btn, text) {
  try { await navigator.clipboard.writeText(text); } catch {}
  btn.textContent = "Copied";
  btn.classList.add("done");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
}

function fileLink(f, sep = ", ") {
  return `<a href="${f.url || RELEASES}" data-file="${f.id}">${f.kind}</a>${sep}<span data-size="${f.id}">${f.mb} MB</span>`;
}

// the tab labels are drawn in the site's own pixel lettering, brighter on the chosen one
export function labels() {
  const s = Math.max(2, Math.round(P / 3));
  document.querySelectorAll(".phead canvas[data-label]").forEach(cv => {
    const on = cv.closest("button")?.getAttribute("aria-selected") === "true";
    const link = !cv.closest("button");
    drawSmall(cv, [cv.dataset.label], s, { color: on ? C.white : link ? C.blue2 : C.blue2, hi: on ? C.white : link ? C.blue : C.blue, lo: on ? C.deep : 0 });
  });
}

export function setupInstall() {
  const mine = detectOS();

  // the hero box: one command for this computer, the others one click away
  const cmd = document.getElementById("cmd"), how = document.getElementById("how"), file = document.getElementById("file");
  const tabs = [...document.querySelectorAll(".os button")];
  let current = mine;
  const choose = os => {
    current = os;
    tabs.forEach(b => b.setAttribute("aria-selected", b.dataset.os === os));
    labels();
    cmd.innerHTML = `<i>${esc(COMMANDS[os].prompt)}</i>${lineHTML(COMMANDS[os].raw)}`;
    how.textContent = NOTES[os];
    const main = FILES.find(f => f.os === os);
    file.innerHTML = `Prefer a file? ${fileLink(main)}`;
  };
  // this computer's system goes first, so the tab you need is the one already under your cursor
  const row = tabs[0].parentElement, own = tabs.find(b => b.dataset.os === mine);
  if (own) row.prepend(own);
  tabs.forEach(b => b.addEventListener("click", () => choose(b.dataset.os)));
  document.getElementById("copy").addEventListener("click", e => copy(e.currentTarget, COMMANDS[current].raw));
  choose(mine);

  const send = document.getElementById("send");
  if (phone) {
    send.hidden = false;
    send.innerHTML = navigator.share ? 'On a phone? <a href="#">Send yourself the link</a>' : "On a phone? Open openroll.dev on your computer.";
    send.querySelector("a")?.addEventListener("click", e => {
      e.preventDefault();
      navigator.share({ title: "OpenRoll", url: "https://openroll.dev" }).catch(() => {});
    });
  }

  // the download section lists every system, this one first
  const list = document.getElementById("systems");
  const NAMES = { mac: "macOS", win: "Windows", linux: "Linux" };
  const order = [mine, ...["mac", "win", "linux"].filter(o => o !== mine)];
  list.innerHTML = order.map(os => `
    <article class="sys${os === mine && !phone ? " yours" : ""}" data-solid>
      <header><h3>${NAMES[os]}</h3>${os === mine && !phone ? '<span class="tag">This computer</span>' : ""}</header>
      <div class="cmd small"><code><i>${esc(COMMANDS[os].prompt)}</i>${lineHTML(COMMANDS[os].raw)}</code><button class="copy notch" type="button" data-os="${os}">Copy</button></div>
      <p class="hint">Paste into ${COMMANDS[os].where}.</p>
      <ul>${FILES.filter(f => f.os === os).map(f => `<li${f.later ? ` data-later="${f.id}" hidden` : ""}><span>${f.label}</span><span>${fileLink(f, " &middot; ")}</span></li>`).join("")}</ul>
    </article>`).join("");
  list.querySelectorAll(".copy").forEach(b => b.addEventListener("click", () => copy(b, COMMANDS[b.dataset.os].raw)));

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then(r => (r.ok ? r.json() : null))
    .then(rel => {
      if (!rel?.assets) return;
      for (const f of FILES) {
        const a = rel.assets.find(x => f.match.test(x.name));
        if (!a) continue;
        document.querySelectorAll(`[data-later="${f.id}"]`).forEach(el => (el.hidden = false));
        f.url = a.browser_download_url;
        f.mb = Math.round(a.size / 1e6);
        document.querySelectorAll(`[data-file="${f.id}"]`).forEach(el => (el.href = f.url));
        document.querySelectorAll(`[data-size="${f.id}"]`).forEach(el => (el.textContent = `${f.mb} MB`));
      }
      document.querySelectorAll("[data-version]").forEach(el => (el.textContent = rel.tag_name));
    })
    .catch(() => {});

  fetch(`https://api.github.com/repos/${REPO}`)
    .then(r => (r.ok ? r.json() : null))
    .then(d => { if (d?.stargazers_count) document.querySelectorAll("[data-stars]").forEach(el => (el.textContent = d.stargazers_count.toLocaleString("en"))); })
    .catch(() => {});
}
