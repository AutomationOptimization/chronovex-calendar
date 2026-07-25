import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** Boot BRAID inside a throwaway DOM and hand back the app module. */
async function bootApp() {
  const { JSDOM } = await import("jsdom");
  const html = await readFile(new URL("../braid/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/braid/" });
  global.window = dom.window;
  global.document = dom.window.document;
  const app = await import(`../braid/app.js?editing=${Math.random()}`);
  app.boot();
  return {
    app,
    window: dom.window,
    done() { app.stopClocks(); delete global.window; delete global.document; dom.window.close(); },
  };
}

test("editing a line lands in your own intent layer, attributed to you", async () => {
  const { app, window, done } = await bootApp();
  try {
    const before = window.document.querySelectorAll(".code-line").length;
    app.beginEdit(3);
    app.commitEdit("const HANDOFF_WINDOW = 90; // mine");

    const mine = app.state.files["presence.ts"].ops.filter((op) => op.layer === app.MY_LAYER);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].kind, "edit");
    assert.ok(mine[0].symbols.includes("HANDOFF_WINDOW"), "symbols are extracted so threads and beams can anchor");
    assert.equal(window.document.querySelectorAll(".code-line").length, before, "an edit replaces a line rather than adding one");
    assert.ok(window.document.querySelector(".code-line.tone-amber"), "your layer is painted like everyone else's");
  } finally { done(); }
});

test("inserting and deleting lines changes the woven document length", async () => {
  const { app, window, done } = await bootApp();
  try {
    const before = window.document.querySelectorAll(".code-line").length;
    app.insertLine(2);
    app.commitEdit("// a line only you have shaped");
    assert.equal(window.document.querySelectorAll(".code-line").length, before + 1);

    app.deleteLine(5);
    assert.equal(window.document.querySelectorAll(".code-line").length, before);
  } finally { done(); }
});

test("editing a line another layer owns surfaces a real collision", async () => {
  const { app, window, done } = await bootApp();
  try {
    // Line 11 of the woven document is Amara's edited HANDOFF_WINDOW line.
    const target = [...window.document.querySelectorAll(".code-line.layer-presence")][0];
    const n = Number(target.dataset.line);
    app.beginEdit(n);
    app.commitEdit("const HANDOFF_WINDOW = 400; // yours, conflicting");

    assert.ok(window.document.querySelector(".code-line.is-collided"), "the collision is shown in place");
    const score = Number(window.document.querySelector("#health-score").textContent);
    assert.ok(score < 90, `convergence score drops on collision (got ${score})`);
    assert.match(window.document.querySelector("#converge-button strong").textContent, /Resolve 1 collision/);
  } finally { done(); }
});

test("a future is an isolated copy that collapses back as operations", async () => {
  const { app, done } = await bootApp();
  try {
    app.spawnFuture();
    const future = app.state.futures[0];
    assert.equal(future.file, "presence.ts");
    future.base[0] = "// rewritten inside the future";
    assert.equal(app.state.files["presence.ts"].base[0], 'import { fabric, type Mind } from "@braid/runtime";', "the shared file is untouched while the future evolves");

    app.adoptFuture(future.id);
    assert.equal(app.state.futures.length, 0);
    assert.ok(app.state.files["presence.ts"].ops.some((op) => op.layer === app.MY_LAYER), "collapsing lands as your intent layer, not a silent overwrite");
  } finally { done(); }
});

test("the continuum rewinds to a moment where later layers did not exist", async () => {
  const { app, window, done } = await bootApp();
  try {
    assert.ok(window.document.querySelectorAll(".code-line.layer-checkpoint").length > 0);
    app.state.position = 0;      // the session opening, before any intent was raised
    app.render();
    assert.equal(window.document.querySelectorAll("[data-layer]").length, 0, "the past is the document as it actually was");
    assert.ok(window.document.querySelector(".time-banner"), "and it is clearly marked as a past moment");

    app.state.position = 1;
    app.render();
    assert.ok(window.document.querySelectorAll(".code-line.layer-checkpoint").length > 0, "returning to the live edge restores every layer");
  } finally { done(); }
});
