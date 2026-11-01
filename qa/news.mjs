// The three message levels, What's new after an update, and read state. Run with:
// QA_SEED=qa/fixtures/seed-updated OPENROLL_NEWS_FEED=http://127.0.0.1:4599/feed.json node qa/launch.mjs qa/news.mjs
export default async function ({ page, shot }) {
  const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
  await page.waitForSelector(".home");

  // First launch after an update: What's new comes first and blocks the popup.
  await page.waitForSelector(".whats-new", { timeout: 8000 });
  check("what's new shown", true);
  check("popup waits for what's new", (await page.locator(".news-popup").count()) === 0);
  await shot("news-01-whatsnew");
  await page.click('.whats-new button:has-text("Continue")');

  await page.waitForSelector(".news-popup", { timeout: 8000 });
  const img = await page.locator(".news-popup-image img").getAttribute("src");
  check("popup shown with downloaded image", !!img && img.startsWith("data:image/jpeg"), img?.slice(0, 30));
  await page.waitForTimeout(700);
  check("toast waits while the popup is open", (await page.locator(".news-toast").count()) === 0);
  await shot("news-02-popup");
  await page.click('.news-popup button:has-text("Not now")');
  await page.waitForTimeout(400);
  check("popup closes and stays closed", (await page.locator(".news-popup").count()) === 0);

  await page.waitForSelector(".news-toast", { timeout: 5000 });
  check("toast slides in", true);
  await page.waitForTimeout(600);
  await shot("news-03-toast");
  await page.waitForTimeout(10000);
  check("toast stays until closed", (await page.locator(".news-toast").count()) === 1);
  await page.click(".news-toast-close");
  await page.waitForTimeout(500);
  check("the X closes it", (await page.locator(".news-toast").count()) === 0);

  const count = await page.locator(".inbox-count").innerText().catch(() => "0");
  check("bell counts the unread quiet item", count === "1", `count ${count}`);
  await page.click(".inbox-bell");
  await page.waitForSelector(".inbox-panel");
  const titles = await page.locator(".inbox-entry h3").allInnerTexts();
  check("bell lists everything for this platform", titles.length === 4 && !titles.includes("Only for Windows"), JSON.stringify(titles));
  await page.waitForTimeout(1500);
  await shot("news-04-bell");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("opening the bell marks read", (await page.locator(".inbox-count").count()) === 0);

  await page.reload();
  await page.waitForSelector(".home");
  await page.waitForTimeout(2500);
  check("read state survives a restart", (await page.locator(".news-popup, .news-toast, .whats-new, .inbox-count").count()) === 0);
}
