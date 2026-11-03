import { pixelSize } from "./pixel.js";
import { resizeHero, startHero } from "./hero.js";
import { drawDeep, drawSprites, drawZeros } from "./deep.js";
import { labels, setupInstall } from "./install.js";

pixelSize();
setupInstall();
drawSprites();
drawZeros();
startHero();

// the sea is drawn around the text, so it waits for the font to give the text its final size
document.fonts.ready.then(drawDeep);
document.querySelectorAll(".faq details").forEach(d => d.addEventListener("toggle", drawDeep));

let timer = 0, lastWidth = innerWidth;
addEventListener("resize", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    // phones resize the window whenever the address bar slides away; only a new width needs a redraw
    if (innerWidth === lastWidth) return;
    pixelSize();
    resizeHero();
    drawSprites(); drawZeros(); labels();
    lastWidth = innerWidth;
    drawDeep();
  }, 120);
});
