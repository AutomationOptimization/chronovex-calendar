import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../braid/${file}`, import.meta.url), "utf8");

test("BRAID ships every entry point the page needs", async () => {
  await Promise.all(["index.html", "styles.css", "app.js", "fabric-core.js", "fabric-sync.js", "fabric-relay.js", "relay-config.js", "huddle.js", "guide.js", "favicon.svg"].map(
    (file) => access(new URL(`../braid/${file}`, import.meta.url))));
});

test("BRAID assets stay relative so the app works under a Pages subpath", async () => {
  const html = await read("index.html");
  assert.match(html, /href="\.\/styles\.css\?v=\d+"/);
  assert.match(html, /src="\.\/app\.js\?v=\d+"/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/);
});

test("no unrendered template placeholders leak into the markup", async () => {
  const html = await read("index.html");
  assert.doesNotMatch(html, /\$\{/, "a literal ${...} in the HTML means a template string was never evaluated");
});

test("every data-icon in the markup has a glyph in the icon set", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
  const used = new Set([...html.matchAll(/data-icon="([\w-]+)"/g)].map((match) => match[1]));
  const defined = new Set([...app.matchAll(/^\s{2}"?([\w-]+)"?:\s*'</gm)].map((match) => match[1]));
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `icons referenced but not defined: ${missing.join(", ")}`);
});

test("the app boots in a DOM and renders the woven fabric", async () => {
  const { JSDOM } = await import("jsdom");
  const html = await read("index.html");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/braid/" });
  const { window } = dom;
  global.window = window;
  global.document = window.document;

  let app;
  try {
    app = await import("../braid/app.js");
    app.boot();

    const lines = window.document.querySelectorAll(".code-line");
    assert.ok(lines.length > 20, "the shared document renders its lines");
    assert.ok(window.document.querySelector(".code-line.layer-presence"), "layer attribution is painted onto the fabric");
    assert.ok(window.document.querySelectorAll(".editor-tab").length >= 3, "open files render as tabs");
    // Two living threads are still open, so the fabric is deliberating rather than ready.
    assert.equal(window.document.querySelector("#health-score").textContent, "90");
    assert.equal(window.document.querySelector("#health-title").textContent, "Consensus is forming");

    const before = window.document.querySelectorAll(".code-line.layer-latency").length;
    assert.ok(before > 0);
    app.toggleLayer("latency");
    assert.equal(window.document.querySelectorAll(".code-line.layer-latency").length, 0, "lifting a layer removes it from the woven document");

    app.toggleLayer("latency");
    app.runConverge();
    const remaining = Object.values(app.state.files).flatMap((file) => file.ops);
    assert.deepEqual(remaining, [], "convergence seals every layer's operations at once");
    assert.equal(window.document.querySelectorAll("[data-layer]").length, 0, "the sealed state is plain shared code");
  } finally {
    app?.stopClocks();
    delete global.window;
    delete global.document;
    window.close();
  }
});

test("boot ignores anything that is not a document", async () => {
  const app = await read("app.js");
  // boot() doubles as a DOMContentLoaded listener, which would hand it an Event.
  assert.match(app, /DOMContentLoaded",\s*\(\)\s*=>\s*boot\(\)\)/,
    "the listener must not pass its Event to boot");
  assert.match(app, /target\?\.nodeType === 9 \? target : null/,
    "and boot must reject a non-document argument outright");
});

test("the single-file bundle actually runs, including convergence", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readFile, rm } = await import("node:fs/promises");
  const { JSDOM } = await import("jsdom");

  const out = join(tmpdir(), `braid-bundle-${process.pid}.html`);
  await promisify(execFile)("node", ["scripts/bundle-braid.mjs", out, "--fragment"], { cwd: process.cwd() });
  const fragment = await readFile(out, "utf8");
  t.after(() => rm(out, { force: true }));

  assert.doesNotMatch(fragment, /^\s*import\s/m, "no import statement survives inlining");
  assert.doesNotMatch(fragment, /^\s*export\s/m, "and no export statement either");

  // jsdom cannot run type=module, so run the identical code as a classic script.
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${fragment.replace('<script type="module">', "<script>")}</body></html>`,
    { runScripts: "dangerously", url: "https://artifact.test/", pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (event) => errors.push(event.message));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const doc = window.document;
  const click = (selector) => {
    const node = doc.querySelector(selector);
    assert.ok(node, `expected ${selector} in the bundle`);
    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  };

  assert.ok(doc.querySelectorAll(".code-line").length > 20, "the bundled app renders the fabric");

  // Convergence lives behind an aliased import; inlining once broke exactly this.
  click("#converge-button");
  click('[data-action="confirm-converge"]');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(doc.querySelectorAll("[data-layer]").length, 0, "converging in the bundle really sealed the layers");
  assert.deepEqual(errors, [], "and the page raised no errors");
  window.close();
});
