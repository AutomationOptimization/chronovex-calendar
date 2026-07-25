import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EMPTY_ROOM, applyMessage, rosterOf, snapshotOf } from "../relay/room-core.js";

/**
 * End-to-end collaboration, run in one process.
 *
 * The room here is not a mock: it is the same `applyMessage` the deployed
 * Durable Object runs, wired to in-memory sockets. Two real app instances,
 * each in its own window with its own identity, talk through it. What passes
 * here is what happens between two laptops.
 */
class TestRoom {
  constructor() {
    this.state = { ...EMPTY_ROOM };
    this.sockets = new Map();
  }

  join(mind, socket) {
    this.sockets.set(mind, socket);
    socket.deliver({ type: "snapshot", from: "room", payload: snapshotOf(this.state) });
    this.broadcast(rosterOf([...this.sockets.keys()]));
  }

  leave(mind) {
    this.sockets.delete(mind);
    this.broadcast({ type: "bye", from: mind });
  }

  broadcast(message, except) {
    for (const [mind, socket] of this.sockets) {
      if (except && mind === except) continue;
      socket.deliver(message);
    }
  }

  receive(mind, message) {
    const stamped = { ...message, from: mind };
    const result = applyMessage(this.state, stamped, { now: Date.now() });
    if (result.relay && result.to) { this.sockets.get(result.to)?.deliver(result.relay); return; }
    if (result.changed) this.state = result.room;
    if (result.broadcast) {
      this.broadcast(result.broadcast, result.broadcast.type === "state" ? undefined : mind);
    }
  }
}

function socketClass(room) {
  return class RoomSocket {
    constructor(url) {
      this.readyState = 0;
      this.mind = new URL(url).searchParams.get("mind");
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
        room.join(this.mind, this);
      });
    }
    send(raw) { room.receive(this.mind, JSON.parse(raw)); }
    deliver(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    close() { this.readyState = 3; room.leave(this.mind); this.onclose?.(); }
  };
}

async function joinRoom(room, label) {
  const { JSDOM } = await import("jsdom");
  const html = await readFile(new URL("../braid/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://example.test/braid/#room=shared&relay=https://relay.test",
    pretendToBeVisual: true,
  });
  dom.window.WebSocket = socketClass(room);
  global.window = dom.window;
  global.document = dom.window.document;
  const app = await import(`../braid/app.js?peer=${label}`);
  app.boot(dom.window.document);        // each instance owns its own DOM
  return {
    app,
    window: dom.window,
    doc: dom.window.document,
    text: () => dom.window.document.querySelector("#code-lines").textContent,
    edit(line, next) {
      app.beginEdit(line);
      app.commitEdit(next);
    },
    done() { app.stopClocks(); dom.window.close(); },
  };
}

// Publishing is debounced, so give a change time to travel and come back.
const settle = () => new Promise((resolve) => setTimeout(resolve, 260));

test("an edit made by one person appears in the other person's document", async () => {
  const room = new TestRoom();
  const a = await joinRoom(room, "a");
  await settle();
  const b = await joinRoom(room, "b");
  await settle();

  try {
    assert.doesNotMatch(b.text(), /HANDOFF_WINDOW = 400/);
    a.edit(11, "const HANDOFF_WINDOW = 400; // widened by A");
    await settle();

    assert.match(b.text(), /widened by A/, "B sees what A typed");
    assert.match(a.text(), /widened by A/);
  } finally { a.done(); b.done(); }
});

test("two people editing different lines both keep their work", async () => {
  const room = new TestRoom();
  const a = await joinRoom(room, "a");
  await settle();
  const b = await joinRoom(room, "b");
  await settle();

  try {
    a.edit(4, "export type Caret = {  // A was here");
    await settle();
    b.edit(13, "  const carets = new Map(); // B was here");
    await settle();

    for (const person of [a, b]) {
      assert.match(person.text(), /A was here/, "A's edit survived");
      assert.match(person.text(), /B was here/, "B's edit survived");
    }
  } finally { a.done(); b.done(); }
});

test("two people reshaping the same line see the same collision", async () => {
  const room = new TestRoom();
  const a = await joinRoom(room, "a");
  await settle();
  const b = await joinRoom(room, "b");
  await settle();

  try {
    const line = Number(a.doc.querySelector(".code-line.layer-presence").dataset.line);
    a.edit(line, "const HANDOFF_WINDOW = 111; // A");
    await settle();
    b.edit(line, "const HANDOFF_WINDOW = 222; // B");
    await settle();

    assert.ok(a.doc.querySelector(".code-line.is-collided"), "A sees the collision");
    assert.ok(b.doc.querySelector(".code-line.is-collided"), "B sees it too");
    assert.match(a.doc.querySelector("#converge-button strong").textContent, /Resolve/, "and neither can converge past it");
    assert.match(b.doc.querySelector("#converge-button strong").textContent, /Resolve/);
  } finally { a.done(); b.done(); }
});

test("the fabric outlives everyone leaving", async () => {
  const room = new TestRoom();
  const first = await joinRoom(room, "first");
  await settle();
  first.edit(4, "export type Caret = {  // written before anyone else arrived");
  await settle();
  first.done();                                  // everybody closes their browser
  assert.equal(room.sockets.size, 0);

  const later = await joinRoom(room, "later");
  await settle();
  try {
    assert.match(later.text(), /before anyone else arrived/,
      "someone who was never there opens the link and finds the work waiting");
  } finally { later.done(); }
});

test("everyone converges to the same document, whoever edited what", async () => {
  const room = new TestRoom();
  const a = await joinRoom(room, "a");
  await settle();
  const b = await joinRoom(room, "b");
  await settle();

  try {
    a.edit(4, "export type Caret = {  // A");
    await settle();
    b.edit(6, "  offset: number; // B");
    await settle();
    a.edit(9, "};  // A again");
    await settle();

    assert.equal(a.text(), b.text(), "both people are looking at exactly the same document");
  } finally { a.done(); b.done(); }
});

test("people appear to each other as connected minds", async () => {
  const room = new TestRoom();
  const a = await joinRoom(room, "a");
  await settle();
  const b = await joinRoom(room, "b");
  await settle();

  try {
    assert.ok(a.doc.querySelectorAll(".avatar.is-live").length >= 1, "A sees B in the room");
    assert.ok(b.doc.querySelectorAll(".avatar.is-live").length >= 1, "B sees A");
    assert.match(a.doc.querySelector("#status-sync").textContent, /room/, "and the status says so honestly");
  } finally { a.done(); b.done(); }
});

test("what one person is typing shows up as a ghost before they commit", async () => {
  const room = new TestRoom();
  const a = await joinRoom(room, "a");
  await settle();
  const b = await joinRoom(room, "b");
  await settle();

  try {
    a.app.beginEdit(4);
    const input = a.doc.querySelector("[data-editor]");
    input.textContent = "export type Caret = {  // half a thought";
    input.oninput();
    await settle();

    const ghost = b.doc.querySelector(".ghost-text");
    assert.ok(ghost, "B sees A typing");
    assert.match(ghost.textContent, /half a thought/);

    a.app.commitEdit(input.textContent);
    await settle();
    assert.equal(b.doc.querySelector(".ghost-text"), null, "and the ghost clears once it is committed");
    assert.match(b.text(), /half a thought/, "leaving the real line behind");
  } finally { a.done(); b.done(); }
});
