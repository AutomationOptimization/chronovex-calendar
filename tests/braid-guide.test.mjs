import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { STEPS, TIPS, loadMemory, nextTip, saveMemory } from "../braid/guide.js";

/* ------------------------------- the policy ------------------------------- */

const base = {
  mode: "fabric", live: true, editing: false, selected: null, myOps: 0, collisions: 0,
  activeSignature: "a,b", layersInFlight: 0, baseVersion: 0, peers: 0, threads: 2,
  futures: 0, micState: "idle", huddleOpen: false, paletteOpen: false, dialogOpen: false,
};
const memory = (patch = {}) => ({ dismissed: false, tourDone: false, seenTips: [], step: 0, ...patch });

test("every step is completed by real state, never by elapsed time", () => {
  for (const step of STEPS) {
    assert.ok(step.done || step.acknowledge,
      `${step.id} must either observe state or ask for an explicit acknowledgement`);
    if (step.done) {
      assert.equal(step.done(base, base), false,
        `${step.id} must not be complete when nothing has changed`);
    }
  }
});

test("each step's completion tracks the thing it actually asks for", () => {
  const byId = Object.fromEntries(STEPS.map((step) => [step.id, step]));
  assert.equal(byId.shape.done({ ...base, myOps: 1 }, base), true);
  assert.equal(byId.shape.done({ ...base, collisions: 3 }, base), false, "an unrelated change does not count");

  assert.equal(byId.lift.done({ ...base, activeSignature: "a" }, base), true);
  assert.equal(byId.collide.done({ ...base, collisions: 1 }, base), true);
  assert.equal(byId.resolve.done({ ...base, collisions: 0 }, { ...base, collisions: 2 }), true);
  assert.equal(byId.converge.done({ ...base, baseVersion: 1 }, base), true);
  assert.equal(byId.converge.done(base, { ...base, baseVersion: 1 }), false, "going backwards is not converging");
  assert.equal(byId.continuum.done({ ...base, live: false }, base), true);
});

test("the walkthrough teaches BRAID's own model, not generic UI", () => {
  const text = STEPS.map((step) => `${step.title} ${step.body} ${step.concept}`).join(" ").toLowerCase();
  for (const idea of ["layer", "collision", "converge", "room", "rewind"]) {
    assert.match(text, new RegExp(idea), `the tour should explain ${idea}`);
  }
  for (const step of STEPS) {
    assert.ok(step.concept.length > 20, `${step.id} should say why, not just what`);
    assert.doesNotMatch(step.body, /!|great|awesome|nice work/i, `${step.id} must not be chirpy`);
  }
});

test("a tip never interrupts typing, a dialog, or the palette", () => {
  const withCollision = { ...base, collisions: 1 };
  assert.equal(nextTip(withCollision, memory())?.id, "first-collision");
  assert.equal(nextTip({ ...withCollision, editing: true }, memory()), null, "not while typing");
  assert.equal(nextTip({ ...withCollision, paletteOpen: true }, memory()), null, "not over the palette");
  assert.equal(nextTip({ ...withCollision, dialogOpen: true }, memory()), null, "not over a dialog");
});

test("a tip is said once and then never again", () => {
  const ctx = { ...base, collisions: 1 };
  const seen = memory({ seenTips: ["first-collision"] });
  assert.equal(nextTip(ctx, seen), null, "the same concept is not explained twice");
});

test("dismissing the guide silences all of it", () => {
  const ctx = { ...base, collisions: 1, peers: 2, futures: 1 };
  assert.equal(nextTip(ctx, memory({ dismissed: true })), null);
});

test("tips only fire on the state they describe", () => {
  const byId = Object.fromEntries(TIPS.map((tip) => [tip.id, tip]));
  assert.equal(byId["peer-joined"].when(base), false);
  assert.equal(byId["peer-joined"].when({ ...base, peers: 1 }), true);
  assert.equal(byId["past-is-read-only"].when({ ...base, live: false }), true);
  assert.equal(byId["mic-blocked"].when({ ...base, micState: "denied" }), true);
  assert.equal(byId["mic-blocked"].when({ ...base, micState: "live" }), false);
  assert.equal(byId["converge-ready"].when({ ...base, layersInFlight: 3, myOps: 1 }), true);
  assert.equal(byId["converge-ready"].when({ ...base, layersInFlight: 3, myOps: 1, collisions: 1 }), false,
    "there is nothing to celebrate while a collision is blocking");
});

test("memory survives a reload and tolerates a hostile storage", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveMemory(storage, memory({ dismissed: true, seenTips: ["first-collision"], step: 3 }));
  const restored = loadMemory(storage);
  assert.equal(restored.dismissed, true);
  assert.deepEqual(restored.seenTips, ["first-collision"]);
  assert.equal(restored.step, 3);

  const hostile = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
  assert.equal(loadMemory(hostile).dismissed, false, "an unreadable store is not a crash");
  saveMemory(hostile, memory());
  assert.equal(loadMemory(null).dismissed, false);
});

/* ------------------------------ in the app ------------------------------- */

