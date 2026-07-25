/**
 * Inline BRAID into a single self-contained page (styles + modules embedded),
 * for hosts that can only serve one file — e.g. a shared artifact link.
 *   node scripts/bundle-braid.mjs <output.html> [--fragment]
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [output = "braid-standalone.html", ...flags] = process.argv.slice(2);
const fragment = flags.includes("--fragment");
const read = (file) => readFile(resolve("braid", file), "utf8");

const [html, css, core, sync, app] = await Promise.all([
  read("index.html"), read("styles.css"), read("fabric-core.js"), read("fabric-sync.js"), read("app.js"),
]);

const script = [
  core.replace(/^export /gm, ""),
  sync.replace(/^export /gm, ""),
  app
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\.\/fabric-core\.js";\n/m, "")
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/fabric-sync\.js";\n/m, "")
    .replace(/^export \{[^}]*\};?\s*$/m, "")
    .replace(/\bconverge as convergeFabric\b/g, "convergeFabric"),
].join("\n");

const body = html
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script type="module" src="\.\/app\.js\?v=\d+"><\/script>/, "");

const page = `${fragment ? "" : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n`}` +
  `<title>BRAID — Many minds. One codebase.</title>\n<style>\n${css}\n</style>\n` +
  `${fragment ? "" : "</head>\n<body>\n"}${body}\n<script type="module">\n${script}\n</script>\n` +
  `${fragment ? "" : "</body>\n</html>\n"}`;

await writeFile(resolve(output), page, "utf8");
console.log(`Bundled BRAID into ${output} (${Math.round(page.length / 1024)}kb)`);
