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
    await page.locator(".wt-lead-event").first().hover();
    await page.waitForTimeout(160);

    const result = await page.evaluate(() => {
      const pageRoot = document.querySelector(".wt-lead-page");
      const track = document.querySelector(".wt-lead-track");
      const laneTitles = Array.from(document.querySelectorAll(".wt-lead-lane h2")).map((node) => node.textContent.trim());
      const laneResultDates = Array.from(document.querySelectorAll("[data-lead-result]")).map((node) => node.textContent.trim());
      const eventDates = Array.from(document.querySelectorAll(".wt-lead-event")).map((node) => node.dataset.date);
      const eventTitles = Array.from(document.querySelectorAll(".wt-lead-event")).map((node) => node.getAttribute("title"));
      const phaseWeeks = Array.from(document.querySelectorAll(".wt-lead-phase")).map((node) => Number(node.dataset.weeks));
      const weekNodes = Array.from(document.querySelectorAll(".wt-lead-weeks span"));
      const weekLabels = weekNodes.map((node) => node.textContent.trim());
      const weekOffsets = weekNodes.map((node) => Number(node.dataset.weekOffset));
      const weekTitles = weekNodes.map((node) => node.getAttribute("title"));
      const activeNav = document.querySelector('.wt-primary-nav [data-section="leadtime"].active');
      const pageRect = pageRoot.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      const monthTrack = document.querySelector(".wt-lead-months").getBoundingClientRect();
      const cellWidth = trackRect.width / weekLabels.length;
      const eventBounds = Array.from(document.querySelectorAll(".wt-lead-event")).map((node) => node.getBoundingClientRect());
      const clippedEvents = eventBounds.filter((rect) => rect.left < trackRect.left - 1 || rect.right > trackRect.right + 1).length;
      const clippedTextNodes = Array.from(document.querySelectorAll(".wt-lead-event > span")).filter((node) => node.scrollWidth > node.clientWidth + 1);
      const phaseSpanDeltas = Array.from(document.querySelectorAll(".wt-lead-phase")).map((node) => {
        return Math.abs(node.getBoundingClientRect().width - cellWidth * Number(node.dataset.weeks));
      });
      const comparison = Array.from(document.querySelectorAll(".wt-lead-result")).map((node) => node.textContent.replace(/\s+/g, " ").trim());
      const highlight = document.querySelector(".wt-lead-event.is-highlight");
      const calculatedDates = Array.from(document.querySelectorAll('.wt-lead-event[data-calculated="true"]')).map((node) => node.dataset.date);
      const combinedTrack = document.querySelector(".wt-lead-track.is-combined");
      const tkgTrack = document.querySelector(".wt-lead-track.is-tkg");
      const pairGaps = ["BOM Deadline · 10/21", "Sample X-FTY · 12/25"].map((title) => {
        const calendar = document.querySelector(`.wt-lead-event.is-calendar[title="${title}"]`)?.getBoundingClientRect();
        const running = document.querySelector(`.wt-lead-event.is-running[title="${title}"]`)?.getBoundingClientRect();
        return calendar && running ? Math.round(running.top - calendar.bottom) : null;
      });
      const phaseChains = ["calendar", "running", "tkg"].map((laneId) => {
        const rects = Array.from(document.querySelectorAll(`.wt-lead-phase.is-${laneId}`))
          .sort((a, b) => Number(a.dataset.chainIndex) - Number(b.dataset.chainIndex))
          .map((node) => node.getBoundingClientRect());
        return {
          laneId,
          gaps: rects.slice(1).map((rect, index) => Math.round(rect.left - rects[index].right)),
          rowCount: new Set(rects.map((rect) => Math.round(rect.top))).size
        };
      });
      const hoveredEvent = document.querySelector(".wt-lead-event");
      const hoveredDateStyle = getComputedStyle(hoveredEvent, "::after");

      return {
        title: document.querySelector(".wt-lead-header h1")?.textContent.trim(),
        advantage: document.querySelector(".wt-lead-advantage")?.textContent.replace(/\s+/g, " ").trim(),
        laneTitles,
        laneResultDates,
        eventDates,
        eventTitles,
        phaseWeeks,
        weekLabels,
        weekOffsets,
        weekTitles,
        weekAxisLabel: document.querySelector(".wt-lead-axis-label")?.textContent.replace(/\s+/g, " ").trim(),
        zeroAxisCount: document.querySelectorAll(".wt-lead-weeks .is-zero").length,
        zeroGridCount: document.querySelectorAll(".wt-lead-track-grid .is-zero").length,
        comparison,
        highlight: highlight?.textContent.replace(/\s+/g, " ").trim(),
        highlightDate: highlight?.dataset.date,
        highlightTitle: highlight?.getAttribute("title"),
        calculatedDates,
        laneCount: document.querySelectorAll(".wt-lead-lane").length,
        combinedLaneCount: document.querySelectorAll(".wt-lead-lane.is-combined").length,
        pairGaps,
        phaseChains,
        combinedTrackHeight: Math.round(combinedTrack.getBoundingClientRect().height),
        tkgTrackHeight: Math.round(tkgTrack.getBoundingClientRect().height),
        activeNav: Boolean(activeNav),
        navigationRoundTrip: Boolean(document.querySelector(".wt-lead-page")),
        sidebarRestored: !document.querySelector(".wt-app")?.classList.contains("is-sidebar-collapsed"),
        pageFitsViewport: pageRect.width <= window.innerWidth + 1,
        monthTrackDelta: Math.round(Math.abs(monthTrack.width - trackRect.width)),
        visibleDateHeadCount: document.querySelectorAll(".wt-lead-event > b").length,
        hoveredDateContent: hoveredDateStyle.content.replaceAll('"', ""),
        hoveredDateOpacity: Number(hoveredDateStyle.opacity),
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
      [result.laneCount === 2 && result.combinedLaneCount === 1, "combined Calendar and Running lane"],
      [result.pairGaps.every((gap) => gap >= 3 && gap <= 5), "paired event spacing"],
      [result.combinedTrackHeight <= 226 && result.tkgTrackHeight <= 140, "compact lane heights"],
      [result.phaseChains.every((chain) => chain.rowCount === 1), "single-row phase chains"],
      [result.phaseChains.every((chain) => chain.gaps.every((gap) => gap >= -1 && gap <= 0)), "joined phase chains"],
      [result.eventDates.length === 29 && result.eventDates.filter((date) => date === "04/16").length === 2, "event dates"],
      [result.eventDates.filter((date) => date === "03/26").length === 2 && result.eventDates.filter((date) => date === "01/22").length === 2, "SPA dates"],
      [result.eventTitles.some((label) => label.includes("SPA BOM DDD · 01/15")) && result.eventTitles.some((label) => label.includes("SPA Product Freeze · 01/26")), "calculated SPA labels"],
      [result.highlightDate === "01/26" && result.highlight.includes("17D") && result.highlightTitle.includes("SPA Product Freeze"), "SPA freeze highlight"],
      [result.calculatedDates.join("|") === "01/15|01/26", "business-day calculations"],
      [result.phaseWeeks.filter((weeks) => weeks === 1).length === 2, "transition duration"],
      [result.phaseWeeks.filter((weeks) => weeks === 2).length === 2, "distribution duration"],
      [result.phaseWeeks.filter((weeks) => weeks === 8).length === 3, "LTWT duration"],
      [result.weekLabels.length === 32 && result.weekLabels[0] === "-7WKS" && result.weekLabels.at(-1) === "+24WKS", "weekly labels"],
      [result.weekOffsets[0] === -7 && result.weekOffsets[7] === 0 && result.weekOffsets.at(-1) === 24, "weekly offsets"],
      [result.weekLabels.every((label) => !label.includes("/")) && result.weekTitles[0].includes("09/07"), "dates demoted from axis"],
      [result.weekAxisLabel.includes("T2 FPT 1ST REPORT = 0") && result.zeroAxisCount === 1 && result.zeroGridCount === 2, "week zero reference"],
      [result.comparison[0].includes("12/29") && result.comparison[1].includes("+2W 3D") && result.comparison[2].includes("+11W 1D"), "result comparison"],
      [result.activeNav, "active navigation"],
      [result.navigationRoundTrip, "navigation round trip"],
      [result.sidebarRestored, "sidebar toggle"],
      [result.monthTrackDelta <= 2, "month/track alignment"],
      [result.visibleDateHeadCount === 0, "dates hidden by default"],
      [result.hoveredDateContent === "10/21" && result.hoveredDateOpacity === 1, "date shown on hover"],
      [result.maxPhaseSpanDelta <= 2, "weekly phase spans"],
      [result.clippedEvents === 0, "event bounds"],
      [result.clippedText === 0, "event text clipping"],
      [result.eventCount === 29 && result.phaseCount === 7, "item counts"],
      [result.gridLineCounts.length === 2 && result.gridLineCounts.every((count) => count === 32), "weekly grids"],
      [viewport.width < 1400 || result.horizontalOverflow === 0, "desktop overflow"],
      [result.verticalOverflow === 0, "vertical overflow"]
    ];
    const failed = assertions.filter(([passed]) => !passed).map(([, label]) => label);
    if (failed.length) {
      throw new Error(`${viewport.name} QA failed: ${failed.join(", ")}\n${JSON.stringify(result, null, 2)}`);
    }

    await page.mouse.move(0, 0);
    await page.waitForTimeout(160);
    await page.locator(".wt-lead-page").screenshot({
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
