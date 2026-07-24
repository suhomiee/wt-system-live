#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:8098/";
const outputDir = process.argv[3] || "/tmp";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
const errors = [];

try {
  for (const viewport of [
    { name: "desktop", width: 1600, height: 900 },
    { name: "compact", width: 1280, height: 800 }
  ]) {
    const page = await browser.newPage({ viewport });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${viewport.name}: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`${viewport.name}: ${error.message}`));

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator('[data-section="leadtime"]').click();
    await page.locator(".wt-lead-page").waitFor({ state: "visible" });
    await page.locator('[data-section="dashboard"]').click();
    await page.locator(".wt-command-dashboard").waitFor({ state: "visible" });
    await page.locator('[data-section="leadtime"]').click();
    await page.locator(".wt-lead-page").waitFor({ state: "visible" });
    await page.locator("[data-sidebar-toggle]").first().click();
    await page.locator(".wt-app.is-sidebar-collapsed").waitFor({ state: "attached" });
    await page.locator("[data-sidebar-toggle]").first().click();
    await page.locator(".wt-app:not(.is-sidebar-collapsed)").waitFor({ state: "attached" });

    const result = await page.evaluate(() => {
      const pageRoot = document.querySelector(".wt-lead-page");
      const track = document.querySelector(".wt-lead-track");
      const laneTitles = Array.from(document.querySelectorAll(".wt-lead-lane h2")).map((node) => node.textContent.trim());
      const milestoneDates = Array.from(document.querySelectorAll(".wt-lead-milestone b")).map((node) => node.textContent.trim());
      const phaseLabels = Array.from(document.querySelectorAll(".wt-lead-phase b")).map((node) => node.textContent.trim());
      const activeNav = document.querySelector('.wt-primary-nav [data-section="leadtime"].active');
      const pageRect = pageRoot.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      const monthRects = Array.from(document.querySelectorAll(".wt-lead-month")).map((node) => node.getBoundingClientRect());
      const monthWidth = monthRects.reduce((sum, rect) => sum + rect.width, 0);
      const clippedLabels = Array.from(document.querySelectorAll(".wt-lead-milestone > div")).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < trackRect.left - 2 || rect.right > trackRect.right + 2;
      }).length;

      return {
        title: document.querySelector(".wt-lead-header h1")?.textContent.trim(),
        advantage: document.querySelector(".wt-lead-advantage strong")?.textContent.trim(),
        laneTitles,
        milestoneDates,
        phaseLabels,
        activeNav: Boolean(activeNav),
        navigationRoundTrip: Boolean(document.querySelector(".wt-lead-page")),
        sidebarRestored: !document.querySelector(".wt-app")?.classList.contains("is-sidebar-collapsed"),
        pageFitsViewport: pageRect.width <= window.innerWidth + 1,
        monthTrackDelta: Math.round(Math.abs(monthWidth - trackRect.width)),
        clippedLabels,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        verticalOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight
      };
    });

    const assertions = [
      [result.title === "LTWT Lead-Time Compare", "title"],
      [result.advantage === "8 WEEKS EARLIER", "advantage"],
      [result.laneTitles.join("|") === "Calendar|Running & ACG", "lanes"],
      [result.milestoneDates.includes("03/12") && result.milestoneDates.includes("01/15"), "result dates"],
      [result.phaseLabels.filter((label) => label === "1 WEEK").length === 2, "transition duration"],
      [result.phaseLabels.filter((label) => label === "2 WEEKS").length === 2, "distribution duration"],
      [result.phaseLabels.filter((label) => label === "8 WEEKS").length === 2, "LTWT duration"],
      [result.activeNav, "active navigation"],
      [result.navigationRoundTrip, "navigation round trip"],
      [result.sidebarRestored, "sidebar toggle"],
      [result.monthTrackDelta <= 2, "month/track alignment"],
      [result.clippedLabels === 0, "milestone clipping"],
      [viewport.width < 1400 || result.horizontalOverflow === 0, "desktop overflow"],
      [result.verticalOverflow === 0, "vertical overflow"]
    ];
    const failed = assertions.filter(([passed]) => !passed).map(([, label]) => label);
    if (failed.length) {
      throw new Error(`${viewport.name} QA failed: ${failed.join(", ")}\n${JSON.stringify(result, null, 2)}`);
    }

    await page.screenshot({
      path: path.join(outputDir, `wt-leadtime-${viewport.name}.png`),
      fullPage: true
    });
    console.log(`${viewport.name}: ${JSON.stringify(result)}`);
    await page.close();
  }

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
}
