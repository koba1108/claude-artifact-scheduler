import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactPath = resolve(root, "artifact.html");
const html = readFileSync(artifactPath, "utf8");
const bytes = Buffer.byteLength(html, "utf8");

assert.deepEqual(readdirSync(root).filter((name) => name.endsWith(".html")), ["artifact.html"], "artifact.html must be the only root HTML file");
assert.ok(!existsSync(resolve(root, "package.json")), "package manager metadata is not allowed");

assert.match(html, /^<!doctype html>/i, "artifact.html must be a complete HTML document");
assert.ok(bytes < 5 * 1024 * 1024, `artifact.html must stay below 5MB (actual: ${bytes} bytes)`);

const scriptTags = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const styleTags = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];
assert.equal(scriptTags.length, 1, "artifact.html must contain exactly one inline script");
assert.equal(styleTags.length, 1, "artifact.html must contain exactly one inline style block");
assert.doesNotMatch(html, /<script\s+[^>]*src=/i, "external scripts are not allowed");
assert.doesNotMatch(html, /<link\s+[^>]*rel=["']?stylesheet/i, "external stylesheets are not allowed");
assert.doesNotMatch(html, /<(?:img|audio|video|source)\s+[^>]*src=["']?https?:/i, "external media is not allowed");
assert.doesNotMatch(styleTags[0][1], /url\s*\(\s*["']?https?:/i, "external CSS assets are not allowed");

const script = scriptTags[0][1];
const forbiddenPatterns = [
  [/localStorage/, "local browser persistence"],
  [/sessionStorage/, "session browser persistence"],
  [/indexedDB/i, "browser database persistence"],
  [/document\s*\.\s*cookie/, "cookie persistence"],
  [/cookieStore/, "cookie persistence"],
  [/\btoISOString\s*\(/, "UTC date conversion"],
  [/\bsetInterval\s*\(/, "automatic polling"],
  [/\bfetch\s*\(/, "external network requests"],
  [/\bXMLHttpRequest\b/, "external network requests"],
  [/\bWebSocket\b/, "external network requests"],
  [/\bEventSource\b/, "external network requests"],
  [/\bsendBeacon\s*\(/, "external network requests"]
];

for (const [pattern, description] of forbiddenPatterns) {
  assert.doesNotMatch(script, pattern, `${description} must not be used in artifact.html`);
}

for (const id of [
  "calendarGrid", "eventList", "eventDialog", "settingsDialog", "reloadButton", "retryButton",
  "exportButton", "importButton", "statusText", "updatedAtText", "updatedByText", "fetchedAtText"
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `required UI element is missing: ${id}`);
}

for (const marker of [
  "window.storage.get", "window.storage.set", "window.storage.delete", "window.storage.list",
  "schedule:v1:", "SAVE_DEBOUNCE_MS = 800", "pendingOperations", "loadCertainty",
  "inspectStoredKey", "repairCorruption", ":broken:", "TOMBSTONE_RETENTION_MS",
  "right.deleted !== left.deleted", "visibilitychange", "beforeunload", "localDateString",
  "claude-artifact-scheduler-backup", "mergeEvents", "navigator.clipboard.writeText"
]) {
  assert.ok(script.includes(marker), `required implementation marker is missing: ${marker}`);
}

const prefixMatch = script.match(/const STORAGE_PREFIX = ["']([^"']+)["']/);
assert.ok(prefixMatch, "STORAGE_PREFIX must be a string literal");
assert.equal(prefixMatch[1], "schedule:v1:", "the v1 storage prefix must remain stable");
assert.match(prefixMatch[1], /^[A-Za-z0-9._:-]+$/, "storage prefix contains unsupported characters");
assert.ok(`${prefixMatch[1]}9999-12:broken:${Number.MAX_SAFE_INTEGER}`.length < 512, "storage keys must stay below 512 characters");

function topLevelArgumentCount(source, openParenIndex) {
  let depth = 1;
  let commas = 0;
  let quote = null;
  let escaped = false;
  for (let index = openParenIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return commas + 1;
    } else if (character === "," && depth === 1) commas += 1;
  }
  throw new Error("unterminated window.storage call");
}

const storageCallPattern = /window\.storage\.(get|set|delete|list)\s*\(/g;
for (const match of script.matchAll(storageCallPattern)) {
  const method = match[1];
  const openParenIndex = match.index + match[0].lastIndexOf("(");
  const count = topLevelArgumentCount(script, openParenIndex);
  const expected = method === "set" ? 2 : 1;
  assert.equal(count, expected, `window.storage.${method} must receive exactly ${expected} argument(s)`);
}

const css = styleTags[0][1];
const cssRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
let inputFontRuleFound = false;
for (const rule of cssRules) {
  const selectors = rule[1].split(",").map((selector) => selector.trim());
  if (!selectors.some((selector) => /(^|[\s>+~])(?:input|select|textarea)(?:$|[\s.#:[>+~])/.test(selector))) continue;
  for (const fontSize of rule[2].matchAll(/font-size\s*:\s*([0-9.]+)px/gi)) {
    inputFontRuleFound = true;
    assert.ok(Number(fontSize[1]) >= 16, `form control font-size must be at least 16px (actual: ${fontSize[1]}px)`);
  }
}
assert.ok(inputFontRuleFound, "form controls must declare a font-size of at least 16px");

function extractNamedFunction(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function is missing: ${name}`);
  const openBrace = script.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openBrace; index < script.length; index += 1) {
    const character = script[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

const mergeLogic = new Function(`
  const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  ${extractNamedFunction("clone")}
  ${extractNamedFunction("chooseEvent")}
  ${extractNamedFunction("mergeEvents")}
  ${extractNamedFunction("cleanExpiredTombstones")}
  return { chooseEvent, mergeEvents, cleanExpiredTombstones };
`)();

const baseEvent = { id: "a", updatedAt: 100, deleted: false, title: "old" };
assert.equal(mergeLogic.chooseEvent(baseEvent, { ...baseEvent, updatedAt: 101, title: "new" }).title, "new", "newer event must win");
assert.equal(mergeLogic.chooseEvent(baseEvent, { ...baseEvent, deleted: true }).deleted, true, "deletion must win an equal-timestamp tie");
assert.equal(mergeLogic.chooseEvent({ ...baseEvent, deleted: true }, baseEvent).deleted, true, "deletion tie-break must be order independent");
assert.deepEqual(
  mergeLogic.mergeEvents([baseEvent], [{ ...baseEvent, id: "b" }]).map((event) => event.id).sort(),
  ["a", "b"],
  "different event IDs must both survive a merge"
);
assert.equal(
  mergeLogic.cleanExpiredTombstones([{ ...baseEvent, deleted: true, updatedAt: 0 }], 31 * 24 * 60 * 60 * 1000).length,
  0,
  "expired tombstones must be removed"
);

const sampleBackup = JSON.parse(readFileSync(resolve(root, "examples/sample-export.json"), "utf8"));
assert.equal(sampleBackup.format, "claude-artifact-scheduler-backup", "sample export format is invalid");
assert.equal(sampleBackup.schemaVersion, 1, "sample export schema version is invalid");
for (const [key, raw] of Object.entries(sampleBackup.values)) {
  assert.match(key, /^schedule:v1:\d{4}-\d{2}$/, `sample export contains an unsupported key: ${key}`);
  const month = JSON.parse(raw);
  assert.equal(month.schemaVersion, 1, `sample month schema is invalid: ${key}`);
  assert.ok(Array.isArray(month.events), `sample month events are invalid: ${key}`);
}

try {
  new Function(script);
} catch (error) {
  throw new Error(`inline JavaScript syntax error: ${error.message}`, { cause: error });
}

console.log(`✓ artifact.html validated (${bytes.toLocaleString("en-US")} bytes)`);
console.log("✓ single file, no external assets, no browser-local persistence or network calls");
console.log("✓ safe storage reads, merge, tombstone, corruption backup and debounce markers present");
console.log("✓ merge rules and sample backup validated");
console.log("All validations passed.");
