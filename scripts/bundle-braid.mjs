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

const [html, css, core, relay, relayConfig, sync, huddle, optiLines, voice, opti, guide, app] = await Promise.all([
  read("index.html"), read("styles.css"), read("fabric-core.js"), read("fabric-relay.js"), read("relay-config.js"), read("fabric-sync.js"), read("huddle.js"), read("opti-lines.js"), read("voice.js"), read("opti.js"), read("guide.js"), read("app.js"),
]);

const script = [
  core.replace(/^export /gm, ""),
  relayConfig.replace(/^export /gm, ""),
  relay.replace(/^export /gm, ""),
  sync.replace(/^export /gm, "").replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/fabric-relay\.js";\n/m, ""),
  huddle.replace(/^export /gm, ""),
  optiLines.replace(/^export /gm, ""),
  voice.replace(/^export /gm, ""),
  opti.replace(/^export /gm, "").replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/opti-lines\.js";\n/m, ""),
  guide.replace(/^export /gm, "").replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/opti\.js";\n/m, ""),
  app
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\.\/fabric-core\.js";\n/m, "")
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/fabric-sync\.js";\n/m, "")
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/huddle\.js";\n/m, "")
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/guide\.js";\n/m, "")
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/voice\.js";\n/m, "")
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/fabric-relay\.js";\n/m, "")
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/relay-config\.js";\n/m, "")
    .replace(/^export \{[^}]*\};?\s*$/m, "")
    // Import aliases vanish with the import statement, so re-create the binding.
    .replace(/^/, 'const convergeFabric = converge;\n'),
].join("\n");

const body = html
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script type="module" src="\.\/app\.js\?v=\d+"><\/script>/, "");

const page = `${fragment ? "" : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n`}` +
  `<title>BRAID — Many minds. One codebase.</title>\n<style>\n${css}\n</style>\n` +
  `${fragment ? "" : "</head>\n<body>\n"}${body}\n<script type="module">\n${script}\n</script>\n` +
  `${fragment ? "" : "</body>\n</html>\n"}`;

// Concatenation shares one scope, so two modules declaring the same top-level
// name is a syntax error at load. Catch it here instead of in someone's browser.
const declared = new Map();
for (const [, keyword, name] of script.matchAll(/^(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
  declared.set(name, (declared.get(name) ?? 0) + 1);
  void keyword;
}
const clashes = [...declared].filter(([, count]) => count > 1).map(([name]) => name);
if (clashes.length > 0) {
  throw new Error(`Bundle would not load: these top-level names are declared more than once — ${clashes.join(", ")}. Rename one of them.`);
}

await writeFile(resolve(output), page, "utf8");
console.log(`Bundled BRAID into ${output} (${Math.round(page.length / 1024)}kb)`);
