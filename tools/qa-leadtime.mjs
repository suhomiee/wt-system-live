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
    await page.waitForTimeout(650);

    const result = await page.evaluate(() => {
      const pageRoot = document.querySelector(".wt-lead-page");
      const track = document.querySelector(".wt-lead-track");
      const laneTitles = Array.from(document.querySelectorAll(".wt-lead-lane h2")).map((node) => node.textContent.trim());
      const laneResultDates = Array.from(document.querySelectorAll(".wt-lead-lane > header > b")).map((node) => node.textContent.trim());
      const eventDates = Array.from(document.querySelectorAll(".wt-lead-event > b")).map((node) => node.textContent.trim());
      const eventTitles = Array.from(document.querySelectorAll(".wt-lead-event")).map((node) => node.getAttribute("title"));
      const phaseWeeks = Array.from(document.querySelectorAll(".wt-lead-phase")).map((node) => Number(node.dataset.weeks));
      const weekLabels = Array.from(document.querySelectorAll(".wt-lead-weeks span")).map((node) => node.textContent.trim());
      const activeNav = document.querySelector('.wt-primary-nav [data-section="leadtime"].active');
      const pageRect = pageRoot.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      const monthTrack = document.querySelector(".wt-lead-months").getBoundingClientRect();
      const cellWidth = trackRect.width / weekLabels.length;
      const eventHeadDeltas = Array.from(document.querySelectorAll(".wt-lead-event > b")).map((node) => {
        return Math.abs(node.getBoundingClientRect().width - cellWidth);
      });
      const eventBounds = Array.from(document.querySelectorAll(".wt-lead-event")).map((node) => node.getBoundingClientRect());
      const clippedEvents = eventBounds.filter((rect) => rect.left < trackRect.left - 1 || rect.right > trackRect.right + 1).length;
      const clippedTextNodes = Array.from(document.querySelectorAll(".wt-lead-event > span")).filter((node) => node.scrollWidth > node.clientWidth + 1);
      const phaseSpanDeltas = Array.from(document.querySelectorAll(".wt-lead-phase")).map((node) => {
        return Math.abs(node.getBoundingClientRect().width - cellWidth * Number(node.dataset.weeks));
      });
      const comparison = Array.from(document.querySelectorAll(".wt-lead-result")).map((node) => node.textContent.replace(/\s+/g, " ").trim());
      const highlight = document.querySelector(".wt-lead-event.is-highlight");
      const calculatedDates = Array.from(document.querySelectorAll('.wt-lead-event[data-calculated="true"] > b')).map((node) => node.textContent.trim());

      return {
        title: document.querySelector(".wt-lead-header h1")?.textContent.trim(),
        advantage: document.querySelector(".wt-lead-advantage")?.textContent.replace(/\s+/g, " ").trim(),
        laneTitles,
        laneResultDates,
        eventDates,
        eventTitles,
        phaseWeeks,
        weekLabels,
        comparison,
        highlight: highlight?.textContent.replace(/\s+/g, " ").trim(),
        highlightTitle: highlight?.getAttribute("title"),
        calculatedDates,
        activeNav: Boolean(activeNav),
        navigationRoundTrip: Boolean(document.querySelector(".wt-lead-page")),
        sidebarRestored: !document.querySelector(".wt-app")?.classList.contains("is-sidebar-collapsed"),
        pageFitsViewport: pageRect.width <= window.innerWidth + 1,
        monthTrackDelta: Math.round(Math.abs(monthTrack.width - trackRect.width)),
        maxEventHeadDelta: Math.max(...eventHeadDeltas),
        maxPhaseSpanDelta: Math.max(...phaseSpanDeltas),
        clippedEvents,
        clippedText: clippedTextNodes.length,
        clippedTextTitles: clippedTextNodes.map((node) => node.parentElement.getAttribute("title")),
        eventCount: eventBounds.length,
        phaseCount: phaseSpanDeltas.length,
        gridLineCounts: Array.from(document.querySelectorAll(".wt-lead-track-grid")).map((node) => node.children.length),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        verticalOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight
      };
    });

    const assertions = [
      [result.title === "LTWT Lead-Time Compare", "title"],
      [result.advantage.includes("TKG FPT · 01/26") && result.advantage.includes("17 days earlier") && result.advantage.includes("02/12"), "SPA freeze advantage"],
      [result.laneTitles.join("|") === "Calendar|Running & ACG|TKG FPT", "lanes"],
      [result.laneResultDates.join("|") === "03/17|01/15|12/29", "result dates"],
      [result.eventDates.length === 29 && result.eventDates.filter((date) => date === "04/16").length === 2, "event dates"],
      [result.eventDates.filter((date) => date === "03/26").length === 2 && result.eventDates.filter((date) => date === "01/22").length === 2, "SPA dates"],
      [result.eventTitles.some((label) => label.includes("SPA BOM DDD · 01/15")) && result.eventTitles.some((label) => label.includes("SPA Product Freeze · 01/26")), "calculated SPA labels"],
      [result.highlight.includes("01/26") && result.highlight.includes("17D") && result.highlightTitle.includes("SPA Product Freeze"), "SPA freeze highlight"],
      [result.calculatedDates.join("|") === "01/15|01/26", "business-day calculations"],
      [result.phaseWeeks.filter((weeks) => weeks === 1).length === 2, "transition duration"],
      [result.phaseWeeks.filter((weeks) => weeks === 2).length === 2, "distribution duration"],
      [result.phaseWeeks.filter((weeks) => weeks === 8).length === 3, "LTWT duration"],
      [result.weekLabels.length === 32 && result.weekLabels[0] === "09/07" && result.weekLabels.at(-1) === "04/12", "weekly axis"],
      [result.comparison[0].includes("12/29") && result.comparison[1].includes("+2W 3D") && result.comparison[2].includes("+11W 1D"), "result comparison"],
      [result.activeNav, "active navigation"],
      [result.navigationRoundTrip, "navigation round trip"],
      [result.sidebarRestored, "sidebar toggle"],
      [result.monthTrackDelta <= 2, "month/track alignment"],
      [result.maxEventHeadDelta <= 2, "one-week event heads"],
      [result.maxPhaseSpanDelta <= 2, "weekly phase spans"],
      [result.clippedEvents === 0, "event bounds"],
      [result.clippedText === 0, "event text clipping"],
      [result.eventCount === 29 && result.phaseCount === 7, "item counts"],
      [result.gridLineCounts.every((count) => count === 32), "weekly grids"],
      [viewport.width < 1400 || result.horizontalOverflow === 0, "desktop overflow"],
      [result.verticalOverflow === 0, "vertical overflow"]
    ];
    const failed = assertions.filter(([passed]) => !passed).map(([, label]) => label);
    if (failed.length) {
      throw new Error(`${viewport.name} QA failed: ${failed.join(", ")}\n${JSON.stringify(result, null, 2)}`);
    }

    await page.locator(".wt-app").screenshot({
      path: path.join(outputDir, `wt-leadtime-${viewport.name}.png`),
      animations: "disabled"
    });
    console.log(`${viewport.name}: ${JSON.stringify(result)}`);
    await page.close();
  }

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
}