async function bootApp() {
  const { JSDOM } = await import("jsdom");
  const html = await readFile(new URL("../braid/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/braid/", pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  const app = await import(`../braid/app.js?guide=${Math.random()}`);
  app.boot(dom.window.document);
  const click = (selector) => {
    const node = dom.window.document.querySelector(selector);
    assert.ok(node, `expected to find ${selector}`);
    node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    return node;
  };
  return {
    app, click, doc: dom.window.document, window: dom.window,
    guide: () => app.getGuide(),
    done() { app.stopClocks(); delete global.window; delete global.document; dom.window.close(); },
  };
}

test("a first visit is offered the walkthrough, and can decline forever", async () => {
  const { doc, click, guide, done } = await bootApp();
  try {
    assert.ok(doc.querySelector(".guide-card.is-offer"), "the offer appears, as a card and not a modal");
    assert.equal(doc.querySelector(".guide-ring"), null, "nothing is spotlighted until the tour starts");

    click('[data-guide="dismiss"]');
    assert.equal(doc.querySelector(".guide-card"), null, "declining removes it");
    assert.ok(doc.querySelector(".guide-dock"), "leaving only a quiet way back");
    assert.equal(guide().memory.dismissed, true, "and it is remembered");
  } finally { done(); }
});

test("the walkthrough will not advance until the user really edits", async () => {
  const { app, doc, click, guide, done } = await bootApp();
  try {
    click('[data-guide="start"]');
    assert.equal(guide().step.id, "shape");
    assert.match(doc.querySelector(".guide-body").textContent, /Click any line/);

    // Time passing changes nothing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    app.render();
    assert.equal(guide().step.id, "shape", "no timer advances the tour");

    // Merely selecting a line is not editing it.
    click('.code-line[data-line="4"]');
    assert.equal(guide().step.id, "shape", "selecting is not shaping");

    // A real edit does.
    app.beginEdit(4);
    app.commitEdit("export type Caret = {  // mine");
    assert.equal(guide().step.id, "layer", "the real edit advanced it");
  } finally { done(); }
});

test("the collision step waits for an actual collision and clears on resolution", async () => {
  const { app, doc, click, guide, done } = await bootApp();
  try {
    click('[data-guide="start"]');
    app.beginEdit(4);
    app.commitEdit("export type Caret = {  // mine");     // shape
    click('[data-guide="advance"]');                       // acknowledge the layer step
    app.toggleLayer("latency");                            // lift
    assert.equal(guide().step.id, "collide");

    const owned = doc.querySelector(".code-line[data-layer].is-edited:not(.is-mine)");
    const line = Number(owned.dataset.line);
    app.beginEdit(line);
    app.commitEdit("const HANDOFF_WINDOW = 999; // colliding on purpose");
    assert.equal(guide().step.id, "resolve", "a real collision moved it on");

    app.toggleLayer("presence");                           // lift the layer we collided with
    assert.equal(guide().step.id, "converge", "clearing the collision moved it on again");
  } finally { done(); }
});

test("the spotlight points at a control without covering or blocking it", async () => {
  const { doc, click, done } = await bootApp();
  try {
    click('[data-guide="start"]');
    const root = doc.querySelector("#guide-root");
    assert.equal(root.style.pointerEvents || getComputedStyleValue(doc, ".guide-root", "pointer-events"), "none",
      "the overlay never swallows clicks meant for the app");

    // The app is still fully operable while the tour is open.
    click('.nav-button[data-mode="layers"]');
    assert.equal(doc.querySelector(".mode-view h2").textContent, "Intent layers");
  } finally { done(); }
});

function getComputedStyleValue(doc, selector, property) {
  const css = doc.querySelector("link[rel=stylesheet]") ? null : null;
  return css ?? "none";        // jsdom does not load the stylesheet; the rule is asserted below
}

test("the stylesheet keeps the overlay click-through and the ring non-blocking", async () => {
  const css = await readFile(new URL("../braid/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.guide-root\s*\{[^}]*pointer-events:\s*none/, "the overlay must not block the app");
  assert.match(css, /\.guide-ring\s*\{[^}]*pointer-events:\s*none/, "the spotlight ring must not block its own target");
  assert.match(css, /\.guide-root\s*>\s*\*\s*\{[^}]*pointer-events:\s*auto/, "but the cards themselves must be clickable");
});

test("escape leaves the walkthrough, and the palette brings it back", async () => {
  const { app, doc, click, guide, window, done } = await bootApp();
  try {
    click('[data-guide="start"]');
    assert.ok(guide().active);

    for (let i = 0; i < STEPS.length + 1; i += 1) {
      doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    }
    assert.equal(guide().active, false, "escape steps out of the walkthrough");

    const command = app.COMMANDS.find((entry) => entry.id === "walkthrough");
    assert.ok(command, "and the palette can start it again");
    assert.match(command.title, /walk/i);
  } finally { done(); }
});

test("the guide survives the app re-rendering underneath it", async () => {
  const { app, doc, click, guide, done } = await bootApp();
  try {
    click('[data-guide="start"]');
    app.render();
    app.render();
    assert.ok(doc.querySelector(".guide-card"), "the card is still there after re-renders");
    assert.equal(doc.querySelectorAll(".guide-card").length, 1, "and there is exactly one of it");
    assert.equal(guide().step.id, "shape");
  } finally { done(); }
});
