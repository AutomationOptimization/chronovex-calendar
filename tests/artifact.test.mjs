import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const required = [
  "index.html",
  "styles.css",
  "app.js",
  "calendar-core.js",
  "manifest.webmanifest",
  "sw.js",
  ".github/workflows/deploy-pages.yml",
];

test("GitHub Pages artifact contains every required entry point", async () => {
  await Promise.all(required.map((file) => access(new URL(`../${file}`, import.meta.url))));
});

test("browser assets use repository-relative URLs", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/);
});
