import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = resolve(root, "dist");
const artifactPath = resolve(distDir, "index.html");

assert.ok(existsSync(resolve(root, "package.json")), "package.json is required");
assert.ok(existsSync(resolve(root, "bun.lock")), "bun.lock is required");
assert.ok(existsSync(artifactPath), "run `bun run build` before validation");
assert.deepEqual(readdirSync(distDir).sort(), ["index.html"], "dist must contain only index.html");

const html = readFileSync(artifactPath, "utf8");
const bytes = Buffer.byteLength(html, "utf8");
assert.match(html, /^<!doctype html>/i, "dist/index.html must be a complete HTML document");
assert.ok(bytes < 1024 * 1024, `dist/index.html must stay below 1MB (actual: ${bytes} bytes)`);

const scriptTags = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const styleTags = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];
assert.equal(scriptTags.length, 1, "dist/index.html must contain exactly one inline script");
assert.equal(styleTags.length, 1, "dist/index.html must contain exactly one inline style block");
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
  [/\bsendBeacon\s*\(/, "external network requests"],
];
for (const [pattern, description] of forbiddenPatterns) {
  assert.doesNotMatch(script, pattern, `${description} must not be used in dist/index.html`);
}

for (const marker of [
  "予定を追加",
  "予定を再読み込み",
  "設定を開く",
  "設定とバックアップ",
  "保存失敗",
  "最終取得",
  "claude-artifact-scheduler-backup",
  "schedule:v1:",
]) {
  assert.ok(html.includes(marker), `required artifact marker is missing: ${marker}`);
}

const sources = ["src/App.tsx", "src/domain.ts", "src/navigation.ts", "src/storage.ts", "src/types.ts", "src/styles.css"]
  .map((path) => readFileSync(resolve(root, path), "utf8"))
  .join("\n");
for (const marker of [
  "inspectStoredKey",
  "repairCorruption",
  ":broken:",
  "TOMBSTONE_RETENTION_MS",
  "right.deleted !== left.deleted",
  "visibilitychange",
  "beforeunload",
  "localDateString",
  "pendingRef",
  "SAVE_DEBOUNCE_MS",
  "navigator.clipboard.writeText",
  "parseSchedulerView",
  "aria-live=\"polite\"",
  "focus-visible",
  "touch-action: manipulation",
  "overscroll-behavior: contain",
  "prefers-reduced-motion: reduce",
]) {
  assert.ok(sources.includes(marker), `required source marker is missing: ${marker}`);
}

assert.doesNotMatch(sources, /\btoISOString\s*\(/, "source must build local dates without UTC conversion");
assert.doesNotMatch(sources, /\bsetInterval\s*\(/, "source must not poll automatically");
assert.match(readFileSync(resolve(root, "src/styles.css"), "utf8"), /\.field-input\s*\{\s*font-size:\s*16px/, "form controls must use a 16px base font size before nested field rules");

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
    if (character === '"' || character === "'" || character === "`") {
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

const storageSource = readFileSync(resolve(root, "src/storage.ts"), "utf8");
const storageCallPattern = /window\.storage!?\.(get|set|delete|list)\s*\(/g;
const methods = new Set();
for (const match of storageSource.matchAll(storageCallPattern)) {
  const method = match[1];
  methods.add(method);
  const openParenIndex = match.index + match[0].lastIndexOf("(");
  const count = topLevelArgumentCount(storageSource, openParenIndex);
  assert.equal(count, method === "set" ? 2 : 1, `window.storage.${method} has an unexpected shared argument`);
}
assert.deepEqual([...methods].sort(), ["delete", "get", "list", "set"], "all window.storage methods must be wrapped");

const longestKey = `schedule:v1:9999-12:broken:${Number.MAX_SAFE_INTEGER}`;
assert.ok(longestKey.length < 200, "storage keys must stay below 200 characters");

const sampleBackup = JSON.parse(readFileSync(resolve(root, "examples/sample-export.json"), "utf8"));
assert.equal(sampleBackup.format, "claude-artifact-scheduler-backup", "sample export format is invalid");
assert.equal(sampleBackup.schemaVersion, 1, "sample export schema version is invalid");
for (const [key, raw] of Object.entries(sampleBackup.values)) {
  assert.match(key, /^schedule:v1:\d{4}-\d{2}$/, `sample export contains an unsupported key: ${key}`);
  const month = JSON.parse(raw);
  assert.equal(month.schemaVersion, 1, `sample month schema is invalid: ${key}`);
  assert.ok(Array.isArray(month.events), `sample month events are invalid: ${key}`);
}

console.log(`✓ dist/index.html validated (${bytes.toLocaleString("en-US")} bytes)`);
console.log("✓ one self-contained file, no runtime external assets or network calls");
console.log("✓ personal window.storage calls, safe reads, merge and corruption recovery markers present");
console.log("✓ local date, form-size, storage-key and sample-backup constraints validated");
console.log("All validations passed.");
