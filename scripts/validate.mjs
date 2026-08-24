import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactPath = resolve(root, "index.html");
const html = readFileSync(artifactPath, "utf8");
const bytes = Buffer.byteLength(html, "utf8");

assert.match(html, /^<!doctype html>/i, "index.html must be a complete HTML document");
assert.ok(bytes < 5 * 1024 * 1024, `index.html must stay below 5MB (actual: ${bytes} bytes)`);

const scriptTags = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const styleTags = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];
assert.equal(scriptTags.length, 1, "index.html must contain exactly one inline script");
assert.equal(styleTags.length, 1, "index.html must contain exactly one inline style block");
assert.doesNotMatch(html, /<script\s+[^>]*src=/i, "external scripts are not allowed");
assert.doesNotMatch(html, /<link\s+[^>]*rel=["']?stylesheet/i, "external stylesheets are not allowed");

for (const forbidden of ["localStorage", "sessionStorage", "indexedDB"]) {
  assert.ok(!html.includes(forbidden), `${forbidden} must not be used in index.html`);
}

for (const required of [
  "window.storage.get",
  "window.storage.set",
  "window.storage.delete",
  "window.storage.list",
  "schedule:v1:",
  "SAVE_DEBOUNCE_MS",
  "pendingOperations",
  "deleted",
  "updatedAt"
]) {
  assert.ok(html.includes(required), `required implementation marker is missing: ${required}`);
}

assert.match(styleTags[0][1], /input[\s\S]*font-size:\s*16px/i, "input font-size must be at least 16px");

try {
  // Parse only. The function is not invoked, so DOM/window access does not run in Node.js.
  new Function(scriptTags[0][1]);
} catch (error) {
  throw new Error(`inline JavaScript syntax error: ${error.message}`, { cause: error });
}

console.log(`✓ index.html validated (${bytes.toLocaleString("en-US")} bytes)`);
console.log("✓ single-file / no external assets / no browser-local persistence");
console.log("✓ window.storage, merge, tombstone, debounce markers present");
