import test from "node:test";
import assert from "node:assert/strict";

import { EMPTY_ROOM, applyMessage, isEphemeral, isStale, rosterOf, snapshotOf } from "../relay/room-core.js";
import { createRelay, newRoomId, resolveRelay, socketUrl } from "../braid/fabric-relay.js";

const stateMessage = (ops, extra = {}) => ({
  type: "state",
  from: "mind-a",
  payload: { files: { "presence.ts": { base: ["a", "b"], ops } }, threads: [], tombstones: [], baseVersion: 0, ...extra },
});

test("the first client seeds an empty room", () => {
  const result = applyMessage(EMPTY_ROOM, stateMessage([{ id: "o1", layer: "mine-a", at: 0, kind: "edit", text: "a — mine" }]), { now: 5 });
  assert.equal(result.changed, true);
  assert.equal(result.room.seeded, true);
  assert.equal(result.room.files["presence.ts"].ops.length, 1);
  assert.equal(result.broadcast.type, "state", "and everyone is told the authoritative result");
  assert.equal(result.room.updatedAt, 5);
});

test("the room merges two people's work rather than letting the last write win", () => {
  const first = applyMessage(EMPTY_ROOM, stateMessage([{ id: "o1", layer: "mine-a", at: 0, kind: "edit", text: "mine" }]), { now: 1 });
  const second = applyMessage(first.room, {
    ...stateMessage([{ id: "o2", layer: "mine-b", at: 1, kind: "edit", text: "theirs" }]),
    from: "mind-b",
  }, { now: 2 });

  const ops = second.room.files["presence.ts"].ops;
  assert.equal(ops.length, 2, "both intents are in the stored fabric");
  assert.deepEqual(ops.map((op) => op.id).sort(), ["o1", "o2"]);
});

test("re-sending a state the room already has changes nothing and says nothing", () => {
  const seeded = applyMessage(EMPTY_ROOM, stateMessage([{ id: "o1", layer: "mine-a", at: 0, kind: "edit", text: "mine" }]), { now: 1 });
  const echo = applyMessage(seeded.room, stateMessage([{ id: "o1", layer: "mine-a", at: 0, kind: "edit", text: "mine" }]), { now: 9 });
  assert.equal(echo.changed, false);
  assert.equal(echo.broadcast, null, "no broadcast storm");
  assert.equal(echo.room.updatedAt, 1, "and the room's clock does not move");
});

test("the stored fabric is what a later visitor receives", () => {
  const seeded = applyMessage(EMPTY_ROOM, stateMessage([{ id: "o1", layer: "mine-a", at: 0, kind: "edit", text: "mine" }]), { now: 1 });
  const snapshot = snapshotOf(seeded.room);
  assert.deepEqual(Object.keys(snapshot.files), ["presence.ts"]);
  assert.equal(snapshot.files["presence.ts"].ops[0].text, "mine");
  assert.equal(typeof snapshot.baseVersion, "number");
});

test("presence and handshakes pass through without being stored", () => {
  for (const type of ["caret", "ghost", "huddle", "hello", "bye"]) {
    const result = applyMessage(EMPTY_ROOM, { type, from: "mind-a", payload: { x: 1 } }, { now: 3 });
    assert.equal(isEphemeral(type), true);
    assert.equal(result.changed, false, `${type} is not persisted`);
    assert.equal(result.broadcast.type, type, `${type} is relayed`);
  }
});

test("a WebRTC handshake goes to one named peer, not the whole room", () => {
  const result = applyMessage(EMPTY_ROOM, { type: "signal", from: "mind-a", to: "mind-b", payload: { kind: "offer" } }, { now: 1 });
  assert.equal(result.to, "mind-b");
  assert.equal(result.broadcast, null, "an offer is never broadcast");
  assert.equal(result.relay.payload.kind, "offer");
});

test("junk is ignored rather than corrupting the room", () => {
  for (const junk of [null, {}, { type: 42 }, { type: "state" }, { type: "state", payload: null }]) {
    const result = applyMessage(EMPTY_ROOM, junk, { now: 1 });
    assert.equal(result.changed, false);
    assert.equal(result.broadcast, null);
  }
});

