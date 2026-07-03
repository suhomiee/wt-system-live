#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const WORK_ORDER_RE = /^WT[0-9]{3}-[0-9]{3}$/i;
const DEFAULT_YEAR = Number(process.env.TCMS_RUNNING_WT_YEAR || new Date().getFullYear());
const INCOMPLETE = "\ubbf8\uc644\ub8cc";
const COMPLETE = "\uc644\ub8cc";
const CANCELLED = "\ucde8\uc18c";

main().catch((error) => {
  console.error(error && error.stack || String(error));
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || process.env.TCMS_RUNNING_WT_SOURCE_URL || process.env.TCMS_RUNNING_WT_SOURCE_FILE;
  const output = args.output || "tcms-wt-events.json";
  const year = Number(args.year || DEFAULT_YEAR);
  const minCount = Number(args["min-count"] || process.env.TCMS_RUNNING_WT_MIN_COUNT || 0);
  const sourceCategory = clean(args.category || process.env.TCMS_RUNNING_WT_CATEGORY || "");

  if (!input) {
    throw new Error("Missing TCMS source. Pass --input or set TCMS_RUNNING_WT_SOURCE_URL.");
  }

  const payload = await readInput(input);
  const rows = parseSource(payload);
  const updatedAt = args["updated-at"] || process.env.TCMS_RUNNING_WT_SYNC_TIMESTAMP || new Date().toISOString();
  const events = rows.map((row) => normalizeRow(row, year, updatedAt, sourceCategory)).filter(Boolean);
  events.sort((a, b) => {
    const dateSort = String(a.date).localeCompare(String(b.date));
    if (dateSort) return dateSort;
    return String(a.tcmsWorkOrderNo).localeCompare(String(b.tcmsWorkOrderNo));
  });

  if (events.length < minCount) {
    throw new Error(`TCMS WT event count ${events.length} is below minimum ${minCount}.`);
  }

  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs.writeFile(output, asciiJson(events) + "\n", "utf8");
  console.log(`Wrote ${events.length} TCMS Running WT events to ${output}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function readInput(input) {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { cache: "no-store" });
    if (!response.ok) throw new Error(`TCMS source HTTP ${response.status}`);
    return response.text();
  }
  return fs.readFile(input, "utf8");
}

function parseSource(payload) {
  const trimmed = payload.trim();
  if (!trimmed) return [];
  try {
    const value = JSON.parse(trimmed);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.rows)) return value.rows;
  } catch {
    // Fall through to TCMS XML text export parsing.
  }
  return parseTcmsXmlLines(trimmed);
}

function parseTcmsXmlLines(xml) {
  const rows = [];
  const lineRe = /<line>([\s\S]*?)<\/line>/g;
  let lineMatch;
  while ((lineMatch = lineRe.exec(xml))) {
    const cells = [];
    const cellRe = /<cell\b[^>]*>([\s\S]*?)<\/cell>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(lineMatch[1]))) {
      cells.push(decodeXml(cellMatch[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function normalizeRow(row, year, updatedAt, sourceCategory) {
  const isArray = Array.isArray(row);
  const workOrderNo = clean(isArray ? row[0] : pick(row, ["tcmsWorkOrderNo", "workOrderNo", "work_order", "orderNo", "\uc811\uc218\ubc88\ud638"]));
  if (!WORK_ORDER_RE.test(workOrderNo)) return null;

  const modelName = clean(isArray ? row[1] : pick(row, ["modelName", "model", "MODEL"]));
  const bomNo = clean(isArray ? row[2] : pick(row, ["tcmsBomNo", "bomNo", "bom", "BOM#"]));
  const gender = clean(isArray ? row[3] : pick(row, ["tcmsGender", "gender", "G"]));
  const quantity = clean(isArray ? row[4] : pick(row, ["tcmsQuantity", "quantity", "qty", "\uc218\ub7c9"]));
  const tdCode = clean(isArray ? row[5] : pick(row, ["tcmsTdCode", "tdCode", "td", "TD CODE"]));
  const orderReceivedRaw = clean(isArray ? row[6] : pick(row, ["tcmsOrderReceivedDate", "orderReceivedDate", "orderReceived", "\uc624\ub354\uc811\uc218"]));
  const etsRaw = clean(isArray ? row[7] : pick(row, ["tcmsEtsRaw", "tcmsEtsDate", "ets", "etsDate", "ETS"]));
  const importantNote = clean(isArray ? row[9] : pick(row, ["tcmsImportantNote", "importantNote", "notes", "\uc911\uc694\uc0ac\ud56d"]));
  const manufacturingRaw = clean(isArray ? row[48] : pick(row, ["manufacturingPlanRaw", "manufacturingPlanDate", "manufacturingPlan", "mfgPlan", "\uc81c\uc870 \uc644\ub8cc"]));
  const owner = clean(isArray ? row[55] : pick(row, ["tcmsOwner", "owner", "\ub2f4\ub2f9\uc790"]));
  const season = clean(isArray ? row[56] : pick(row, ["season", "SEASON"])) || "All";
  const rowCategory = clean(isArray ? "" : pick(row, ["tcmsCategory", "category", "categoryName", "tcmsCategoryName", "workCategory", "\uce74\ud14c\uace0\ub9ac"]));
  const category = rowCategory || sourceCategory;
  const status = clean(isArray ? "" : pick(row, ["tcmsStatus", "tcmsCompletionStatus", "completionStatus", "status"])) || INCOMPLETE;

  if (!isRunningCategory(category) || isCompleteStatus(status)) return null;

  const planDate = parseTcmsDate(manufacturingRaw, year) ||
    parseTcmsDate(isArray ? "" : pick(row, ["date", "manufacturingPlanDate"]), year);
  if (!planDate) return null;

  const etsDate = parseTcmsDate(etsRaw, year) || "";
  const task = `WT ${workOrderNo} - ${season}${modelName ? ` / ${modelName}` : ""} / MFG Plan ${manufacturingRaw || planDate}`;

  return {
    id: `TCMS-${workOrderNo}`,
    date: planDate,
    season,
    gate: "WT",
    task,
    kind: "tcms_wt_order",
    week: "",
    source: "tcms",
    source_line: `TCMS Running incomplete WT | WO=${workOrderNo} | BOM=${bomNo} | TD=${tdCode} | ETS=${etsRaw} | manufacturingPlan=${manufacturingRaw}`,
    modelName,
    tcmsWorkOrderNo: workOrderNo,
    tcmsCategory: category,
    tcmsStatus: status,
    tcmsCompletionStatus: status,
    manufacturingPlanDate: planDate,
    manufacturingPlanRaw: manufacturingRaw,
    tcmsBomNo: bomNo,
    tcmsTdCode: tdCode,
    tcmsGender: gender,
    tcmsQuantity: quantity,
    tcmsOrderReceivedDate: orderReceivedRaw,
    tcmsEtsDate: etsDate,
    tcmsEtsRaw: etsRaw,
    tcmsOwner: owner,
    tcmsImportantNote: importantNote,
    updatedAt
  };
}

function pick(row, keys) {
  for (const key of keys) {
    if (row && row[key] != null && String(row[key]).trim()) return row[key];
  }
  return "";
}

function clean(value) {
  return String(value == null ? "" : value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTcmsDate(value, year) {
  const text = clean(value);
  if (!text) return "";
  const iso = text.match(/\b(20[0-9]{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12][0-9]|3[01])\b/);
  if (iso) return [iso[1], pad(iso[2]), pad(iso[3])].join("-");
  const monthDay = text.match(/\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12][0-9]|3[01])(?:\s*(?:AM|PM))?\b/i);
  if (!monthDay) return "";
  return [String(year), pad(monthDay[1]), pad(monthDay[2])].join("-");
}

function isRunningCategory(value) {
  const text = clean(value).toLowerCase();
  return !text || text.includes("running");
}

function isCompleteStatus(value) {
  const text = clean(value).toLowerCase();
  if (!text || text.includes(INCOMPLETE)) return false;
  return /\b(completed|complete|done|closed|cancelled|canceled)\b/.test(text) ||
    text.includes(COMPLETE) ||
    text.includes(CANCELLED);
}

function decodeXml(value) {
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function asciiJson(value) {
  return JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/g, (char) => {
    const code = char.codePointAt(0);
    if (code <= 0xffff) return `\\u${code.toString(16).padStart(4, "0")}`;
    const offset = code - 0x10000;
    const high = 0xd800 + (offset >> 10);
    const low = 0xdc00 + (offset & 0x3ff);
    return `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
  });
}

function pad(value) {
  return String(value).padStart(2, "0");
}
