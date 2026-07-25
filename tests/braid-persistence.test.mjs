import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function memoryStorage(values = new Map()) {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    values,
  };
}

function broadcastChannelClass(bus) {
  return class MemoryBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.closed = false;
      if (!bus.has(name)) bus.set(name, new Set());
      bus.get(name).add(this);
    }
    postMessage(data) {
      for (const channel of bus.get(this.name) ?? []) {
        if (channel === this || channel.closed) continue;
        queueMicrotask(() => channel.onmessage?.({ data }));
      }
    }
    close() {
      this.closed = true;
      bus.get(this.name)?.delete(this);
    }
  };
}

async function bootRoom(room, shared, relay = "", BroadcastChannelImpl) {
  const { JSDOM } = await import("jsdom");
  const html = await readFile(new URL("../braid/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: `https://example.test/braid/#room=${encodeURIComponent(room)}${relay ? `&relay=${encodeURIComponent(relay)}` : ""}`,
  });
  Object.defineProperty(dom.window, "localStorage", { value: shared, configurable: true });
  Object.defineProperty(dom.window, "WebSocket", { value: undefined, configurable: true });
  if (BroadcastChannelImpl) {
    Object.defineProperty(dom.window, "BroadcastChannel", { value: BroadcastChannelImpl, configurable: true });
  }
  global.window = dom.window;
  global.document = dom.window.document;
  const app = await import(`../braid/app.js?persistence=${room}-${Math.random()}`);
  app.boot(dom.window.document);
  return {
    app,
    dom,
    done() {
      app.stopClocks();
      dom.window.close();
    },
  };
}

function clearGlobals() {
  delete global.window;
  delete global.document;
}

test("operation ids stay unique across tabs that share one browser identity", async () => {
  const shared = memoryStorage();
  const first = await bootRoom("same-room", shared);
  const second = await bootRoom("same-room", shared);
  try {
    assert.equal(first.app.MY_LAYER, second.app.MY_LAYER, "both tabs correctly share the same author identity");
    first.app.insertLine(2);
    first.app.commitEdit("// first tab");
    second.app.insertLine(7);
    second.app.commitEdit("// second tab");

    const firstId = first.app.state.files["presence.ts"].ops.find((op) => op.text === undefined && op.lines?.includes("// first tab"))?.id;
    const secondId = second.app.state.files["presence.ts"].ops.find((op) => op.text === undefined && op.lines?.includes("// second tab"))?.id;
    assert.ok(firstId && secondId);
    assert.notEqual(firstId, secondId, "distinct edits can never collapse into one id-keyed operation");
  } finally {
    first.done();
    second.done();
    clearGlobals();
  }
});

test("tabs sharing one browser identity still exchange live edits", async () => {
  const shared = memoryStorage();
  const Channel = broadcastChannelClass(new Map());
  const first = await bootRoom("tab-room", shared, "", Channel);
  const second = await bootRoom("tab-room", shared, "", Channel);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 260));
  try {
    assert.equal(first.app.MY_LAYER, second.app.MY_LAYER, "authorship remains stable across tabs");
    await settle();
    first.app.insertLine(2);
    first.app.commitEdit("// crossed the tab boundary");
    await settle();
    assert.match(JSON.stringify(second.app.state.files), /crossed the tab boundary/);
    assert.ok(first.app.state.peers.length >= 1);
    assert.ok(second.app.state.peers.length >= 1);
  } finally {
    first.done();
    second.done();
    clearGlobals();
  }
});

test("local fabric and causal metadata are isolated by room", async () => {
  const shared = memoryStorage();
  const roomA = await bootRoom("room-a", shared);
  try {
    roomA.app.insertLine(2);
    roomA.app.commitEdit("// belongs only to room A");
    roomA.app.state.tombstones.push("removed-in-a");
    roomA.app.state.baseVersion = 7;
    roomA.app.render();
  } finally {
    roomA.done();
  }

  const roomB = await bootRoom("room-b", shared);
  try {
    const text = JSON.stringify(roomB.app.state.files);
    assert.doesNotMatch(text, /belongs only to room A/, "opening an invite cannot publish another room's local work");
    assert.deepEqual(roomB.app.state.tombstones, []);
    assert.equal(roomB.app.state.baseVersion, 0);
  } finally {
    roomB.done();
  }

  const sameSlugElsewhere = await bootRoom("room-a", shared, "https://another-relay.example");
  try {
    assert.doesNotMatch(JSON.stringify(sameSlugElsewhere.app.state.files), /belongs only to room A/,
      "the same room slug on another relay is a different room");
  } finally {
    sameSlugElsewhere.done();
  }

  const restoredA = await bootRoom("room-a", shared);
  try {
    assert.match(JSON.stringify(restoredA.app.state.files), /belongs only to room A/);
    assert.deepEqual(restoredA.app.state.tombstones, ["removed-in-a"]);
    assert.equal(restoredA.app.state.baseVersion, 7);
    const savedRooms = [...shared.values.keys()].filter((key) => key.startsWith("braid-fabric-v1:"));
    assert.ok(savedRooms.some((key) => key.endsWith(":room-a")));
    assert.ok(savedRooms.some((key) => key.endsWith(":room-b")));
  } finally {
    restoredA.done();
    clearGlobals();
  }
});