test("rooms nobody has touched for a month are stale", () => {
  const month = 1000 * 60 * 60 * 24 * 30;
  assert.equal(isStale({ updatedAt: 1 }, 1 + month + 1), true);
  assert.equal(isStale({ updatedAt: 1 }, 1 + month - 1), false);
  assert.equal(isStale(EMPTY_ROOM, Date.now()), false, "a room that was never used is not stale, it is empty");
});

test("the roster names everyone currently connected", () => {
  assert.deepEqual(rosterOf(["a", "b"]), { type: "roster", from: "room", payload: { minds: ["a", "b"] } });
});

/* ------------------------------- client side ------------------------------ */

test("the room and server are resolvable from the link, then remembered", () => {
  const store = new Map([["braid-relay-url", "https://saved.example"]]);
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };

  const fromLink = resolveRelay({ location: { search: "", hash: "#room=abc123&relay=https://link.example" }, storage });
  assert.deepEqual(fromLink, { url: "https://link.example", room: "abc123" });

  const fromStorage = resolveRelay({ location: { search: "", hash: "#room=abc123" }, storage });
  assert.equal(fromStorage.url, "https://saved.example", "a remembered server is used when the link omits one");

  const fromFallback = resolveRelay({ location: { search: "", hash: "" }, storage: null, fallback: "https://built-in.example" });
  assert.equal(fromFallback.url, "https://built-in.example");
  assert.equal(fromFallback.room, "", "no room in the link means the app makes one");
});

test("room ids are unguessable enough to be the invitation", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRoomId()));
  assert.equal(ids.size, 200, "no collisions");
  assert.ok([...ids].every((id) => /^[a-z0-9]{10,}$/.test(id)));
});

test("the socket url carries the room and the mind, over wss", () => {
  const url = socketUrl("https://braid-relay.example", "abc123", "mind-x");
  assert.equal(url, "wss://braid-relay.example/room/abc123?mind=mind-x");
  assert.match(socketUrl("http://127.0.0.1:8787", "r", "m"), /^ws:\/\/127\.0\.0\.1:8787\/room\/r/);
  assert.equal(socketUrl("", "r", "m"), "", "no server means no socket");
});

test("the relay client announces itself, carries messages, and reconnects", async () => {
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    deliver(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }

  const seen = [];
  const statuses = [];
  const relay = createRelay({
    url: "https://relay.example",
    room: "abc123",
    identity: { id: "mind-x", name: "Mind X" },
    onMessage: (message) => seen.push(message),
    onStatus: (status) => statuses.push(status),
    WebSocketImpl: FakeSocket,
  });

  assert.equal(sockets.length, 1);
  assert.match(sockets[0].url, /wss:\/\/relay\.example\/room\/abc123\?mind=mind-x/);

  sockets[0].open();
  assert.deepEqual(statuses, ["connecting", "live"]);
  assert.equal(sockets[0].sent[0].type, "hello", "it announces itself on arrival");

  relay.send({ type: "state", payload: { files: {} } });
  assert.equal(sockets[0].sent[1].type, "state");
  assert.equal(sockets[0].sent[1].who.id, "mind-x", "messages carry who sent them");

  sockets[0].deliver({ type: "snapshot", payload: { files: {} } });
  assert.equal(seen[0].type, "snapshot", "the stored fabric arrives on connect");

  sockets[0].close();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(sockets.length, 2, "a dropped socket reconnects on its own");
  assert.equal(statuses.at(-1), "retrying");

  relay.close();
  assert.equal(relay.status, "offline");
});

test("with no server configured the client stays quietly offline", () => {
  const statuses = [];
  const relay = createRelay({ url: "", room: "", identity: { id: "m" }, onStatus: (s) => statuses.push(s) });
  assert.equal(relay.connected, false);
  assert.equal(relay.send({ type: "state" }), false, "nothing is sent into the void");
  assert.deepEqual(statuses, [], "and it does not thrash trying");
  relay.close();
});
