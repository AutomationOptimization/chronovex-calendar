/**
 * BRAID fabric core — the branchless collaboration model.
 *
 * A file is never forked. It is a `base` sequence of lines plus a pool of
 * `intent layers`: named, authored bundles of operations that hover above the
 * shared text. Any subset of layers can be woven into the fabric at once, so
 * every mind reads the same document while still seeing whose intention is
 * shaping which line. Convergence seals the woven result back into the base.
 *
 * This module is DOM-free so it can be unit tested and reasoned about on its own.
 */

const KEYWORDS = new Set([
  "import", "from", "export", "const", "let", "var", "function", "return", "if", "else",
  "for", "while", "await", "async", "new", "type", "interface", "class", "extends",
  "implements", "of", "in", "as", "null", "undefined", "true", "false", "this", "void",
  "yield", "try", "catch", "finally", "throw", "typeof", "satisfies", "readonly",
]);

/** Deterministic 32-bit PRNG so simulated sessions replay identically. */
export function createRng(seed = 1) {
  let state = seed >>> 0 || 1;
  return function next() {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
}

/**
 * Split a line of TypeScript-ish source into highlight tokens.
 * Returns `[{ text, kind }]`; concatenating `text` reproduces the input exactly.
 */
export function tokenize(line) {
  if (typeof line !== "string") throw new TypeError("tokenize expects a string");
  const tokens = [];
  const pattern = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d])/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const [text, comment, string, number, word, space, punct] = match;
    if (comment) tokens.push({ text, kind: "comment" });
    else if (string) tokens.push({ text, kind: "string" });
    else if (number) tokens.push({ text, kind: "number" });
    else if (word) {
      const after = line.slice(match.index + text.length);
      if (KEYWORDS.has(text)) tokens.push({ text, kind: "keyword" });
      else if (/^\s*\(/.test(after)) tokens.push({ text, kind: "call" });
      else if (/^[A-Z]/.test(text)) tokens.push({ text, kind: "type" });
      else tokens.push({ text, kind: "ident" });
    } else if (space) tokens.push({ text, kind: "space" });
    else tokens.push({ text: punct, kind: "punct" });
  }
  return tokens;
}

/**
 * Weave a base document together with every active intent layer.
 *
 * Operations are `{ layer, at, kind: 'edit'|'insert', text|lines, symbols }`,
 * where `at` is a base line index. Two active layers editing the same base line
 * are a collision: both are surfaced, neither is silently dropped.
 *
 * @returns {{ lines: Array, collisions: Array, stats: object }}
 */
export function weave(base, ops, activeLayers = []) {
  const active = new Set(activeLayers);
  const rows = base.map((text, index) => ({
    text,
    base: index,
    layer: null,
    change: null,
    author: null,
    collided: false,
    original: text,
  }));
  const inserts = new Map();
  const collisions = [];
  const touched = new Map();
  let added = 0;
  let removed = 0;

  for (const op of ops) {
    if (!active.has(op.layer)) continue;
    if (op.kind === "delete") {
      const row = rows[op.at];
      if (!row) continue;
      if (row.layer && row.layer !== op.layer) {
        row.collided = true;
        collisions.push({ line: op.at, layers: [row.layer, op.layer], symbols: intersect(touched.get(row.layer), op.symbols) });
        continue;
      }
      row.removed = true;
      row.layer = op.layer;
      row.author = op.author ?? null;
      row.change = "delete";
      removed += 1;
    } else if (op.kind === "edit") {
      const row = rows[op.at];
      if (!row) continue;
      if (row.layer && row.layer !== op.layer) {
        row.collided = true;
        collisions.push({
          line: op.at,
          layers: [row.layer, op.layer],
          symbols: intersect(touched.get(row.layer), op.symbols),
        });
        continue;
      }
      row.text = op.text;
      row.layer = op.layer;
      row.author = op.author ?? null;
      row.change = "edit";
      added += 1;
      removed += 1;
    } else if (op.kind === "insert") {
      const bucket = inserts.get(op.at) ?? [];
      (op.lines ?? [op.text]).forEach((text, offset) => {
        bucket.push({ text, base: null, anchor: op.at, offset, layer: op.layer, change: "add", author: op.author ?? null, collided: false, original: "" });
        added += 1;
      });
      inserts.set(op.at, bucket);
    }
    touched.set(op.layer, [...(touched.get(op.layer) ?? []), ...(op.symbols ?? [])]);
  }

  const lines = [];
  rows.forEach((row, index) => {
    if (!row.removed) lines.push(row);
    for (const inserted of inserts.get(index) ?? []) lines.push(inserted);
  });
  lines.forEach((row, index) => { row.n = index + 1; });

  return {
    lines,
    collisions,
    stats: { added, removed, layers: active.size, symbols: new Set([...touched.values()].flat()).size },
  };
}

function intersect(a = [], b = []) {
  const other = new Set(b);
  return [...new Set(a)].filter((value) => other.has(value));
}

/**
 * Score how close the active layers are to becoming one shared state.
 * Collisions dominate; unresolved threads only shave the edge off.
 */
