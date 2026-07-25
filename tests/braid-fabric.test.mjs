import test from "node:test";
import assert from "node:assert/strict";

import {
  blastRadius,
  converge,
  convergenceScore,
  createRng,
  formatAgo,
  pulseHealth,
  stateAt,
  tokenize,
  weave,
} from "../braid/fabric-core.js";

const BASE = ["const a = 1;", "function run() {", "  return a;", "}"];
const OPS = [
  { layer: "alpha", author: "AM", kind: "edit", at: 0, text: "const a = 2;", symbols: ["a"] },
  { layer: "beta", author: "NO", kind: "insert", at: 1, lines: ["  log(a);"], symbols: ["log"] },
];

test("tokenize round-trips the source and classifies TypeScript", () => {
  const line = 'const total = sum(3) // note "x"';
  const tokens = tokenize(line);
  assert.equal(tokens.map((token) => token.text).join(""), line);
  assert.equal(tokens[0].kind, "keyword");
  assert.equal(tokens.find((token) => token.text === "sum").kind, "call");
  assert.equal(tokens.find((token) => token.text === "3").kind, "number");
  assert.ok(tokens.some((token) => token.kind === "comment"));
});

test("weaving layers keeps every mind's intent attributed on the same document", () => {
  const woven = weave(BASE, OPS, ["alpha", "beta"]);
  assert.equal(woven.lines.length, BASE.length + 1);
  assert.equal(woven.lines[0].text, "const a = 2;");
  assert.equal(woven.lines[0].layer, "alpha");
  assert.equal(woven.lines[2].change, "add");
  assert.equal(woven.lines[2].author, "NO");
  assert.deepEqual(woven.lines.map((line) => line.n), [1, 2, 3, 4, 5]);
  assert.equal(woven.collisions.length, 0);
});

test("an inactive layer leaves the fabric untouched", () => {
  const woven = weave(BASE, OPS, ["beta"]);
  assert.equal(woven.lines[0].text, "const a = 1;");
  assert.equal(woven.lines[0].layer, null);
});

test("two layers reshaping one line collide instead of silently overwriting", () => {
  const ops = [...OPS, { layer: "gamma", kind: "edit", at: 0, text: "const a = 3;", symbols: ["a"] }];
  const woven = weave(BASE, ops, ["alpha", "gamma"]);
  assert.equal(woven.collisions.length, 1);
  assert.deepEqual(woven.collisions[0].layers, ["alpha", "gamma"]);
  assert.equal(woven.lines[0].collided, true);
  assert.equal(woven.lines[0].text, "const a = 2;", "the first intent is preserved, not clobbered");
});

test("convergence is atomic: collisions seal nothing", () => {
  const ops = [...OPS, { layer: "gamma", kind: "edit", at: 0, text: "const a = 3;", symbols: ["a"] }];
  const blocked = converge(BASE, ops, ["alpha", "gamma"]);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.base, BASE);
  assert.deepEqual(blocked.sealed, []);

  const sealed = converge(BASE, OPS, ["alpha", "beta"]);
  assert.equal(sealed.ok, true);
  assert.deepEqual(sealed.sealed, ["alpha", "beta"]);
  assert.equal(sealed.base[0], "const a = 2;");
  assert.equal(sealed.base.length, 5);
});

test("convergence score reflects collisions, threads, and runtime", () => {
  assert.equal(convergenceScore({ layers: [] }).status, "idle");
  const ready = convergenceScore({ layers: [1, 2, 3] });
  assert.equal(ready.status, "ready");
  assert.equal(ready.score, 100);
  assert.equal(convergenceScore({ layers: [1], collisions: [{}] }).status, "collision");
  assert.equal(convergenceScore({ layers: [1], failingTests: 2 }).status, "unstable");
  assert.equal(convergenceScore({ layers: [1], openThreads: 3 }).status, "deliberating");
  assert.equal(convergenceScore({ layers: [1], collisions: [{}, {}, {}, {}, {}] }).score, 0);
});

test("blast radius counts distinct symbols and modules", () => {
  const radius = blastRadius([
    { symbols: ["a", "b"], files: ["src/collab/presence.ts"] },
    { symbols: ["b", "c"], files: ["src/collab/motion.ts", "src/runtime/converge.ts"] },
  ]);
  assert.equal(radius.symbols, 3);
  assert.equal(radius.modules, 2);
  assert.equal(radius.risk, "low");
});

test("the continuum resolves a scrub position to the moment it lands in", () => {
  const events = [{ at: 0.1, label: "a" }, { at: 0.5, label: "b" }, { at: 0.9, label: "c" }];
  assert.equal(stateAt(events, 0.6).event.label, "b");
  assert.equal(stateAt(events, 0.6).reached, 2);
  assert.equal(stateAt(events, 1).live, true);
  assert.equal(stateAt(events, -3).position, 0);
  assert.equal(stateAt(events, 9).position, 1);
});

test("deterministic rng replays a session identically", () => {
  const a = createRng(7);
  const b = createRng(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("pulse health and relative time stay human-readable", () => {
  assert.equal(pulseHealth([]).uptime, 100);
  assert.equal(pulseHealth([0.9, 0.9, 0.2, 0.9]).uptime, 75);
  assert.equal(pulseHealth([0.2, 0.2, 0.9, 0.9]).trend, "rising");
  assert.equal(formatAgo(1000), "just now");
  assert.equal(formatAgo(600000), "10m ago");
  assert.equal(formatAgo(7200000), "2h ago");
});
