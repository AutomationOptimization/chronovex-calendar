import test from "node:test";
import assert from "node:assert/strict";

import { createIdentity, mergeFabric } from "../braid/fabric-sync.js";

const fabric = (ops, base = ["a", "b", "c"], extra = {}) => ({
  files: { "presence.ts": { base, ops } },
  threads: [],
  tombstones: [],
  baseVersion: 0,
  ...extra,
});

test("two minds editing different lines both land", () => {
  const mine = fabric([{ id: "m1", layer: "mine-a", at: 0, kind: "edit", text: "a — mine" }]);
  const theirs = fabric([{ id: "t1", layer: "mine-b", at: 2, kind: "edit", text: "c — theirs" }]);
  const merged = mergeFabric(mine, theirs);
  const ops = merged.files["presence.ts"].ops;
  assert.equal(ops.length, 2);
  assert.deepEqual(ops.map((op) => op.id), ["m1", "t1"]);
  assert.equal(merged.changed, true);
});

test("two minds editing the same line both survive, so the collision stays visible", () => {
  const mine = fabric([{ id: "m1", layer: "mine-a", at: 1, kind: "edit", text: "b — mine" }]);
  const theirs = fabric([{ id: "t1", layer: "mine-b", at: 1, kind: "edit", text: "b — theirs" }]);
  const ops = mergeFabric(mine, theirs).files["presence.ts"].ops;
  assert.equal(ops.length, 2, "neither intent is silently dropped");
  assert.deepEqual(new Set(ops.map((op) => op.layer)), new Set(["mine-a", "mine-b"]));
});

test("merging is idempotent and order-independent", () => {
  const a = fabric([{ id: "m1", layer: "mine-a", at: 0, kind: "edit", text: "x" }]);
  const b = fabric([{ id: "t1", layer: "mine-b", at: 1, kind: "edit", text: "y" }]);
  const ab = mergeFabric(a, b);
  const ba = mergeFabric(b, a);
  assert.deepEqual(ab.files["presence.ts"].ops, ba.files["presence.ts"].ops);
  assert.equal(mergeFabric(ab, b).changed, false, "re-receiving a known state is a no-op");
});

test("a later revision of the same operation wins", () => {
  const older = fabric([{ id: "m1", layer: "mine-a", at: 0, kind: "edit", text: "first", rev: 0 }]);
  const newer = fabric([{ id: "m1", layer: "mine-a", at: 0, kind: "edit", text: "second", rev: 3 }]);
  assert.equal(mergeFabric(older, newer).files["presence.ts"].ops[0].text, "second");
  assert.equal(mergeFabric(newer, older).files["presence.ts"].ops[0].text, "second");
});

test("tombstoned operations are never resurrected by a stale peer", () => {
  const local = fabric([], ["a", "b", "c"], { tombstones: ["m1"] });
  const stale = fabric([{ id: "m1", layer: "mine-a", at: 0, kind: "edit", text: "undone" }]);
  const merged = mergeFabric(local, stale);
  assert.equal(merged.files["presence.ts"].ops.length, 0);
  assert.deepEqual(merged.tombstones, ["m1"]);
});

test("causal metadata changes are persisted even when the visible text does not", () => {
  const local = fabric([]);
  const withTombstone = fabric([], ["a", "b", "c"], { tombstones: ["future-op"] });
  const tombstoned = mergeFabric(local, withTombstone);
  assert.equal(tombstoned.changed, true);
  assert.deepEqual(tombstoned.tombstones, ["future-op"]);
  assert.equal(mergeFabric(tombstoned, withTombstone).changed, false, "replaying the metadata is idempotent");

  const withNewVersion = fabric([], ["a", "b", "c"], { baseVersion: 2 });
  const versioned = mergeFabric(local, withNewVersion);
  assert.equal(versioned.changed, true, "a newer seal matters even with identical text");
  assert.equal(versioned.baseVersion, 2);
  assert.equal(mergeFabric(versioned, withNewVersion).changed, false);
});

test("tombstones dominate operations in files present on only one side", () => {
  const localOnly = fabric([{ id: "gone", layer: "mine-a", at: 0, kind: "edit", text: "stale" }]);
  const remoteRemoval = { files: {}, threads: [], tombstones: ["gone"], baseVersion: 0 };
  const removed = mergeFabric(localOnly, remoteRemoval);
  assert.equal(removed.files["presence.ts"].ops.length, 0);
  assert.equal(removed.changed, true);

  const localRemoval = { files: {}, threads: [], tombstones: ["gone"], baseVersion: 0 };
  const staleRemoteFile = fabric([{ id: "gone", layer: "mine-b", at: 0, kind: "edit", text: "revived" }]);
  const imported = mergeFabric(localRemoval, staleRemoteFile);
  assert.deepEqual(Object.keys(imported.files), ["presence.ts"]);
  assert.equal(imported.files["presence.ts"].ops.length, 0, "the imported file cannot revive its removed op");
  assert.equal(mergeFabric(imported, staleRemoteFile).changed, false);
});

test("a newer convergence moves the sealed text forward; an older one cannot", () => {
  const local = fabric([], ["a", "b", "c"], { baseVersion: 1 });
  const sealed = fabric([], ["sealed"], { baseVersion: 2 });
  assert.deepEqual(mergeFabric(local, sealed).files["presence.ts"].base, ["sealed"]);
  assert.deepEqual(mergeFabric(sealed, local).files["presence.ts"].base, ["sealed"]);
  assert.equal(mergeFabric(local, sealed).baseVersion, 2);
});

test("threads converge on the longer conversation and the higher alignment", () => {
  const local = fabric([], ["a"], { threads: [{ id: "t1", replies: [{ text: "one" }], aligned: 2, resolved: false }] });
  const remote = fabric([], ["a"], { threads: [{ id: "t1", replies: [{ text: "one" }, { text: "two" }], aligned: 5, resolved: false }] });
  const [thread] = mergeFabric(local, remote).threads;
  assert.equal(thread.replies.length, 2);
  assert.equal(thread.aligned, 5);
});

test("a file only one mind has is carried over, not lost", () => {
  const local = fabric([]);
  const remote = { ...fabric([]), files: { ...fabric([]).files, "new.ts": { base: ["fresh"], ops: [] } } };
  const merged = mergeFabric(local, remote);
  assert.deepEqual(Object.keys(merged.files).sort(), ["new.ts", "presence.ts"]);
});

test("identity is stable across reloads of the same browser", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const first = createIdentity(storage);
  const second = createIdentity(storage);
  assert.deepEqual(first, second);
  assert.match(first.id, /^mind-/);
  assert.equal(first.initials.length, 2);
  assert.notDeepEqual(first, createIdentity({ getItem: () => null, setItem: () => {} }));
});