export function convergenceScore({ layers = [], collisions = [], openThreads = 0, failingTests = 0 } = {}) {
  if (layers.length === 0) {
    return { score: 100, status: "idle", title: "Fabric at rest", copy: "No intent layers in flight. The shared state is the live edge." };
  }
  const raw = 100 - collisions.length * 24 - openThreads * 5 - failingTests * 12;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  if (collisions.length > 0) {
    return {
      score,
      status: "collision",
      title: `${collisions.length} semantic collision${collisions.length === 1 ? "" : "s"}`,
      copy: "Two intentions reshape the same lines. Resolve in place—no branch required.",
    };
  }
  if (failingTests > 0) {
    return { score, status: "unstable", title: "Runtime is still settling", copy: `${failingTests} check${failingTests === 1 ? "" : "s"} failing against the woven state.` };
  }
  if (openThreads > 0) {
    return { score, status: "deliberating", title: "Consensus is forming", copy: `${openThreads} living thread${openThreads === 1 ? "" : "s"} still open on these lines.` };
  }
  return {
    score,
    status: "ready",
    title: "Ready to converge",
    copy: `${layers.length} compatible layer${layers.length === 1 ? "" : "s"}. No semantic collisions.`,
  };
}

/** Symbols and modules a set of layers reaches into — the blast radius. */
export function blastRadius(layers = []) {
  const symbols = new Set();
  const modules = new Set();
  for (const layer of layers) {
    for (const symbol of layer.symbols ?? []) symbols.add(symbol);
    for (const file of layer.files ?? []) modules.add(file.split("/").slice(0, -1).join("/") || file);
  }
  const risk = symbols.size > 14 ? "high" : symbols.size > 7 ? "medium" : "low";
  return { symbols: symbols.size, modules: modules.size, risk, names: [...symbols] };
}

/**
 * Fuse layers into the base document. Convergence is atomic: either every
 * layer lands at once, or the fabric is left untouched and the collisions
 * are handed back to the room.
 */
export function converge(base, ops, layerIds) {
  const woven = weave(base, ops, layerIds);
  if (woven.collisions.length > 0) {
    return { ok: false, base, collisions: woven.collisions, sealed: [] };
  }
  return {
    ok: true,
    base: woven.lines.map((line) => line.text),
    collisions: [],
    sealed: [...layerIds],
    stats: woven.stats,
  };
}

/**
 * Resolve the continuum position (0–1) into the session state at that moment.
 * `events` are `{ at, label, detail, kind }` with `at` in 0–1.
 */
export function stateAt(events, position) {
  const clamped = Math.max(0, Math.min(1, position));
  const ordered = [...events].sort((a, b) => a.at - b.at);
  let current = ordered[0] ?? null;
  let index = -1;
  ordered.forEach((event, i) => {
    if (event.at <= clamped + 1e-9) { current = event; index = i; }
  });
  return {
    position: clamped,
    live: clamped >= 0.999,
    event: current,
    index,
    reached: ordered.filter((event) => event.at <= clamped + 1e-9).length,
    total: ordered.length,
  };
}

/** Identifiers a line introduces — the anchor points threads and beams attach to. */
export function symbolsIn(text) {
  return [...new Set(
    tokenize(String(text))
      .filter((token) => token.kind === "ident" || token.kind === "call" || token.kind === "type")
      .map((token) => token.text),
  )];
}

/** Subsequence fuzzy match used by the command palette. Returns 0 when it misses. */
export function fuzzyScore(query, text) {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  const hay = text.toLowerCase();
  let score = 0;
  let cursor = 0;
  let streak = 0;
  for (const char of needle) {
    const found = hay.indexOf(char, cursor);
    if (found === -1) return 0;
    streak = found === cursor ? streak + 1 : 0;
    score += 1 + streak * 2 + (found === 0 ? 3 : 0);
    cursor = found + 1;
  }
  return score / (1 + hay.length / 40);
}

/** Line-level diff between two documents, for future comparison and layer review. */
export function diffLines(before, after) {
  const rows = [];
  const seen = new Set(after);
  const kept = new Set(before);
  let bi = 0;
  let ai = 0;
  while (bi < before.length || ai < after.length) {
    const b = before[bi];
    const a = after[ai];
    if (bi < before.length && ai < after.length && b === a) { rows.push({ kind: "same", text: a }); bi += 1; ai += 1; }
    else if (ai < after.length && !kept.has(a)) { rows.push({ kind: "add", text: a }); ai += 1; }
    else if (bi < before.length && !seen.has(b)) { rows.push({ kind: "del", text: b }); bi += 1; }
    else { bi += 1; ai += 1; }
  }
  return rows;
}

/** Human-scale relative time used across the continuum and threads. */
export function formatAgo(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Latency-weighted health of the runtime pulse history (values 0–1). */
export function pulseHealth(samples = []) {
  if (samples.length === 0) return { uptime: 100, trend: "flat", median: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const head = samples.slice(0, Math.max(1, Math.floor(samples.length / 2)));
  const tail = samples.slice(-Math.max(1, Math.floor(samples.length / 2)));
  const average = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const delta = average(tail) - average(head);
  const uptime = Math.round((1 - samples.filter((value) => value < 0.35).length / samples.length) * 10000) / 100;
  return { uptime, median, trend: delta > 0.04 ? "rising" : delta < -0.04 ? "falling" : "flat" };
}
