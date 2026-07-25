import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * These tests drive the app the way a person does: real click and key events
 * dispatched at real elements. Calling exported functions directly proves the
 * model works; only this proves the app is wired to it.
 */
async function bootApp() {
  const { JSDOM } = await import("jsdom");
  const html = await readFile(new URL("../braid/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/braid/", pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  const app = await import(`../braid/app.js?ui=${Math.random()}`);
  app.boot();
  const { window } = dom;

  const click = (target) => {
    const node = typeof target === "string" ? window.document.querySelector(target) : target;
    assert.ok(node, `expected to find ${target}`);
    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    return node;
  };
  const press = (key, options = {}) => window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));

  return { app, window, click, press, done() { app.stopClocks(); delete global.window; delete global.document; window.close(); } };
}

test("clicking a line selects it and shows the line tools", async () => {
  const { window, click, done } = await bootApp();
  try {
    click('.code-line[data-line="4"]');
    assert.ok(window.document.querySelector('.code-line[data-line="4"].is-selected'), "the clicked line is selected");
    assert.ok(window.document.querySelector(".line-toolbar"), "the line tools appear for the selection");
  } finally { done(); }
});

test("clicking the selected line opens an editor you can type into", async () => {
  const { window, click, press, done } = await bootApp();
  try {
    click('.code-line[data-line="4"]');
    click('.code-line[data-line="4"]');

    const input = window.document.querySelector("[data-editor]");
    assert.ok(input, "a second click opens the inline editor");

    input.textContent = "  mind: Mind; // shaped by hand";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    const line = window.document.querySelector('.code-line[data-line="4"] .code-text');
    assert.match(line.textContent, /shaped by hand/, "the typed text is in the document");
    assert.ok(window.document.querySelector(".code-line.tone-amber"), "and it is attributed to your layer");
  } finally { done(); }
});

test("the Shape line button opens the editor too", async () => {
  const { window, click, done } = await bootApp();
  try {
    click('.code-line[data-line="6"]');
    click('[data-action="edit-line"]');
    assert.ok(window.document.querySelector("[data-editor]"), "the toolbar button opens the editor");
  } finally { done(); }
});

test("every header and footer control does something visible", async () => {
  const { window, click, done } = await bootApp();
  try {
    const toasts = () => window.document.querySelectorAll(".toast").length;

    click(".huddle-button");
    assert.ok(window.document.querySelector(".huddle-button.is-live"), "huddle turns on and says so");
    assert.ok(toasts() > 0, "huddle confirms itself with a toast");
    click(".huddle-button");
    assert.equal(window.document.querySelector(".huddle-button.is-live"), null, "and turns back off");

    click(".invite-button");
    assert.ok(window.document.querySelector("#invite-dialog[open]"), "invite opens the dialog");
    click("#invite-dialog .dialog-close");

    click('[data-action="toggle-ghosts"]');
    assert.equal(window.document.querySelector('[data-action="toggle-ghosts"] .switch.is-on'), null, "the ghost switch flips");

    click('[data-action="open-command"]');
    assert.equal(window.document.querySelector("#command-palette").hidden, false, "the palette opens");
  } finally { done(); }
});

test("switching modes from the rail actually swaps the view", async () => {
  const { window, click, done } = await bootApp();
  try {
    for (const [mode, heading] of [["layers", "Intent layers"], ["futures", "Parallel futures"], ["threads", "Living threads"], ["pulse", "Runtime pulse"]]) {
      click(`.nav-button[data-mode="${mode}"]`);
      assert.equal(window.document.querySelector(".mode-view h2").textContent, heading, `${mode} renders its own view`);
    }
    click('.nav-button[data-mode="fabric"]');
    assert.ok(window.document.querySelector(".code-line"), "and the fabric comes back");
  } finally { done(); }
});

test("toggling a layer from the convergence panel re-weaves the document", async () => {
  const { window, click, done } = await bootApp();
  try {
    assert.ok(window.document.querySelectorAll(".code-line.layer-latency").length > 0);
    click('.intent-card[data-intent="latency"]');
    assert.equal(window.document.querySelectorAll(".code-line.layer-latency").length, 0, "the layer lifts out of the document");
    click('.intent-card[data-intent="latency"]');
    assert.ok(window.document.querySelectorAll(".code-line.layer-latency").length > 0, "and weaves back in");
  } finally { done(); }
});

test("the file tree opens files and the tab strip switches between them", async () => {
  const { window, click, done } = await bootApp();
  try {
    click('.file-row[data-file="converge.ts"]');
    assert.equal(window.document.querySelector("#context-file").textContent, "converge.ts");
    click('.editor-tab[data-tab="presence.ts"]');
    assert.equal(window.document.querySelector("#context-file").textContent, "presence.ts");
  } finally { done(); }
});

test("scrubbing the continuum from a click rewinds the document", async () => {
  const { window, click, done } = await bootApp();
  try {
    click('.timeline-event[data-moment="0"]');
    assert.ok(window.document.querySelector(".time-banner"), "the past is marked");
    assert.equal(window.document.querySelectorAll("[data-layer]").length, 0, "and shows no later layers");
    click(".live-edge");
    assert.equal(window.document.querySelector(".time-banner"), null, "returning to live clears it");
  } finally { done(); }
});

test("starting a thread from the toolbar anchors it to the line", async () => {
  const { app, window, click, done } = await bootApp();
  try {
    click('.code-line[data-line="12"]');
    click('[data-action="start-thread"]');
    const composer = window.document.querySelector("[data-composer]");
    assert.ok(composer, "the composer opens on the line");

    window.document.querySelector("#thread-title").value = "Does this need a guard?";
    composer.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.ok(app.state.threads.some((thread) => thread.title === "Does this need a guard?"), "the thread is stored");
  } finally { done(); }
});

test("the command palette runs the command under the cursor", async () => {
  const { app, window, click, press, done } = await bootApp();
  try {
    press("k", { metaKey: true });
    assert.equal(window.document.querySelector("#command-palette").hidden, false);
    const input = window.document.querySelector("#command-input");
    input.value = "pulse";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    click("#command-results button");
    assert.equal(app.state.mode, "pulse", "the palette actually ran the command");
  } finally { done(); }
});

test("the app survives a browser that refuses storage and channels", async () => {
  const { JSDOM } = await import("jsdom");
  const html = await readFile(new URL("../braid/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/braid/" });
  // A sandboxed iframe throws on these rather than returning undefined.
  Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("SecurityError"); } });
  Object.defineProperty(dom.window, "BroadcastChannel", { get() { throw new Error("SecurityError"); } });
  global.window = dom.window;
  global.document = dom.window.document;
  try {
    const app = await import(`../braid/app.js?sandbox=${Math.random()}`);
    app.boot();
    assert.ok(dom.window.document.querySelectorAll(".code-line").length > 20, "the fabric still renders");
    app.stopClocks();
  } finally {
    delete global.window;
    delete global.document;
    dom.window.close();
  }
});
