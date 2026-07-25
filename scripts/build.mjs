import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(".");
const output = resolve("_site");
const files = [
  "index.html",
  "404.html",
  "styles.css",
  "app.js",
  "calendar-core.js",
  "manifest.webmanifest",
  "favicon.svg",
  "sw.js",
  ".nojekyll",
];
// Each app ships as its own directory under the same Pages site.
const apps = ["braid"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  ...files.map((file) => cp(resolve(source, file), resolve(output, file))),
  ...apps.map((app) => cp(resolve(source, app), resolve(output, app), { recursive: true })),
]);
console.log(`Built ${files.length} static files and ${apps.length} app(s) into _site/`);
