import {
  blastRadius,
  converge as convergeFabric,
  convergenceScore,
  diffLines,
  formatAgo,
  fuzzyScore,
  pulseHealth,
  symbolsIn,
  tokenize,
  weave,
} from "./fabric-core.js";
import { createIdentity, createSync, mergeFabric } from "./fabric-sync.js";
import { newRoomId, resolveRelay } from "./fabric-relay.js";
import { DEFAULT_RELAY } from "./relay-config.js";
import { createHuddle } from "./huddle.js";
import { createGuide } from "./guide.js";

/**
 * The app binds to the document it was booted into. Reaching for a global
 * `document` instead would mean two instances in one process fight over one
 * DOM — which is exactly the situation the collaboration tests create.
 */
let doc = typeof document !== "undefined" ? document : null;
const win = () => doc?.defaultView ?? (typeof window !== "undefined" ? window : globalThis);

const $ = (selector, root) => (root ?? doc)?.querySelector(selector) ?? null;
const $$ = (selector, root) => [...((root ?? doc)?.querySelectorAll(selector) ?? [])];
const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const clone = (value) => JSON.parse(JSON.stringify(value));
const STORAGE_KEY = "braid-fabric-v1";
// Always the page's own storage — never a host runtime's global of the same name.
function storage() {
  // A sandboxed iframe throws on this property rather than returning undefined,
  // so every access has to be guarded, not just every read and write.
  try {
    return win()?.localStorage ?? null;
  } catch {
    return null;
  }
}

const ICONS = {
  "arrow-right": '<path d="M4 12h14M13 7l5 5-5 5"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v4l-2 3 2 3v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4l2 3-2 3v4a2 2 0 0 1-2 2h-1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  chevrons: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
  cloud: '<path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.3 2A3.5 3.5 0 0 1 17.5 18z"/>',
  code: '<path d="m9 17-5-5 5-5M15 7l5 5-5 5"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  expand: '<path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-3-2-2 2-2-2-2 2-2-2z"/><path d="M9.5 10h.01M14.5 10h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4l3 2"/>',
  infinity: '<path d="M7 9a3 3 0 1 0 0 6c3 0 5-6 8-6a3 3 0 1 1 0 6c-3 0-5-6-8-6z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 11a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.7 18l1-1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  "mic-off": '<path d="M9 9v2a3 3 0 0 0 4.6 2.5M15 11V6a3 3 0 0 0-5.9-.7"/><path d="M5 11a7 7 0 0 0 10.7 6M19 11a7 7 0 0 1-.6 2.8M12 18v3M4 3l16 16"/>',
  merge: '<path d="M7 21V9a5 5 0 0 0 5 5h5"/><circle cx="7" cy="5" r="2.5"/><circle cx="19" cy="14" r="2.5"/><path d="M7 7.5V9"/>',
  message: '<path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  pen: '<path d="m15 5 4 4L8 20H4v-4z"/><path d="m13.5 6.5 4 4"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pulse: '<path d="M2 12h4l3-8 4 16 3-8h6"/>',
  redo: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  "skip-back": '<path d="M19 5v14L8 12zM5 5v14"/>',
  slash: '<path d="M15 4 9 20"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  spark: '<path d="m12 3 1.6 4.8L18 9.5l-4.4 1.7L12 16l-1.6-4.8L6 9.5l4.4-1.7zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
  split: '<path d="M6 3v6a5 5 0 0 0 5 5h2a5 5 0 0 1 5 5v2M18 3v3M6 21v-3"/><path d="m15 6 3-3 3 3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  undo: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  "user-plus": '<path d="M15 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.5"/><path d="M18 8v6M21 11h-6"/>',
  users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.5"/><path d="M22 20v-2a4 4 0 0 0-3-3.8"/>',
  wave: '<path d="M3 12c2.2-6 4.4-6 6.6 0s4.4 6 6.6 0 3.4-4 4.8-3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};

const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;

function hydrateIcons(root) {
  const scope = root ?? doc;
  if (!scope) return;
  $$("[data-icon]", scope).forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
}

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

/* ------------------------------------------------------------------ people */

const PEOPLE = {
  AM: { name: "Amara", tone: "mint", focus: "presence.ts", region: "Lisbon" },
  NO: { name: "Noor", tone: "violet", focus: "IntentLayer.tsx", region: "Karachi" },
  SR: { name: "Soren", tone: "coral", focus: "converge.ts", region: "Oslo" },
  MI: { name: "Mika", tone: "amber", focus: "convergence.spec.ts", region: "Kyoto" },
  KC: { name: "You", tone: "amber", focus: "presence.ts", region: "here" },
};

/* ------------------------------------------------------------- code fabric */

const SEED_FILES = {
  "presence.ts": {
    type: "ts", lang: "TypeScript", path: ["src", "collab"],
    base: [
      'import { fabric, type Mind } from "@braid/runtime";',
      'import { clampVelocity, lerpCaret } from "./motion";',
      "",
      "export type Caret = {",
      "  mind: Mind;",
      "  offset: number;",
      "  velocity: number;",
      "};",
      "",
      "const HANDOFF_WINDOW = 120;",
      "",
      "export function trackPresence(room: Room) {",
      "  const carets = new Map<string, Caret>();",
      "",
      '  room.on("caret", (event) => {',
      "    const previous = carets.get(event.mind.id);",
      "    const velocity = previous ? event.offset - previous.offset : 0;",
      "    carets.set(event.mind.id, {",
      "      mind: event.mind,",
      "      offset: event.offset,",
      "      velocity,",
      "    });",
      "  });",
      "",
      '  room.on("drop", (mind) => {',
      "    carets.delete(mind.id);",
      "  });",
      "",
      "  return {",
      "    read: () => [...carets.values()],",
      "    settle: () => fabric.settle(carets),",
      "  };",
      "}",
    ],
    ops: [
      { id: "p1", layer: "presence", author: "AM", kind: "edit", at: 9, text: "const HANDOFF_WINDOW = 120; // survive a reconnect without losing the caret", symbols: ["HANDOFF_WINDOW"] },
      { id: "p2", layer: "presence", author: "AM", kind: "edit", at: 16, text: "    const velocity = clampVelocity(previous, event, HANDOFF_WINDOW);", symbols: ["velocity", "clampVelocity", "HANDOFF_WINDOW"] },
      { id: "p3", layer: "presence", author: "AM", kind: "insert", at: 23, symbols: ["resume", "lerpCaret"], lines: [
        '  room.on("resume", (mind, last) => {',
        "    carets.set(mind.id, lerpCaret(last, mind, HANDOFF_WINDOW));",
        "  });",
        "",
      ] },
      { id: "l1", layer: "latency", author: "NO", kind: "edit", at: 15, text: "    const previous = carets.get(event.mind.id) ?? speculate(event);", symbols: ["previous", "speculate"] },
      { id: "l2", layer: "latency", author: "NO", kind: "insert", at: 10, symbols: ["ECHO_BUDGET"], lines: [
        "const ECHO_BUDGET = 80; // local echo lands before the network answers",
      ] },
      { id: "c1", layer: "checkpoint", author: "SR", kind: "edit", at: 29, text: "    settle: () => fabric.seal(carets, { atomic: true }),", symbols: ["settle", "seal"] },
      { id: "c2", layer: "checkpoint", author: "SR", kind: "insert", at: 29, symbols: ["checkpoint"], lines: [
        "    checkpoint: () => fabric.checkpoint(room.id, carets),",
      ] },
    ],
  },
  "IntentLayer.tsx": {
    type: "tsx", lang: "TypeScript JSX", path: ["src", "canvas"],
    base: [
      'import { useFabric, useLayer } from "@braid/react";',
      "",
      "export function IntentLayer({ id, tone }: Props) {",
      "  const layer = useLayer(id);",
      "  const fabric = useFabric();",
      "",
      "  if (!layer.visible) return null;",
      "",
      "  return (",
      '    <section className="intent" data-tone={tone}>',
      "      <header>{layer.title}</header>",
      "      <Diff hunks={layer.hunks} live={fabric.live} />",
      "    </section>",
      "  );",
      "}",
    ],
    ops: [
      { id: "l3", layer: "latency", author: "NO", kind: "edit", at: 6, text: "  if (!layer.visible && !fabric.speculating) return null;", symbols: ["visible", "speculating"] },
      { id: "l4", layer: "latency", author: "NO", kind: "insert", at: 11, symbols: ["Echo"], lines: ["      <Echo budget={ECHO_BUDGET} tone={tone} />"] },
    ],
  },
  "converge.ts": {
    type: "ts", lang: "TypeScript", path: ["src", "runtime"],
    base: [
      'import { weave } from "./weave";',
      "",
      "export function converge(base: Doc, layers: Layer[]) {",
      "  const woven = weave(base, layers);",
      "  if (woven.collisions.length) return { ok: false, woven };",
      "  return { ok: true, doc: woven.doc };",
      "}",
    ],
    ops: [
      { id: "c3", layer: "checkpoint", author: "SR", kind: "edit", at: 5, text: "  return { ok: true, doc: woven.doc, sealedAt: fabric.now() };", symbols: ["sealedAt", "now"] },
    ],
  },
  "convergence.spec.ts": {
    type: "test", lang: "TypeScript", path: ["tests"],
    base: [
      'import { converge } from "../src/runtime/converge";',
      "",
      'test("three compatible layers become one state", () => {',
      "  const result = converge(base, [presence, latency, checkpoint]);",
      "  expect(result.ok).toBe(true);",
      "});",
    ],
    ops: [],
  },
  "fabric.css": {
    type: "css", lang: "CSS", path: ["src", "styles"],
    base: [".fabric {", "  --seam: rgba(85, 230, 193, 0.35);", "  display: grid;", "}"],
    ops: [],
  },
  "README.md": {
    type: "md", lang: "Markdown", path: [],
    base: ["# Helix", "", "A spatial runtime shaped by 12 minds at once.", "No branches. No pull requests. One living fabric."],
    ops: [],
  },
};

const SEED_LAYERS = [
  { id: "presence", title: "Presence resilience", author: "AM", tone: "mint", blurb: "Retry handoff without cursor drift" },
  { id: "latency", title: "Latency veil", author: "NO", tone: "violet", blurb: "Speculative local echo under 80ms" },
  { id: "checkpoint", title: "Atomic checkpoint", author: "SR", tone: "coral", blurb: "Seal consensus as one shared state" },
];

const MY_LAYER_SEED = { title: "Your intent", tone: "amber", blurb: "Everything you shape lands here first" };

const SEED_THREADS = [
  { id: "t1", file: "presence.ts", at: 16, symbol: "clampVelocity", title: "Should handoff preserve velocity?", author: "AM",
    replies: [
      { author: "AM", text: "Keep momentum through reconnect, but cap extrapolation at 120ms." },
      { author: "NO", text: "Cap it — beyond 120ms the ghost overshoots the real caret." },
    ], aligned: 8, resolved: false },
  { id: "t2", file: "presence.ts", at: 29, symbol: "seal", title: "Seal per room or per session?", author: "SR",
    replies: [
      { author: "SR", text: "Per session. A room can outlive the intent that shaped it." },
      { author: "MI", text: "Agreed — stamp the sealed state with the aligned count." },
    ], aligned: 5, resolved: false },
];

const SEED_MOMENTS = [
  { label: "session opened", tone: "quiet", detail: "Helix opened at the shared edge", layers: [], minutes: 24 },
  { label: "intent opened", tone: "mint", detail: "Amara opened Presence resilience", layers: ["presence"], minutes: 19 },
  { label: "ghost edit", tone: "violet", detail: "Noor shaped the latency veil", layers: ["presence", "latency"], minutes: 14 },
  { label: "tests green", tone: "amber", detail: "Runtime pulse recovered after the veil landed", layers: ["presence", "latency"], minutes: 9 },
  { label: "checkpoint", tone: "coral", detail: "Soren proposed an atomic checkpoint", layers: ["presence", "latency", "checkpoint"], minutes: 4 },
  { label: "live edge", tone: "mint", detail: "12 minds at the live edge", layers: ["presence", "latency", "checkpoint"], minutes: 0 },
];

const TESTS = [
  { name: "convergence.spec.ts", cases: 148, ms: 412 },
  { name: "presence.spec.ts", cases: 61, ms: 188 },
  { name: "echo.spec.ts", cases: 24, ms: 96 },
  { name: "seal.spec.ts", cases: 12, ms: 61 },
];

/* ------------------------------------------------------------------ state */

const bootTime = Date.now();

const state = {
  mode: "fabric",
  file: "presence.ts",
  tabs: ["presence.ts", "IntentLayer.tsx", "converge.ts"],
  files: clone(SEED_FILES),
  layers: clone(SEED_LAYERS),
  threads: clone(SEED_THREADS),
  futures: [],
  activeLayers: new Set(["presence", "latency", "checkpoint"]),
  ghosts: true,
  beam: false,
  beamSymbol: null,
  editing: null,
  selected: null,
  composing: null,
  following: null,
  huddle: { open: false, joined: false, muted: false, level: 0, mic: "idle", speakers: new Map() },
  position: 1,
  playing: false,
  history: [],
  undoStack: [],
  redoStack: [],
  ghosts: true,
  pulse: [],
  weaveMs: [],
  opCounter: 0,
  tombstones: [],
  baseVersion: 0,
  peers: [],
  relay: "offline",
  remoteCarets: new Map(),
  remoteGhosts: new Map(),
};

const identity = createIdentity(storage());

/** The room this tab belongs to, and the URL that lets anyone else join it. */
const session = (() => {
  const resolved = resolveRelay({ storage: storage(), fallback: DEFAULT_RELAY });
  let room = resolved.room;
  if (!room) {
    try { room = storage()?.getItem("braid-room") ?? ""; } catch { room = ""; }
  }
  if (!room) room = newRoomId();
  try { storage()?.setItem("braid-room", room); } catch { /* ignore */ }
  return { url: resolved.url, room };
})();

function shareLink() {
  if (typeof window === "undefined") return `#room=${session.room}`;
  const base = `${window.location.origin}${window.location.pathname}`;
  const parts = [`room=${encodeURIComponent(session.room)}`];
  if (session.url && session.url !== DEFAULT_RELAY) parts.push(`relay=${encodeURIComponent(session.url)}`);
  return `${base}#${parts.join("&")}`;
}
const MY_LAYER = `mine-${identity.id}`;
let sync = null;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The pulse is a real measurement: how long it takes to weave every active
 * layer into the open file, penalised by any collision that would block a
 * convergence. Nothing here is invented.
 */
function recordWeave(ms, woven) {
  state.weaveMs.push(ms);
  if (state.weaveMs.length > 44) state.weaveMs.shift();
  const budget = 8;
  const speed = Math.max(0.08, Math.min(1, 1 - ms / budget));
  state.pulse.push(Math.max(0.08, speed - woven.collisions.length * 0.25));
  if (state.pulse.length > 44) state.pulse.shift();
}

const medianWeave = () => {
  if (state.weaveMs.length === 0) return 0;
  const sorted = [...state.weaveMs].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
};

const nextOpId = () => `${identity.id}-${(state.opCounter += 1).toString(36)}`;
const layerById = (id) => state.layers.find((layer) => layer.id === id);
const fileOf = (name, files = state.files) => files[name] ?? files["presence.ts"];
const openThreads = () => state.threads.filter((thread) => !thread.resolved).length;

/** Whether the user is looking at the live edge (editable) or a past moment (read-only). */
const isLive = () => state.position >= 0.999;

/** The files + layers as they were at the scrubbed moment, or live if at the edge. */
function view() {
  if (isLive() || state.history.length === 0) return { files: state.files, active: state.activeLayers, moment: null };
  const moment = state.history[momentIndex()];
  return { files: moment.snap.files, active: new Set(moment.snap.active), moment };
}

function momentIndex() {
  if (state.history.length === 0) return 0;
  return Math.round(state.position * (state.history.length - 1));
}

function currentWeave() {
  const { files, active } = view();
  const file = fileOf(state.file, files);
  return weave(file.base, file.ops, [...active]);
}

function layerStats(id, files = state.files) {
  let added = 0;
  let removed = 0;
  const symbols = new Set();
  const touchedFiles = new Set();
  for (const [name, file] of Object.entries(files)) {
    for (const op of file.ops) {
      if (op.layer !== id) continue;
      touchedFiles.add(name);
      (op.symbols ?? []).forEach((symbol) => symbols.add(symbol));
      if (op.kind === "insert") added += (op.lines ?? [op.text]).length;
      else if (op.kind === "edit") { added += 1; removed += 1; }
      else removed += 1;
    }
  }
  return { added, removed, symbols: [...symbols], files: [...touchedFiles] };
}

function sessionHealth() {
  const { active } = view();
  const collisions = allCollisions();
  return convergenceScore({
    layers: [...active].filter((id) => layerStats(id).files.length > 0),
    collisions,
    openThreads: openThreads(),
    failingTests: 0,
  });
}

/** Collisions across every file, not just the open one. */
function allCollisions() {
  const { files, active } = view();
  return Object.entries(files).flatMap(([name, file]) =>
    weave(file.base, file.ops, [...active]).collisions.map((collision) => ({ ...collision, file: name })));
}

/* ---------------------------------------------------------------- history */

function snapshot() {
  return {
    files: clone(state.files),
    active: [...state.activeLayers],
    threads: clone(state.threads),
    tombstones: [...state.tombstones],
    baseVersion: state.baseVersion,
  };
}

function record(label, detail, tone = "amber") {
  state.history.push({ t: Date.now(), label, detail, tone, snap: snapshot() });
  if (state.history.length > 80) state.history.shift();
  state.position = 1;
}

function pushUndo() {
  state.undoStack.push(snapshot());
  if (state.undoStack.length > 40) state.undoStack.shift();
  state.redoStack.length = 0;
}

function applySnapshot(snap) {
  state.files = clone(snap.files);
  state.activeLayers = new Set(snap.active);
  state.threads = clone(snap.threads);
  state.tombstones = [...(snap.tombstones ?? [])];
  state.baseVersion = snap.baseVersion ?? state.baseVersion;
}

/** Remember that an operation was deliberately removed, so peers don't resurrect it. */
function entomb(...ops) {
  for (const op of ops) if (op?.id) state.tombstones.push(op.id);
}

function undo() {
  const snap = state.undoStack.pop();
  if (!snap) { toast("Nothing to undo", "violet", "undo"); return; }
  state.redoStack.push(snapshot());
  applySnapshot(snap);
  state.position = 1;
  render();
  toast("Stepped back through your intent", "amber", "undo");
}

function redo() {
  const snap = state.redoStack.pop();
  if (!snap) { toast("Nothing to redo", "violet", "redo"); return; }
  state.undoStack.push(snapshot());
  applySnapshot(snap);
  state.position = 1;
  render();
  toast("Restored your intent", "amber", "redo");
}

function seedHistory() {
  for (const moment of SEED_MOMENTS) {
    const files = clone(SEED_FILES);
    state.history.push({
      t: bootTime - moment.minutes * 60000,
      label: moment.label,
      detail: moment.detail,
      tone: moment.tone,
      snap: { files, active: [...moment.layers, MY_LAYER], threads: clone(SEED_THREADS) },
    });
  }
}

/* ------------------------------------------------------------- persistence */

function save() {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({
      files: state.files, threads: state.threads, futures: state.futures,
      active: [...state.activeLayers], layers: state.layers, tabs: state.tabs, file: state.file,
    }));
  } catch { /* storage is a nicety, never a requirement */ }
}

function load() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved?.files) return;
    state.files = saved.files;
    state.threads = saved.threads ?? state.threads;
    state.futures = saved.futures ?? [];
    state.layers = saved.layers ?? state.layers;
    state.activeLayers = new Set(saved.active ?? [...state.activeLayers]);
    state.tabs = saved.tabs?.length ? saved.tabs : state.tabs;
    state.file = saved.file ?? state.file;
  } catch { /* ignore malformed storage */ }
}

/* ---------------------------------------------------------- collaboration */

let publishTimer = null;

/** Push the local fabric to every connected mind, coalesced to one message per beat. */
function publish() {
  if (!sync) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    sync.send("state", {
      files: state.files,
      threads: state.threads,
      tombstones: state.tombstones,
      baseVersion: state.baseVersion,
      file: state.file,
    });
  }, 160);
}

function receive(message) {
  if (message.type === "device-connected") {
    toast("A device joined the fabric directly", "mint", "users");
    publish();
    render();
    return;
  }
  if (message.type === "hello") { publish(); return; }
  if (message.type === "huddle") {
    const payload = message.payload ?? {};
    if (payload.joined === false) state.huddle.speakers.delete(message.from);
    else state.huddle.speakers.set(message.from, { ...message.who, ...payload, via: message.via ?? "tab" });
    renderHuddle();
    return;
  }
  if (message.type === "ghost") {
    const payload = message.payload ?? {};
    if (!payload.text) state.remoteGhosts.delete(message.from);
    else state.remoteGhosts.set(message.from, { ...payload, who: message.who, seen: Date.now() });
    if (state.mode === "fabric" && isLive() && !state.editing) renderCanvas();
    return;
  }
  if (message.type === "caret") {
    state.remoteCarets.set(message.from, { ...message.payload, who: message.who, seen: Date.now() });
    if (state.mode === "fabric" && isLive() && !state.editing) renderCanvas();
    return;
  }
  if (message.type !== "state") return;

  const merged = mergeFabric(
    { files: state.files, threads: state.threads, tombstones: state.tombstones, baseVersion: state.baseVersion },
    message.payload,
  );
  state.files = merged.files;
  state.threads = merged.threads;
  state.tombstones = merged.tombstones;
  state.baseVersion = merged.baseVersion;
  if (!merged.changed) return;
  ensureLayers();

  const who = message.who?.name ?? "Another mind";
  record("remote intent", `${who} reshaped the fabric`, message.who?.tone ?? "violet");
  render();
  const collision = allCollisions()[0];
  if (collision) toast(`${who}'s intent collides with yours at ${collision.file}:${collision.line + 1}`, "coral", "x");
}

function onPeers(peers) {
  state.peers = peers;
  render();
}

/** Give any layer arriving from another mind a name, a colour and a home in the panel. */
function ensureLayers() {
  const known = new Set(state.layers.map((layer) => layer.id));
  for (const file of Object.values(state.files)) {
    for (const op of file.ops) {
      if (known.has(op.layer)) continue;
      known.add(op.layer);
      const peer = state.peers.find((item) => op.layer === `mine-${item.id}`);
      state.layers.push({
        id: op.layer,
        title: peer ? `${peer.name}'s intent` : `${op.author ?? "Another mind"}'s intent`,
        author: op.author ?? peer?.initials ?? "??",
        tone: peer?.tone ?? "violet",
        blurb: "Shaped by a mind on the other end of this session",
      });
      state.activeLayers.add(op.layer);
    }
  }
}

function startSync() {
  sync = createSync({
    room: session.room,
    identity,
    relay: session.url ? { url: session.url, room: session.room } : null,
    onStatus: (status) => { state.relay = status; renderPeople(); },
    onMessage: receive,
    onPeers,
    onStream: (stream) => {
      const audio = $("#huddle-audio");
      if (audio) { audio.srcObject = stream; audio.play?.().catch(() => {}); }
    },
  });
  timers.push(sync.sweep);
  sync.send("hello");
  timers.push(setInterval(() => {
    if (!state.selected) return;
    sync.send("caret", { file: state.file, line: state.selected });
  }, 2000));
}

function renderPeople() {
  const stack = $("#avatar-stack");
  if (!stack) return;
  const live = state.peers.map((peer) => `
    <button class="avatar ${peer.tone ?? "violet"} is-live" data-peer="${escapeHTML(peer.id)}" title="${escapeHTML(peer.name ?? "Mind")} — connected ${peer.via === "device" ? "by device" : "in another tab"}">
      ${escapeHTML(peer.initials ?? "??")}<span></span></button>`).join("");
  stack.innerHTML =
    `<button class="avatar is-you" data-peer="${escapeHTML(identity.id)}" title="You — ${escapeHTML(identity.name)}">${escapeHTML(identity.initials)}<span></span></button>${live}` +
    (state.peers.length === 0 ? `<button class="avatar invite-slot" data-action="invite" title="Invite another mind">+</button>` : "");
  const summary = $(".session-summary span:first-child");
  if (summary) summary.innerHTML = `<strong id="mind-count">${1 + state.peers.length}</strong> ${state.peers.length === 0 ? "mind — just you" : state.peers.length === 1 ? "minds connected" : "minds connected"}`;
  const weave = $("#weave-time");
  if (weave) weave.textContent = state.weaveMs.length ? `${medianWeave()}ms weave` : "measuring…";
  const statusWeave = $("#status-weave");
  if (statusWeave) statusWeave.textContent = state.weaveMs.length ? `${medianWeave()}ms median weave` : "";
  const label = {
    live: state.peers.length ? `room · ${state.peers.length} with you` : "room · waiting",
    connecting: "joining room…",
    retrying: "reconnecting…",
    offline: state.peers.length ? `${state.peers.length} in this browser` : "local only",
  }[state.relay] ?? state.relay;
  const statusSync = $("#status-sync");
  if (statusSync) statusSync.textContent = label;
  const workspaceSync = $("#workspace-sync");
  if (workspaceSync) workspaceSync.textContent = label;
  const status = $("#status-minds");
  if (status) status.textContent = state.peers.length
    ? `${1 + state.peers.length} minds live · ${state.peers.filter((peer) => peer.via === "device").length} by direct link`
    : "just you · open this page in a second tab to collaborate";
}

/** Invite dialog: same-browser tabs join themselves, other devices exchange one code each. */
function renderInvite() {
  const link = $("#invite-link");
  if (link) link.value = shareLink();
  const host = $("#device-connect");
  if (!host) return;
  if (session.url) { renderRoomInvite(host); return; }
  host.innerHTML = `
    <div class="device-head"><span class="card-kicker">BRING A DEVICE</span>
      <p>Tabs of this page join each other automatically. For a phone or another laptop, trade one code each way — the connection is direct, with no server in between.</p></div>
    <div class="mode-actions">
      <button type="button" class="pill-button primary" data-action="make-offer">Create invite code</button>
      <button type="button" class="pill-button" data-action="join-mode">I have a code</button>
    </div>
    <label class="invite-field" hidden id="offer-field"><span data-icon="link"></span>
      <input id="offer-code" readonly aria-label="Invite code" /><button type="button" data-action="copy-offer">Copy</button></label>
    <label class="invite-field" hidden id="paste-field"><span data-icon="user-plus"></span>
      <input id="paste-code" placeholder="Paste the code you were sent" aria-label="Paste code" /><button type="button" data-action="use-code">Connect</button></label>
    <div class="dialog-note" id="connect-note" hidden></div>`;
  hydrateIcons(host);
}

/** With a room deployed, inviting someone is just sending them the link. */
function renderRoomInvite(host) {
  const status = {
    live: "You're in the room. Anyone who opens this link joins the same fabric.",
    connecting: "Joining the room…",
    retrying: "Lost the room — reconnecting.",
    offline: "Not connected to the room.",
  }[state.relay] ?? state.relay;
  host.innerHTML = `
    <div class="device-head"><span class="card-kicker">SHARE THE ROOM</span><p>${escapeHTML(status)}</p></div>
    <div class="room-line"><span class="signal ${state.relay === "live" ? "" : "cold"}"></span>
      <code>${escapeHTML(session.room)}</code>
      <button type="button" class="pill-button" data-action="forget-relay">Change room server</button></div>`;
  hydrateIcons(host);
}

let awaitingAnswer = false;

async function makeOffer() {
  try {
    const code = await sync.createOffer();
    awaitingAnswer = true;
    const field = $("#offer-field");
    field.hidden = false;
    $("#offer-code").value = code;
    $("#paste-field").hidden = false;
    $("#paste-code").placeholder = "Paste the code they send back";
    note("Send them this code. When they send one back, paste it here.");
  } catch (error) {
    note(error.message, true);
  }
}

async function useCode() {
  const code = $("#paste-code")?.value.trim();
  if (!code) { note("Paste the code you were sent first.", true); return; }
  try {
    if (awaitingAnswer) {
      await sync.acceptAnswer(code);
      note("Connected. Your edits now travel to that device.");
      return;
    }
    const answer = await sync.acceptOffer(code);
    $("#offer-field").hidden = false;
    $("#offer-code").value = answer;
    note("Send this code back to finish the connection.");
  } catch (error) {
    note(`That code didn't work — ${error.message}`, true);
  }
}

function note(message, bad = false) {
  const host = $("#connect-note");
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `${icon(bad ? "x" : "check")} ${escapeHTML(message)}`;
  host.style.color = bad ? "var(--coral)" : "var(--mint)";
}

/* ------------------------------------------------------------------- guide */

let guide = null;

/** The live guide instance, for tests and for the command palette. */
const getGuide = () => guide;

/** Everything SHUTTLE reads. Real state only — it has no timers of its own. */
function guideContext() {
  const collisions = allCollisions();
  const myOps = Object.values(state.files).reduce(
    (total, file) => total + file.ops.filter((op) => op.layer === MY_LAYER).length, 0);
  return {
    mode: state.mode,
    live: isLive(),
    editing: Boolean(state.editing),
    selected: state.selected,
    myOps,
    collisions: collisions.length,
    activeSignature: [...state.activeLayers].sort().join(","),
    layersInFlight: liveLayers().length,
    baseVersion: state.baseVersion,
    peers: state.peers.length,
    threads: state.threads.length,
    futures: state.futures.length,
    micState: state.huddle.mic,
    huddleOpen: state.huddle.open,
    paletteOpen: Boolean($("#command-palette") && !$("#command-palette").hidden),
    dialogOpen: Boolean($("dialog[open]")),
  };
}

/* --------------------------------------------------------------- rendering */

function render() {
  renderTabs();
  renderContext();
  renderCanvas();
  renderConvergence();
  renderContinuum();
  renderRail();
  renderPeople();
  hydrateIcons();
  save();
  publish();
  guide?.sync();
}

function renderRail() {
  $$(".nav-button[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  const count = $(".nav-count");
  if (count) count.textContent = String(liveLayers().length);
  const dot = $(".nav-dot");
  if (dot) dot.hidden = openThreads() === 0;
  const mind = $("#mind-count");
  if (mind) mind.textContent = String(state.minds);
  const layerCount = $("#layer-count");
  if (layerCount) layerCount.textContent = String(liveLayers().length);
  renderTree();
}

function liveLayers() {
  const { active } = view();
  return state.layers.filter((layer) => active.has(layer.id) && layerStats(layer.id, view().files).files.length > 0);
}

function renderTree() {
  const tree = $("#file-tree");
  if (!tree) return;
  const { files } = view();
  const groups = new Map();
  for (const [name, file] of Object.entries(files)) {
    const key = file.path.join("/") || ".";
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  tree.innerHTML = [...groups.entries()].map(([path, names]) => {
    const rows = names.map((name) => {
      const file = files[name];
      const owners = [...new Set(file.ops.map((op) => op.author))];
      const lane = owners[0] ? `<i class="presence-lane ${layerById(file.ops[0].layer)?.tone ?? "mint"}"></i>` : "";
      const threadCount = state.threads.filter((thread) => thread.file === name && !thread.resolved).length;
      return `<button class="file-row${name === state.file ? " is-active" : ""}" data-file="${escapeHTML(name)}">
        <span class="file-type ${file.type}">${file.type.slice(0, 2).toUpperCase()}</span>
        <span>${escapeHTML(name)}</span>${lane}
        ${threadCount ? `<b class="row-threads" title="${threadCount} open threads">${threadCount}</b>` : ""}
        ${owners.length ? `<em>${owners[0]}</em>` : ""}
      </button>`;
    }).join("");
    if (path === ".") return rows;
    return `<button class="tree-folder is-open" data-folder="${escapeHTML(path)}"><span data-icon="chevron"></span><span data-icon="folder"></span>${escapeHTML(path)}</button>
      <div class="tree-children">${rows}</div>`;
  }).join("");
  hydrateIcons(tree);
}

function renderTabs() {
  const host = $("#editor-tabs");
  if (!host) return;
  const { files, active } = view();
  host.innerHTML = state.tabs.filter((name) => files[name]).map((name) => {
    const file = files[name];
    const layered = file.ops.some((op) => active.has(op.layer));
    return `<button class="editor-tab${name === state.file ? " is-active" : ""}" data-tab="${escapeHTML(name)}">
      <span class="file-type ${file.type}">${file.type.slice(0, 2).toUpperCase()}</span>
      <span>${escapeHTML(name)}</span>
      ${layered ? '<i title="layers in flight"></i>' : ""}
      <span class="tab-close" data-close="${escapeHTML(name)}" role="button" aria-label="Close ${escapeHTML(name)}">${icon("x")}</span>
    </button>`;
  }).join("");
}

function renderContext() {
  const { files } = view();
  const file = fileOf(state.file, files);
  const path = $(".context-path");
  if (path) {
    path.innerHTML = `<span class="file-symbol">${file.type.slice(0, 2).toUpperCase()}</span>` +
      file.path.map((part) => `<span>${escapeHTML(part)}</span><span data-icon="chevron-right"></span>`).join("") +
      `<strong id="context-file">${escapeHTML(state.file)}</strong>` +
      (isLive() ? "" : '<span class="readonly-chip">read-only · past moment</span>');
  }
  const beam = $(".scope-button");
  if (beam) {
    beam.classList.toggle("is-on", state.beam);
    const label = beam.querySelector("span:not([data-icon])");
    if (label) label.textContent = state.beam && state.beamSymbol ? state.beamSymbol : "Scope beam";
  }
  const ghostSwitch = $('[data-action="toggle-ghosts"] .switch');
  if (ghostSwitch) ghostSwitch.classList.toggle("is-on", state.ghosts);
  const footerSpans = $$(".editor-footer span");
  if (footerSpans.length) footerSpans[footerSpans.length - 1].textContent = file.lang;
  const problems = $('[data-action="toggle-problems"]');
  if (problems) {
    const collisions = allCollisions().length;
    problems.innerHTML = `<span class="check-circle">${icon(collisions ? "x" : "check")}</span> ${collisions} problem${collisions === 1 ? "" : "s"}`;
    problems.classList.toggle("has-problems", collisions > 0);
  }
  const threadButton = $('[data-action="open-thread"] #thread-count');
  if (threadButton) threadButton.textContent = String(openThreads());
  const position = $("#editor-position");
  if (position) position.textContent = state.selected ? `Ln ${state.selected}` : `${currentWeave().lines.length} lines`;
}

const MODE_VIEWS = { fabric: renderFabric, layers: renderLayersView, futures: renderFutures, threads: renderThreads, pulse: renderPulse };

function renderCanvas() {
  const canvas = $("#editor-canvas");
  if (!canvas) return;
  canvas.innerHTML = (MODE_VIEWS[state.mode] ?? renderFabric)();
  if (state.mode === "fabric") {
    paintCarets();
    focusEditor();
  }
  hydrateIcons(canvas);
}

function highlight(text, beamSymbol) {
  return tokenize(text).map((token) => {
    const hit = beamSymbol && token.text === beamSymbol;
    return `<span class="tok ${token.kind}${hit ? " beam" : ""}">${escapeHTML(token.text)}</span>`;
  }).join("");
}

function renderFabric() {
  const { files, active } = view();
  const file = fileOf(state.file, files);
  const started = now();
  const woven = weave(file.base, file.ops, [...active]);
  recordWeave(now() - started, woven);
  const beamSymbol = state.beam ? state.beamSymbol : null;

  const lines = woven.lines.map((line) => {
    const editing = state.editing && state.editing.n === line.n;
    const beamHit = beamSymbol && line.text.includes(beamSymbol);
    const thread = state.threads.find((item) => item.file === state.file && item.at === line.base && !item.resolved);
    const classes = [
      "code-line",
      line.layer ? `layer-${line.layer} tone-${layerById(line.layer)?.tone ?? "violet"}` : "",
      line.collided ? "is-collided" : "",
      line.change === "edit" ? "is-edited" : line.change === "add" ? "is-added" : "",
      line.layer === MY_LAYER ? "is-mine" : "",
      state.selected === line.n ? "is-selected" : "",
      beamSymbol ? (beamHit ? "is-beamed" : "is-dimmed") : "",
      editing ? "is-editing" : "",
    ].filter(Boolean).join(" ");
    const remote = state.ghosts && isLive() && !editing
      ? [...state.remoteGhosts.values()].find((entry) => entry.file === state.file && entry.line === line.n)
      : null;
    const ghost = remote
      ? `<span class="ghost-text" data-who="${escapeHTML(remote.who?.name ?? "a mind")}">${escapeHTML(remote.text)}</span><span class="ghost-caret"></span>`
      : "";
    const body = editing
      ? `<span class="line-input" contenteditable="plaintext-only" spellcheck="false" data-editor="${line.n}">${escapeHTML(state.editing.text)}</span>`
      : `${highlight(line.text, beamSymbol) || "&nbsp;"}${ghost}`;
    return `<div class="${classes}"${line.layer ? ` data-layer="${line.layer}"` : ""} data-line="${line.n}">
      <span class="ln">${line.n}</span>
      <span class="gutter">${line.change === "add" ? '<span class="layer-badge">+</span>' : line.change === "edit" ? '<span class="layer-badge">~</span>' : ""}</span>
      <span class="code-text">${body}${thread ? `<button class="thread-pin" data-action="focus-thread" data-thread="${thread.id}" title="${escapeHTML(thread.title)}">${icon("message")}</button>` : ""}</span>
    </div>`;
  }).join("");

  const minimap = woven.lines.map((line) =>
    `<i class="${line.layer ? layerById(line.layer)?.tone ?? "" : ""}" style="width:${Math.min(100, 16 + line.text.length * 1.6)}%"></i>`).join("");

  const toolbar = state.selected && isLive() ? `
    <div class="line-toolbar">
      <button class="pill-button" data-action="edit-line">${icon("pen")} Shape line ${state.selected}</button>
      <button class="pill-button" data-action="insert-line">${icon("plus")} Insert below</button>
      <button class="pill-button" data-action="delete-line">${icon("trash")} Delete</button>
      <button class="pill-button" data-action="start-thread">${icon("message")} Start thread</button>
      <button class="pill-button" data-action="beam-line">${icon("target")} Beam symbol</button>
    </div>` : "";

  const composer = state.composing ? `
    <form class="thread-composer" data-composer>
      <span class="thread-anchor">${icon("target")} ${escapeHTML(state.composing.symbol || `line ${state.composing.at + 1}`)}</span>
      <input id="thread-title" placeholder="What has to be decided here?" autocomplete="off" />
      <textarea id="thread-body" rows="2" placeholder="Say the thing that unblocks the room…"></textarea>
      <div class="mode-actions">
        <button type="submit" class="pill-button primary">${icon("message")} Anchor thread</button>
        <button type="button" class="pill-button" data-action="cancel-thread">Cancel</button>
      </div>
    </form>` : "";

  const banner = isLive() ? "" : `<div class="time-banner">${icon("history")} You're ${formatAgo(Date.now() - (view().moment?.t ?? Date.now()))} — ${escapeHTML(view().moment?.detail ?? "")}. <button data-action="go-live">Return to live edge</button></div>`;

  return `${banner}
    <div class="code-scroll" id="code-scroll" tabindex="0" aria-label="Code in ${escapeHTML(state.file)}">
      <div class="code-lines" id="code-lines">${lines}</div>
      ${composer}
    </div>
    <div class="minimap" id="minimap" aria-hidden="true">${minimap}</div>
    ${toolbar}
    <div class="editor-scanline" aria-hidden="true"></div>`;
}

function focusEditor() {
  const input = $("[data-editor]");
  if (input) {
    input.oninput = () => {
      if (!sync) return;
      sync.send("ghost", { file: state.file, line: state.editing?.n, text: input.textContent });
    };
    input.focus();
    const range = doc.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const selection = win().getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return;
  }
  const title = $("#thread-title");
  if (title) title.focus();
}

function paintCarets() {
  const host = $("#code-lines");
  if (!host || !isLive()) return;

  // Real minds first — these are actual people on the other end of a connection.
  for (const [id, caret] of state.remoteCarets) {
    if (Date.now() - caret.seen > 15000 || caret.file !== state.file) continue;
    const row = $(`.code-line[data-line="${caret.line}"] .code-text`, host);
    if (!row) continue;
    const marker = doc.createElement("span");
    marker.className = "remote-caret is-real";
    marker.dataset.name = caret.who?.name ?? id;
    marker.style.background = `var(--${caret.who?.tone ?? "violet"})`;
    marker.style.left = "0px";
    row.append(marker);
  }

}

function renderLayersView() {
  const { files, active } = view();
  const cards = state.layers.map((layer) => {
    const on = active.has(layer.id);
    const stats = layerStats(layer.id, files);
    const ops = Object.entries(files).flatMap(([name, file]) =>
      file.ops.filter((op) => op.layer === layer.id).map((op) => ({ ...op, fileName: name })));
    const diff = ops.map((op) => {
      const before = op.kind !== "insert" ? `<div class="del">− ${escapeHTML(files[op.fileName].base[op.at] ?? "")}</div>` : "";
      const after = op.kind === "delete" ? "" : (op.lines ?? [op.text]).map((text) => `<div class="add">+ ${escapeHTML(text)}</div>`).join("");
      return `<div class="diff-file">${escapeHTML(op.fileName)}:${op.at + 1}</div>${before}${after}`;
    }).join("");
    const collided = allCollisions().some((collision) => collision.layers.includes(layer.id));
    return `<article class="mode-card${collided ? " is-collided-card" : ""}">
      <h3><span class="intent-color ${layer.tone}" style="width:4px;height:14px;border-radius:3px"></span>${escapeHTML(layer.title)}<span class="layer-badge">${layer.author}</span>${collided ? '<span class="intent-conflict">collision</span>' : ""}</h3>
      <p>${escapeHTML(layer.blurb)} · <strong style="color:var(--mint)">+${stats.added}</strong> <strong style="color:var(--coral)">−${stats.removed}</strong> across ${stats.files.length} file${stats.files.length === 1 ? "" : "s"}${stats.symbols.length ? ` · touches ${stats.symbols.slice(0, 4).join(", ")}` : ""}</p>
      <div class="layer-diff">${diff || "<div>nothing shaped yet — edit a line to fill this layer</div>"}</div>
      <div class="mode-actions">
        <button class="pill-button${on ? " primary" : ""}" data-toggle-layer="${layer.id}">${on ? "Woven into fabric" : "Weave into fabric"}</button>
        ${stats.files.length ? `<button class="pill-button" data-action="open-layer-file" data-file="${escapeHTML(stats.files[0])}">Open ${escapeHTML(stats.files[0])}</button>` : ""}
        ${layer.id === MY_LAYER && stats.files.length ? `<button class="pill-button" data-action="discard-mine">Discard my intent</button>` : ""}
      </div>
    </article>`;
  }).join("");
  return `<div class="mode-view">
    <div class="mode-head"><div><h2>Intent layers</h2><p>Every intention lives above the same file. Toggle one and the document re-weaves under you — nothing is forked, nothing waits in a queue.</p></div></div>
    ${cards}</div>`;
}

function futureMetrics(future) {
  const file = state.files[future.file];
  const changed = diffLines(file.base, future.base).filter((row) => row.kind !== "same").length;
  return {
    reach: Math.min(1, changed / Math.max(4, file.base.length * 0.4)),
    risk: Math.min(1, changed / Math.max(6, file.base.length * 0.6)),
    coverage: Math.max(0.3, 1 - changed / Math.max(8, file.base.length)),
  };
}

function renderFutures() {
  if (state.futures.length === 0) {
    return `<div class="mode-view">
      <div class="mode-head"><div><h2>Parallel futures</h2><p>Try an implementation without splitting the team. A future is a private copy of the open file that the room can watch, compare, and collapse back in.</p></div>
        <button class="pill-button primary" data-action="spawn-future">${icon("split")} Spawn from ${escapeHTML(state.file)}</button></div>
      <article class="mode-card"><p>No futures open. Spawn one from <strong>${escapeHTML(state.file)}</strong>, edit it freely, then collapse the version that wins into the shared fabric.</p></article>
    </div>`;
  }
  const cards = state.futures.map((future) => {
    const metrics = futureMetrics(future);
    const rows = diffLines(state.files[future.file].base, future.base);
    const changed = rows.filter((row) => row.kind !== "same");
    return `<article class="future-card${future.favored ? " is-favored" : ""}">
      <div><span class="card-kicker">FUTURE · ${escapeHTML(future.file)}</span>
        <h3 style="margin:5px 0 4px;font-size:13.5px">${escapeHTML(future.title)}</h3>
        <p>${changed.length} line${changed.length === 1 ? "" : "s"} differ from the live fabric.</p></div>
      <div class="layer-diff">${changed.slice(0, 8).map((row) => `<div class="${row.kind}">${row.kind === "add" ? "+" : "−"} ${escapeHTML(row.text)}</div>`).join("") || "<div>identical to the fabric — start editing</div>"}</div>
      <div class="future-metrics">
        ${Object.entries(metrics).map(([key, value]) => `
          <div class="metric-row"><span>${key}</span><span class="metric-bar"><i style="width:${Math.round(value * 100)}%"></i></span><span>${Math.round(value * 100)}%</span></div>`).join("")}
      </div>
      <div class="future-editor">
        ${future.base.map((line, index) => `<div class="future-line" data-future="${future.id}" data-index="${index}">${highlight(line, null) || "&nbsp;"}</div>`).join("")}
      </div>
      <div class="mode-actions">
        <button class="pill-button primary" data-action="adopt-future" data-future="${future.id}">${icon("merge")} Collapse into fabric</button>
        <button class="pill-button" data-action="drop-future" data-future="${future.id}">Drop future</button>
      </div>
    </article>`;
  }).join("");
  return `<div class="mode-view">
    <div class="mode-head"><div><h2>Parallel futures</h2><p>Click any line inside a future to reshape it. Collapsing turns the whole future into one intent layer on the shared file.</p></div>
      <button class="pill-button" data-action="spawn-future">${icon("split")} Spawn from ${escapeHTML(state.file)}</button></div>
    <div class="future-grid">${cards}</div>
  </div>`;
}

function renderThreads() {
  const items = state.threads.map((thread) => `
    <article class="mode-card thread-item${thread.resolved ? " is-resolved" : ""}">
      <span class="thread-anchor">${icon("target")} ${escapeHTML(thread.file)} · ${escapeHTML(thread.symbol || `line ${thread.at + 1}`)}</span>
      <h3>${escapeHTML(thread.title)}${thread.resolved ? '<span class="layer-badge">resolved</span>' : ""}</h3>
      ${thread.replies.map((reply) => `<div class="thread-msg"><span class="mini-avatar ${PEOPLE[reply.author]?.tone ?? "mint"}">${escapeHTML(reply.author)}</span><span>${escapeHTML(reply.text)}</span></div>`).join("")}
      <form class="reply-form" data-reply="${thread.id}">
        <input placeholder="Reply as you…" autocomplete="off" aria-label="Reply to ${escapeHTML(thread.title)}" />
        <button type="submit" class="pill-button">Send</button>
      </form>
      <div class="mode-actions">
        <button class="pill-button primary" data-action="align-thread" data-thread="${thread.id}">${icon("check")} Align (${thread.aligned})</button>
        <button class="pill-button" data-action="jump-thread" data-thread="${thread.id}">Jump to code</button>
        ${thread.resolved ? "" : `<button class="pill-button" data-action="resolve-thread" data-thread="${thread.id}">Resolve</button>`}
      </div>
    </article>`).join("");
  return `<div class="mode-view">
    <div class="mode-head"><div><h2>Living threads</h2><p>Conversation anchored to a symbol, not a line number — it follows the code as the code moves. ${openThreads()} open.</p></div></div>
    ${items || '<article class="mode-card"><p>No threads yet. Select a line in the fabric and start one.</p></article>'}</div>`;
}

function renderPulse() {
  const health = pulseHealth(state.pulse);   // uptime here means "weaves that stayed under budget"
  const collisions = allCollisions();
  const spark = state.pulse.map((value) => `<i style="height:${Math.round(value * 100)}%"></i>`).join("");
  const suites = TESTS.map((suite) => {
    const pass = collisions.length === 0;
    return `<div class="test-row">${icon(pass ? "check" : "x")} ${escapeHTML(suite.name)} <span style="color:var(--faint)">${suite.cases} cases</span> <b style="color:var(--${pass ? "mint" : "coral"})">${pass ? `${suite.ms}ms` : "blocked"}</b></div>`;
  }).join("");
  return `<div class="mode-view">
    <div class="mode-head"><div><h2>Runtime pulse</h2><p>The woven state runs continuously. Every keystroke from every mind is tested against the same fabric.</p></div></div>
    <div class="pulse-grid">
      <div class="mode-card pulse-stat"><small>MEDIAN WEAVE</small><strong>${medianWeave()}ms</strong></div>
      <div class="mode-card pulse-stat"><small>WEAVES MEASURED</small><strong>${state.weaveMs.length}</strong></div>
      <div class="mode-card pulse-stat"><small>COLLISIONS</small><strong style="color:var(--${collisions.length ? "coral" : "mint"})">${collisions.length}</strong></div>
    </div>
    <div class="mode-card"><span class="card-kicker">LAST ${state.pulse.length} WEAVES OF ${escapeHTML(state.file)} · TALLER IS FASTER</span><div class="spark">${spark}</div></div>
    <div class="mode-card"><span class="card-kicker">SUITES AGAINST THE WOVEN STATE</span>${suites}</div>
    ${collisions.length ? `<div class="mode-card"><span class="card-kicker">BLOCKING</span>${collisions.map((collision) => `<div class="test-row">${icon("x")} ${escapeHTML(collision.file)}:${collision.line + 1} — ${collision.layers.join(" ↔ ")}</div>`).join("")}</div>` : ""}
  </div>`;
}

function renderConvergence() {
  const { files, active } = view();
  const health = sessionHealth();
  const collisions = allCollisions();
  const layers = liveLayers();
  const blast = blastRadius(layers.map((layer) => {
    const stats = layerStats(layer.id, files);
    return { symbols: stats.symbols, files: stats.files.map((name) => `${files[name].path.join("/")}/${name}`) };
  }));

  const orbit = $("#orbit-progress");
  if (orbit) {
    orbit.style.strokeDashoffset = String(239 - (239 * health.score) / 100);
    orbit.style.stroke = health.status === "ready" ? "var(--mint)" : health.status === "collision" ? "var(--coral)" : "var(--amber)";
  }
  const score = $("#health-score");
  if (score) score.textContent = String(health.score);
  const title = $("#health-title");
  if (title) title.textContent = health.title;
  const copy = $("#health-copy");
  if (copy) copy.textContent = health.copy;

  const list = $("#intent-list");
  if (list) {
    list.innerHTML = state.layers.map((layer) => {
      const on = active.has(layer.id);
      const stats = layerStats(layer.id, files);
      const collided = collisions.some((collision) => collision.layers.includes(layer.id));
      return `<button class="intent-card${on ? " is-selected" : ""}" data-intent="${layer.id}">
        <span class="intent-color ${layer.tone}"></span>
        <span class="intent-main">
          <span class="intent-title"><strong>${escapeHTML(layer.title)}</strong><em>${layer.author}</em></span>
          <small>${escapeHTML(layer.blurb)}</small>
          <span class="intent-meta"><span>+${stats.added} −${stats.removed}</span><span>${stats.files.length} file${stats.files.length === 1 ? "" : "s"}</span>
            <span class="${collided ? "intent-conflict" : "intent-ready"}">${collided ? "collision" : stats.files.length === 0 ? "empty" : on ? "woven" : "resting"}</span></span>
        </span>
      </button>`;
    }).join("");
  }

  const stats = $(".blast-stats");
  if (stats) stats.innerHTML = `<span><strong>${blast.symbols}</strong> symbols</span><span><strong>${blast.modules}</strong> modules</span><span><strong>${collisions.length}</strong> collisions</span>`;
  const nodes = $$(".blast-node");
  blast.names.slice(0, 4).forEach((name, index) => { if (nodes[index]) nodes[index].textContent = name; });
  const risk = $(".panel-section-title span:last-child");
  if (risk && risk.className.includes("risk")) {
    risk.className = blast.risk === "low" ? "low-risk" : blast.risk === "medium" ? "risk-medium" : "risk-high";
    risk.textContent = `${blast.risk.toUpperCase()} RISK`;
  }

  const decision = $("#decision-card");
  const thread = state.threads.find((item) => !item.resolved);
  if (decision) {
    decision.hidden = !thread;
    if (thread) {
      decision.innerHTML = `<div class="decision-top"><span class="decision-icon">${icon("message")}</span>
        <span><small>LIVING THREAD</small><strong>${escapeHTML(thread.title)}</strong></span>
        <button data-action="jump-thread" data-thread="${thread.id}">View</button></div>
        <p>“${escapeHTML(thread.replies[thread.replies.length - 1]?.text ?? "")}”</p>
        <div class="decision-votes"><span class="tiny-avatars">${thread.replies.slice(0, 3).map((reply) => `<i>${escapeHTML(reply.author)}</i>`).join("")}</span>
        <span><strong>${thread.aligned}</strong> aligned</span><span>${openThreads()} open</span></div>`;
    }
  }

  const button = $("#converge-button");
  if (button) {
    const blocked = collisions.length > 0;
    button.classList.toggle("is-blocked", blocked);
    button.disabled = layers.length === 0 || !isLive();
    button.querySelector("strong").textContent = layers.length === 0
      ? "Nothing in flight"
      : blocked ? `Resolve ${collisions.length} collision${collisions.length === 1 ? "" : "s"}` : `Converge ${layers.length} layer${layers.length === 1 ? "" : "s"}`;
    button.querySelector("small").textContent = !isLive() ? "Return to the live edge to converge" : blocked ? "Two intentions reshape the same line" : health.copy;
  }
  const badge = $(".mobile-convergence-button b");
  if (badge) badge.textContent = String(layers.length);
}

function renderContinuum() {
  const wrap = $(".timeline-wrap");
  const index = momentIndex();
  const last = Math.max(1, state.history.length - 1);
  if (wrap) {
    wrap.innerHTML = `<div class="timeline-track"><div class="timeline-progress" id="timeline-progress" style="width:${state.position * 100}%"></div></div>` +
      state.history.map((moment, i) => `<button class="timeline-event ${moment.tone}${i === index ? " active" : ""}" style="--at:${(i / last) * 100}%" data-moment="${i}" data-event="${escapeHTML(moment.detail)}"><i></i><span>${escapeHTML(moment.label)}</span></button>`).join("") +
      `<div class="timeline-cursor" id="timeline-cursor" style="--at:${state.position * 100}%"><span>${isLive() ? "LIVE" : formatAgo(Date.now() - (state.history[index]?.t ?? Date.now()))}</span></div>` +
      `<div class="timeline-ticks">${state.history.filter((_, i) => i % 2 === 0).map((moment) => `<span>${formatAgo(Date.now() - moment.t)}</span>`).join("")}</div>`;
  }
  const label = $("#continuum-label");
  if (label) label.textContent = isLive() ? "Live edge" : state.history[index]?.detail ?? "Session start";
  const live = $(".live-edge");
  if (live) live.classList.toggle("is-live", isLive());
  const replayIcon = $("#replay-icon");
  if (replayIcon) { replayIcon.dataset.icon = state.playing ? "pause" : "play"; replayIcon.innerHTML = icon(state.playing ? "pause" : "play"); }
  const bars = $("#pulse-bars");
  if (bars) bars.innerHTML = state.pulse.map((value) => `<i class="${value < 0.4 ? "hot" : ""}" style="height:${Math.round(value * 100)}%"></i>`).join("");
  const value = $(".runtime-value");
  if (value) value.textContent = state.weaveMs.length ? `${medianWeave()}ms weave` : "—";
}

/* ----------------------------------------------------------------- effects */

function toast(message, tone = "mint", glyph = "check") {
  const region = $("#toast-region");
  if (!region) return;
  const node = doc.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<span data-icon="${glyph}"></span><span>${escapeHTML(message)}</span>`;
  hydrateIcons(node);
  region.append(node);
  timers.push(setTimeout(() => {
    node.classList.add("is-out");
    timers.push(setTimeout(() => node.remove(), 320));
  }, 2600));
}

function openModal(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") { if (!dialog.open) dialog.showModal(); return; }
  dialog.setAttribute("open", "");
}

function closeModal(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

/* ------------------------------------------------------------ editing core */

/** Find (or create) the operation on your own layer that owns a rendered line. */
function ownOpFor(line) {
  const file = state.files[state.file];
  if (line.base === null) {
    return file.ops.find((op) => op.kind === "insert" && op.at === line.anchor && op.layer === line.layer);
  }
  return file.ops.find((op) => op.layer === MY_LAYER && op.at === line.base && op.kind !== "insert");
}

function lineAt(n) {
  return currentWeave().lines.find((line) => line.n === n) ?? null;
}

function beginEdit(n) {
  if (!isLive()) { toast("This is a past moment — return to the live edge to shape it", "amber", "history"); return; }
  const line = lineAt(n);
  if (!line) return;
  state.editing = { n, text: line.text, base: line.base, anchor: line.anchor, offset: line.offset, layer: line.layer };
  state.selected = n;
  renderCanvas();
}

function commitEdit(text) {
  const edit = state.editing;
  state.editing = null;
  sync?.send("ghost", { file: state.file, line: edit?.n, text: "" });
  if (!edit) return;
  const line = lineAt(edit.n);
  if (!line || text === edit.text) { render(); return; }
  pushUndo();
  const file = state.files[state.file];

  if (line.base === null) {
    const op = ownOpFor(line);
    if (op && op.layer === MY_LAYER) {
      op.lines[line.offset] = text;
      op.symbols = op.lines.flatMap((entry) => symbolsIn(entry));
      op.rev = (op.rev ?? 0) + 1;
    } else {
      // Reshaping someone else's inserted line becomes your own insert next to theirs.
      file.ops.push({ id: nextOpId(), layer: MY_LAYER, author: identity.initials, kind: "insert", at: line.anchor, lines: [text], symbols: symbolsIn(text) });
    }
  } else {
    const existing = file.ops.find((op) => op.layer === MY_LAYER && op.kind === "edit" && op.at === line.base);
    if (existing) { existing.text = text; existing.symbols = symbolsIn(text); existing.rev = (existing.rev ?? 0) + 1; }
    else file.ops.push({ id: nextOpId(), layer: MY_LAYER, author: identity.initials, kind: "edit", at: line.base, text, symbols: symbolsIn(text), rev: 0 });
  }

  state.activeLayers.add(MY_LAYER);
  const collision = allCollisions().find((item) => item.layers.includes(MY_LAYER));
  record("you shaped a line", `You reshaped ${state.file}:${edit.n}`, "amber");
  render();
  if (collision) toast(`Collision with ${layerById(collision.layers[0])?.title ?? collision.layers[0]} — both intents are held, neither is lost`, "coral", "x");
  else toast(`Shaped into your intent layer · ${state.file}:${edit.n}`, "amber", "pen");
}

function insertLine(after) {
  if (!isLive()) return;
  const line = lineAt(after);
  if (!line) return;
  pushUndo();
  const anchor = line.base ?? line.anchor;
  const file = state.files[state.file];
  const existing = file.ops.find((op) => op.layer === MY_LAYER && op.kind === "insert" && op.at === anchor);
  if (existing) existing.lines.push("");
  else file.ops.push({ id: nextOpId(), layer: MY_LAYER, author: identity.initials, kind: "insert", at: anchor, lines: [""], symbols: [] });
  state.activeLayers.add(MY_LAYER);
  record("you opened a line", `You added a line to ${state.file}`, "amber");
  render();
  beginEdit(after + 1);
}

function deleteLine(n) {
  if (!isLive()) return;
  const line = lineAt(n);
  if (!line) return;
  pushUndo();
  const file = state.files[state.file];
  if (line.base === null) {
    const op = ownOpFor(line);
    if (op?.layer === MY_LAYER) {
      op.lines.splice(line.offset, 1);
      if (op.lines.length === 0) { entomb(op); file.ops = file.ops.filter((item) => item !== op); }
    } else { toast("That line belongs to another layer — lift their layer instead", "violet", "layers"); return; }
  } else {
    file.ops.filter((op) => op.layer === MY_LAYER && op.at === line.base && op.kind === "edit").forEach((op) => entomb(op));
    file.ops = file.ops.filter((op) => !(op.layer === MY_LAYER && op.at === line.base && op.kind === "edit"));
    file.ops.push({ id: nextOpId(), layer: MY_LAYER, author: identity.initials, kind: "delete", at: line.base, symbols: symbolsIn(line.text) });
  }
  state.activeLayers.add(MY_LAYER);
  state.selected = null;
  record("you removed a line", `You deleted ${state.file}:${n}`, "amber");
  render();
  toast("Line removed in your intent layer", "amber", "trash");
}

function discardMine() {
  pushUndo();
  for (const file of Object.values(state.files)) {
    entomb(...file.ops.filter((op) => op.layer === MY_LAYER));
    file.ops = file.ops.filter((op) => op.layer !== MY_LAYER);
  }
  record("intent discarded", "You discarded your intent layer", "quiet");
  render();
  toast("Your intent layer is empty again", "violet", "trash");
}

/* --------------------------------------------------------------- workflows */

function setMode(mode) { state.mode = mode; state.editing = null; render(); }

function openFile(name) {
  if (!state.files[name]) return;
  if (!state.tabs.includes(name)) state.tabs.push(name);
  state.file = name;
  state.editing = null;
  state.selected = null;
  if (state.mode !== "fabric") state.mode = "fabric";
  render();
}

function closeTab(name) {
  state.tabs = state.tabs.filter((tab) => tab !== name);
  if (state.tabs.length === 0) state.tabs = [name];
  if (state.file === name) state.file = state.tabs[0];
  render();
}

function toggleLayer(id) {
  if (state.activeLayers.has(id)) state.activeLayers.delete(id);
  else state.activeLayers.add(id);
  const layer = layerById(id);
  const on = state.activeLayers.has(id);
  record(on ? "layer woven" : "layer lifted", `${layer.title} ${on ? "woven into" : "lifted from"} the fabric`, layer.tone);
  render();
  toast(`${layer.title} ${on ? "woven into" : "lifted from"} the fabric`, layer.tone === "quiet" ? "violet" : layer.tone, on ? "layers" : "ghost");
}

function runConverge() {
  if (!isLive()) { toast("Return to the live edge to converge", "amber", "history"); return; }
  const collisions = allCollisions();
  if (collisions.length > 0) {
    const first = collisions[0];
    openFile(first.file);
    state.selected = first.line + 1;
    render();
    toast(`${collisions.length} collision needs a human — jumped you to it`, "coral", "x");
    return;
  }
  const layers = liveLayers();
  if (layers.length === 0) { toast("No layers in flight", "violet", "layers"); return; }
  pushUndo();
  let sealedLines = 0;
  for (const file of Object.values(state.files)) {
    const woven = weave(file.base, file.ops, [...state.activeLayers]);
    if (!convergeFabric(file.base, file.ops, [...state.activeLayers]).ok) continue;
    sealedLines += woven.stats.added;
    file.base = woven.lines.map((line) => line.text);
    entomb(...file.ops.filter((op) => state.activeLayers.has(op.layer)));
    file.ops = file.ops.filter((op) => !state.activeLayers.has(op.layer));
  }
  state.baseVersion += 1;
  state.threads = state.threads.map((thread) => ({ ...thread, resolved: true }));
  record("converged", `${layers.length} layers sealed into shared state`, "mint");
  if (!reduceMotion && typeof document !== "undefined") {
    const flash = doc.createElement("div");
    flash.className = "converge-flash";
    doc.body.append(flash);
    setTimeout(() => flash.remove(), 1000);
  }
  render();
  toast(`${layers.length} layers · ${sealedLines} lines became one shared state`, "mint", "merge");
}

function startThread(n) {
  const line = lineAt(n);
  if (!line) return;
  const symbols = symbolsIn(line.text);
  state.composing = { at: line.base ?? line.anchor, symbol: symbols[0] ?? "", file: state.file };
  renderCanvas();
}

function saveThread(title, body) {
  if (!title.trim()) { toast("Give the thread a question to answer", "amber", "message"); return; }
  pushUndo();
  state.threads.push({
    id: `t-${state.threads.length + 1}-${Date.now().toString(36)}`,
    file: state.composing.file,
    at: state.composing.at,
    symbol: state.composing.symbol,
    title: title.trim(),
    author: "KC",
    replies: body.trim() ? [{ author: "KC", text: body.trim() }] : [],
    aligned: 1,
    resolved: false,
  });
  state.composing = null;
  record("thread opened", `You opened “${title.trim()}”`, "amber");
  render();
  toast("Thread anchored to the symbol it's about", "amber", "message");
}

function spawnFuture() {
  const file = state.files[state.file];
  const woven = weave(file.base, file.ops, [...state.activeLayers]);
  state.futures.push({
    id: `f-${state.futures.length + 1}-${Date.now().toString(36)}`,
    file: state.file,
    title: `Future ${state.futures.length + 1} · ${state.file}`,
    base: woven.lines.map((line) => line.text),
    favored: state.futures.length === 0,
  });
  state.mode = "futures";
  record("future spawned", `You spawned a future from ${state.file}`, "violet");
  render();
  toast("Future spawned — edit it without touching the room", "violet", "split");
}

function adoptFuture(id) {
  const future = state.futures.find((item) => item.id === id);
  if (!future) return;
  pushUndo();
  const file = state.files[future.file];
  const rows = diffLines(file.base, future.base);
  let cursor = 0;
  let applied = 0;
  for (const row of rows) {
    if (row.kind === "same") { cursor += 1; continue; }
    if (row.kind === "add") {
      file.ops.push({ id: nextOpId(), layer: MY_LAYER, author: identity.initials, kind: "insert", at: Math.max(0, cursor - 1), lines: [row.text], symbols: symbolsIn(row.text) });
      applied += 1;
    } else {
      file.ops.push({ id: nextOpId(), layer: MY_LAYER, author: identity.initials, kind: "delete", at: cursor, symbols: symbolsIn(row.text) });
      cursor += 1;
      applied += 1;
    }
  }
  state.futures = state.futures.filter((item) => item.id !== id);
  state.activeLayers.add(MY_LAYER);
  state.mode = "fabric";
  state.file = future.file;
  record("future collapsed", `${future.title} collapsed into the fabric`, "violet");
  render();
  toast(`Future collapsed — ${applied} operations landed in your intent layer`, "mint", "merge");
}

function beamSymbol(symbol) {
  state.beamSymbol = symbol;
  state.beam = Boolean(symbol);
  const hits = Object.entries(state.files).map(([name, file]) => {
    const woven = weave(file.base, file.ops, [...state.activeLayers]);
    return { name, count: woven.lines.filter((line) => line.text.includes(symbol)).length };
  }).filter((entry) => entry.count > 0);
  render();
  const total = hits.reduce((sum, entry) => sum + entry.count, 0);
  toast(`“${symbol}” — ${total} line${total === 1 ? "" : "s"} across ${hits.length} file${hits.length === 1 ? "" : "s"}`, "mint", "target");
}

function toggleBeam() {
  if (state.beam) { state.beam = false; state.beamSymbol = null; render(); toast("Scope beam released", "violet", "target"); return; }
  const line = lineAt(state.selected ?? 1);
  const symbol = symbolsIn(line?.text ?? "")[0];
  if (!symbol) { toast("Select a line with a symbol to beam", "amber", "target"); return; }
  beamSymbol(symbol);
}

const mic = createHuddle({
  onLevel: (level, speaking) => {
    state.huddle.level = level;
    paintHuddleLevels();
    if (sync && state.huddle.joined) sync.send("huddle", { joined: true, muted: state.huddle.muted, level: Math.round(level * 100) / 100, speaking });
  },
  onState: (micState) => { state.huddle.mic = micState; renderHuddle(); },
});

async function toggleHuddle() {
  if (state.huddle.open) { leaveHuddle(); return; }
  state.huddle.open = true;
  renderHuddle();
  const result = await mic.join();
  state.huddle.joined = true;
  if (result.ok) {
    if (sync?.voiceReady) await sync.attachMic(result.track).catch(() => {});
    toast("Huddle open — your microphone is live", "amber", "wave");
  } else if (result.reason === "denied") {
    toast("Huddle open, microphone blocked — allow it in your browser to be heard", "coral", "wave");
  } else {
    toast("Huddle open — this browser can't open a microphone", "violet", "wave");
  }
  sync?.send("huddle", { joined: true, muted: false, level: 0 });
  renderHuddle();
}

function leaveHuddle() {
  mic.leave();
  state.huddle.open = false;
  state.huddle.joined = false;
  state.huddle.level = 0;
  state.huddle.speakers.clear();
  sync?.send("huddle", { joined: false });
  sync?.attachMic(null).catch(() => {});
  renderHuddle();
  toast("You left the huddle", "violet", "wave");
}

function toggleMute() {
  const muted = mic.setMuted(!state.huddle.muted);
  state.huddle.muted = muted;
  sync?.send("huddle", { joined: true, muted, level: 0 });
  renderHuddle();
  toast(muted ? "Microphone muted" : "Microphone live", muted ? "violet" : "amber", muted ? "mic-off" : "mic");
}

/** Cheap per-frame update: only the level rings move, never the whole panel. */
function paintHuddleLevels() {
  const own = $("#huddle-you .huddle-level");
  if (own) own.style.setProperty("--level", state.huddle.level.toFixed(3));
  for (const [id, speaker] of state.huddle.speakers) {
    const node = $(`.huddle-person[data-peer="${CSS?.escape ? CSS.escape(id) : id}"] .huddle-level`);
    if (node) node.style.setProperty("--level", String(speaker.level ?? 0));
  }
}

function renderHuddle() {
  const dock = $("#huddle-dock");
  if (!dock) return;
  const button = $(".huddle-button");
  if (button) button.classList.toggle("is-live", state.huddle.open);
  dock.hidden = !state.huddle.open;
  if (!state.huddle.open) { dock.innerHTML = ""; return; }

  const micLabel = {
    live: "microphone live",
    muted: "muted",
    denied: "microphone blocked by your browser",
    unsupported: "no microphone in this browser",
    idle: "opening your microphone…",
  }[state.huddle.mic] ?? state.huddle.mic;

  const others = [...state.huddle.speakers.entries()].map(([id, speaker]) => `
    <div class="huddle-person" data-peer="${escapeHTML(id)}">
      <span class="huddle-level" style="--level:${speaker.level ?? 0}"><i class="mini-avatar ${speaker.tone ?? "violet"}">${escapeHTML(speaker.initials ?? "??")}</i></span>
      <span><strong>${escapeHTML(speaker.name ?? "Mind")}</strong><small>${speaker.muted ? "muted" : speaker.speaking ? "speaking" : "listening"}</small></span>
      ${speaker.via === "device" ? `<span class="huddle-voice" title="voice carried over the direct connection">${icon("wave")}</span>` : `<span class="huddle-voice quiet" title="same browser — presence only, no audio">${icon("users")}</span>`}
    </div>`).join("");

  dock.innerHTML = `
    <div class="huddle-head">
      <span class="micro-label"><span class="signal"></span> HUDDLE</span>
      <button class="icon-button" data-action="huddle" aria-label="Leave huddle">${icon("x")}</button>
    </div>
    <div class="huddle-people">
      <div class="huddle-person" id="huddle-you">
        <span class="huddle-level" style="--level:${state.huddle.level}"><i class="mini-avatar amber">${escapeHTML(identity.initials)}</i></span>
        <span><strong>You</strong><small class="mic-${state.huddle.mic}">${escapeHTML(micLabel)}</small></span>
      </div>
      ${others || '<p class="huddle-empty">No one else has joined yet. Open this page in another tab, or invite a device for voice.</p>'}
    </div>
    <div class="huddle-actions">
      <button class="pill-button${state.huddle.muted ? "" : " primary"}" data-action="toggle-mute" ${state.huddle.mic === "denied" || state.huddle.mic === "unsupported" ? "disabled" : ""}>
        ${icon(state.huddle.muted ? "mic-off" : "mic")} ${state.huddle.muted ? "Unmute" : "Mute"}</button>
      <button class="pill-button" data-action="huddle">Leave</button>
    </div>
    <audio id="huddle-audio" autoplay></audio>`;
  hydrateIcons(dock);
}

async function exportSealed() {
  const file = state.files[state.file];
  const woven = weave(file.base, file.ops, [...state.activeLayers]);
  const data = woven.lines.map((line) => line.text).join("\n");
  try {
    if (typeof window !== "undefined" && window.claude?.downloads?.save) {
      await window.claude.downloads.save({ filename: state.file, data });
      toast(`${state.file} exported`, "mint", "download");
      return;
    }
    const blob = new Blob([data], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = state.file;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`${state.file} exported`, "mint", "download");
  } catch {
    toast("Export declined", "violet", "download");
  }
}

function askTheRoom(query) {
  const collisions = allCollisions();
  const layers = liveLayers();
  const lines = currentWeave().lines.length;
  toast(`${query ? `“${query}” · ` : ""}${layers.length} layers, ${lines} woven lines, ${collisions.length} collisions, ${openThreads()} open threads`, "violet", "spark");
}

function follow(id) {
  const person = PEOPLE[id];
  if (!person) return;
  state.following = id;
  const banner = $("#follow-banner");
  if (banner) {
    banner.hidden = false;
    const avatar = $("#follow-avatar");
    avatar.textContent = id;
    avatar.className = `mini-avatar ${person.tone}`;
    $("#follow-name").textContent = person.name;
  }
  $$(".avatar[data-person]").forEach((node) => node.classList.toggle("is-followed", person.name === node.dataset.person));
  if (state.files[person.focus]) openFile(person.focus);
  else render();
  toast(`Following ${person.name} through the fabric`, person.tone, "target");
}

function stopFollowing() {
  state.following = null;
  const banner = $("#follow-banner");
  if (banner) banner.hidden = true;
  $$(".avatar").forEach((node) => node.classList.remove("is-followed"));
}

function togglePanel(selector, force) {
  const panel = $(selector);
  if (!panel) return;
  panel.classList.toggle("is-open", force ?? !panel.classList.contains("is-open"));
  doc.body.classList.toggle("has-panel", Boolean($(".project-panel.is-open") || $(".convergence-panel.is-open")));
}

function closePanels() {
  togglePanel(".project-panel", false);
  togglePanel(".convergence-panel", false);
}

/* -------------------------------------------------------- command palette */

const COMMANDS = [
  { id: "scope", icon: "target", title: "Beam the selected symbol", detail: "Light every line that shares it, across every file", key: "⌥ S" },
  { id: "future", icon: "split", title: "Spawn a parallel future", detail: "A private copy of this file the room can still watch" },
  { id: "replay", icon: "history", title: "Replay the session", detail: "Rewind the fabric through every recorded moment" },
  { id: "converge", icon: "merge", title: "Converge ready layers", detail: "Seal every compatible intention at once", key: "↵" },
  { id: "threads", icon: "message", title: "Open living threads", detail: "Conversation anchored to the symbols it shaped" },
  { id: "pulse", icon: "pulse", title: "Inspect the runtime pulse", detail: "Stability and collisions across the woven state" },
  { id: "layers", icon: "layers", title: "Review intent layers", detail: "Every layer's real diff, side by side" },
  { id: "export", icon: "download", title: "Export the woven file", detail: "Download the current file exactly as it reads now" },
  { id: "invite", icon: "user-plus", title: "Invite a mind", detail: "They arrive at this exact live edge" },
  { id: "huddle", icon: "wave", title: "Open or leave the huddle", detail: "Opens your microphone and shows who is talking" },
  { id: "discard", icon: "trash", title: "Discard your intent layer", detail: "Lift everything you've shaped this session" },
  { id: "walkthrough", icon: "spark", title: "Walk me through BRAID", detail: "Eight steps through the model, using your own edits" },
];

let paletteCursor = 0;

function paletteItems(query) {
  const commands = COMMANDS.map((command) => ({ ...command, kind: "command", score: fuzzyScore(query, `${command.title} ${command.detail}`) }));
  const files = Object.keys(state.files).map((name) => ({
    id: `file:${name}`, kind: "file", icon: "code", title: name, detail: `Open ${state.files[name].path.join("/") || "root"}`, score: fuzzyScore(query, name) * 1.4,
  }));
  const threads = state.threads.map((thread) => ({
    id: `thread:${thread.id}`, kind: "thread", icon: "message", title: thread.title, detail: `${thread.file} · ${thread.symbol}`, score: fuzzyScore(query, thread.title),
  }));
  const symbols = [...new Set(Object.values(state.files).flatMap((file) =>
    file.base.flatMap((line) => symbolsIn(line))))].map((symbol) => ({
    id: `symbol:${symbol}`, kind: "symbol", icon: "target", title: symbol, detail: "Beam this symbol across the fabric", score: fuzzyScore(query, symbol) * 0.9,
  }));
  return [...commands, ...files, ...threads, ...symbols]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, query ? 9 : 8);
}

function openPalette() {
  const palette = $("#command-palette");
  if (!palette) return;
  palette.hidden = false;
  const input = $("#command-input");
  if (input) { input.value = ""; setTimeout(() => input.focus(), 30); }
  paletteCursor = 0;
  renderPalette("");
}

function closePalette() {
  const palette = $("#command-palette");
  if (palette) palette.hidden = true;
}

function renderPalette(query) {
  const host = $("#command-results");
  if (!host) return;
  const items = paletteItems(query.trim());
  const context = $(".palette-context span:last-child");
  if (context) context.textContent = `Context: ${state.file}`;
  if (items.length === 0) {
    host.innerHTML = `<div class="palette-empty">Nothing matches “${escapeHTML(query)}” — press ↵ to ask the room instead.</div>`;
    return;
  }
  paletteCursor = Math.min(paletteCursor, items.length - 1);
  host.innerHTML = items.map((item, index) => `
    <button data-command="${escapeHTML(item.id)}" class="${index === paletteCursor ? "is-cursor" : ""}">
      <span data-icon="${item.icon}"></span>
      <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></span>
      ${item.key ? `<kbd>${item.key}</kbd>` : `<span class="palette-kind">${item.kind}</span>`}
    </button>`).join("");
  hydrateIcons(host);
}

function runCommand(id) {
  closePalette();
  if (id.startsWith("file:")) { openFile(id.slice(5)); return; }
  if (id.startsWith("symbol:")) { beamSymbol(id.slice(7)); return; }
  if (id.startsWith("thread:")) { jumpToThread(id.slice(7)); return; }
  switch (id) {
    case "scope": toggleBeam(); break;
    case "future": spawnFuture(); break;
    case "replay": state.position = 0; state.playing = true; render(); toast("Replaying the continuum from the session start", "violet", "history"); break;
    case "converge": runConverge(); break;
    case "threads": setMode("threads"); break;
    case "pulse": setMode("pulse"); break;
    case "layers": setMode("layers"); break;
    case "export": exportSealed(); break;
    case "invite": openModal($("#invite-dialog")); break;
    case "huddle": toggleHuddle(); break;
    case "discard": discardMine(); break;
    case "walkthrough": guide?.start(0); break;
    default: askTheRoom(id);
  }
}

function jumpToThread(id) {
  const thread = state.threads.find((item) => item.id === id);
  if (!thread) return;
  state.mode = "fabric";
  state.position = 1;
  openFile(thread.file);
  const line = currentWeave().lines.find((row) => row.base === thread.at);
  state.selected = line?.n ?? null;
  render();
  const node = $(`.code-line[data-line="${state.selected}"]`);
  node?.scrollIntoView?.({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  toast(`Jumped to ${thread.file} · ${thread.symbol}`, "amber", "target");
}

/* ------------------------------------------------------------- interaction */

function handleAction(action, element) {
  switch (action) {
    case "go-live": state.position = 1; state.playing = false; render(); break;
    case "open-command": openPalette(); break;
    case "close-command": closePalette(); break;
    case "toggle-project": togglePanel(".project-panel"); break;
    case "toggle-convergence": togglePanel(".convergence-panel"); break;
    case "close-panels": closePanels(); break;
    case "scope-beam": toggleBeam(); break;
    case "beam-line": { const symbol = symbolsIn(lineAt(state.selected)?.text ?? "")[0]; if (symbol) beamSymbol(symbol); else toast("No symbol on that line", "amber", "target"); break; }
    case "edit-line": beginEdit(state.selected); break;
    case "insert-line": insertLine(state.selected); break;
    case "delete-line": deleteLine(state.selected); break;
    case "start-thread": startThread(state.selected); break;
    case "cancel-thread": state.composing = null; renderCanvas(); break;
    case "toggle-ghosts":
      state.ghosts = !state.ghosts;
      render();
      toast(state.ghosts
        ? "Ghost edits on — you'll see other minds type before they commit"
        : "Ghost edits off", "violet", "ghost");
      break;
    case "invite": openModal($("#invite-dialog")); break;
    case "copy-invite": {
      const link = $("#invite-link");
      if (link && navigator?.clipboard) navigator.clipboard.writeText(link.value).catch(() => {});
      toast("Session link copied", "mint", "link");
      break;
    }
    case "make-offer": makeOffer(); break;
    case "join-mode":
      $("#paste-field").hidden = false;
      $("#paste-code")?.focus();
      note("Paste the code you were sent, then send the reply code back.");
      break;
    case "copy-offer": {
      const code = $("#offer-code");
      if (code && navigator?.clipboard) navigator.clipboard.writeText(code.value).catch(() => {});
      code?.select?.();
      toast("Invite code copied", "mint", "link");
      break;
    }
    case "use-code": useCode(); break;
    case "forget-relay": {
      const next = win().prompt?.("Room server URL (your deployed Worker), or blank to work locally:", session.url ?? "");
      if (next === null || next === undefined) break;
      try { next.trim() ? storage()?.setItem("braid-relay-url", next.trim()) : storage()?.removeItem("braid-relay-url"); } catch { /* ignore */ }
      toast("Reloading into that room…", "violet", "cloud");
      timers.push(setTimeout(() => win().location.reload(), 600));
      break;
    }
    case "permission-menu": toast("Permission set to “Can shape”", "violet", "shield"); break;
    case "huddle": toggleHuddle(); break;
    case "toggle-mute": toggleMute(); break;
    case "converge": if (allCollisions().length) runConverge(); else openModal($("#converge-dialog")); break;
    case "confirm-converge": closeModal($("#converge-dialog")); runConverge(); break;
    case "toggle-replay":
      state.playing = !state.playing;
      if (state.playing && isLive()) state.position = 0;
      render();
      break;
    case "step-back": state.position = Math.max(0, state.position - 1 / Math.max(1, state.history.length - 1)); state.playing = false; render(); break;
    case "open-thread": setMode("threads"); break;
    case "focus-thread": case "jump-thread": jumpToThread(element.dataset.thread); break;
    case "align-thread": {
      const thread = state.threads.find((item) => item.id === element.dataset.thread);
      thread.aligned += 1;
      render();
      toast(`${thread.aligned} minds aligned on “${thread.title}”`, "mint", "check");
      break;
    }
    case "resolve-thread": {
      const thread = state.threads.find((item) => item.id === element.dataset.thread);
      thread.resolved = true;
      record("thread resolved", `“${thread.title}” resolved`, "mint");
      render();
      toast("Thread resolved into the code it shaped", "mint", "check");
      break;
    }
    case "toggle-problems": {
      const collisions = allCollisions();
      if (collisions.length) { openFile(collisions[0].file); state.selected = collisions[0].line + 1; render(); }
      toast(collisions.length ? `${collisions.length} collision — two layers on one line` : "0 problems against the woven state", collisions.length ? "coral" : "mint", collisions.length ? "x" : "check");
      break;
    }
    case "show-people": toast(`${state.minds} minds across 6 regions`, "violet", "users"); break;
    case "profile": toast(`You are shaping ${state.file}`, "amber", "target"); break;
    case "open-layer-file": openFile(element.dataset.file); break;
    case "discard-mine": discardMine(); break;
    case "stop-following": stopFollowing(); break;
    case "expand-topology": { const blast = blastRadius(liveLayers().map((layer) => layerStats(layer.id))); toast(`${blast.symbols} symbols across ${blast.modules} modules`, "mint", "expand"); break; }
    case "new-file": toast("Every new file starts shared", "mint", "plus"); break;
    case "new-room": toast("Room created — invite minds to shape it", "violet", "plus"); break;
    case "add-layer": setMode("layers"); break;
    case "project-menu": toast("1 workspace · Helix", "violet", "chevrons"); break;
    case "panel-settings": exportSealed(); break;
    case "editor-more": exportSealed(); break;
    case "spawn-future": spawnFuture(); break;
    case "adopt-future": adoptFuture(element.dataset.future); break;
    case "drop-future":
      state.futures = state.futures.filter((item) => item.id !== element.dataset.future);
      render();
      toast("Future dropped", "violet", "trash");
      break;
    default: break;
  }
}

function onClick(event) {
  const target = event.target;

  const guided = target.closest("[data-guide]");
  if (guided) { guide?.handle(guided.dataset.guide); return; }

  if (state.editing && !target.closest("[data-editor]")) {
    const input = $("[data-editor]");
    if (input) { commitEdit(input.textContent); return; }
  }

  const close = target.closest("[data-close]");
  if (close) { event.stopPropagation(); closeTab(close.dataset.close); return; }

  const tab = target.closest("[data-tab]");
  if (tab) { openFile(tab.dataset.tab); return; }

  const file = target.closest(".file-row[data-file]");
  if (file) { openFile(file.dataset.file); if (win().innerWidth <= 780) closePanels(); return; }

  const folder = target.closest(".tree-folder");
  if (folder) {
    folder.classList.toggle("is-open");
    const children = folder.nextElementSibling;
    if (children?.classList.contains("tree-children")) children.hidden = !folder.classList.contains("is-open");
    return;
  }

  const futureLine = target.closest(".future-line");
  if (futureLine) { editFutureLine(futureLine.dataset.future, Number(futureLine.dataset.index)); return; }

  const codeLine = target.closest(".code-line");
  if (codeLine && state.mode === "fabric") {
    const n = Number(codeLine.dataset.line);
    if (state.selected === n && isLive()) beginEdit(n);
    else { state.selected = n; render(); }
    return;
  }

  const mode = target.closest(".nav-button[data-mode]");
  if (mode) { setMode(mode.dataset.mode); return; }

  const intent = target.closest("[data-intent]");
  if (intent) { toggleLayer(intent.dataset.intent); return; }

  const layerToggle = target.closest("[data-toggle-layer]");
  if (layerToggle) { toggleLayer(layerToggle.dataset.toggleLayer); return; }

  const command = target.closest("[data-command]");
  if (command) { runCommand(command.dataset.command); return; }

  const person = target.closest(".avatar[data-person]");
  if (person) {
    const id = Object.keys(PEOPLE).find((key) => PEOPLE[key].name === person.dataset.person);
    if (id) follow(id);
    return;
  }

  const room = target.closest(".room-row[data-room]");
  if (room) {
    $$(".room-row").forEach((node) => node.classList.toggle("is-active", node === room));
    toast(`Joined #${room.dataset.room}`, "violet", "users");
    return;
  }

  const moment = target.closest("[data-moment]");
  if (moment) {
    state.position = Number(moment.dataset.moment) / Math.max(1, state.history.length - 1);
    state.playing = false;
    render();
    toast(moment.dataset.event ?? "", "violet", "history");
    return;
  }

  const track = target.closest(".timeline-track");
  if (track) {
    const rect = track.getBoundingClientRect();
    state.position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    state.playing = false;
    render();
    return;
  }

  const action = target.closest("[data-action]");
  if (action) handleAction(action.dataset.action, action);
}

function editFutureLine(id, index) {
  const future = state.futures.find((item) => item.id === id);
  if (!future) return;
  const next = win().prompt?.(`Reshape line ${index + 1} of ${future.title}`, future.base[index]);
  if (next === null || next === undefined) return;
  pushUndo();
  future.base[index] = next;
  render();
  toast("Future updated — the room is untouched", "violet", "split");
}

function onKeydown(event) {
  const palette = $("#command-palette");
  const paletteOpen = palette && !palette.hidden;
  const editor = $("[data-editor]");

  if (editor && event.target === editor) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commitEdit(editor.textContent); return; }
    if (event.key === "Escape") { event.preventDefault(); state.editing = null; render(); return; }
    return;
  }

  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    if (event.key === "Escape") { state.composing = null; closePalette(); render(); }
    if (!paletteOpen) return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    paletteOpen ? closePalette() : openPalette();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (event.altKey && event.key.toLowerCase() === "s") { event.preventDefault(); toggleBeam(); return; }

  if (paletteOpen) {
    const buttons = $$("#command-results button");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      paletteCursor = Math.max(0, Math.min(buttons.length - 1, paletteCursor + (event.key === "ArrowDown" ? 1 : -1)));
      renderPalette($("#command-input")?.value ?? "");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = buttons[paletteCursor];
      if (chosen) runCommand(chosen.dataset.command);
      else { closePalette(); askTheRoom($("#command-input")?.value ?? ""); }
      return;
    }
  }

  if (state.mode === "fabric" && isLive() && state.selected) {
    const lines = currentWeave().lines.length;
    if (event.key === "ArrowDown") { event.preventDefault(); state.selected = Math.min(lines, state.selected + 1); render(); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); state.selected = Math.max(1, state.selected - 1); render(); return; }
    if (event.key === "Enter") { event.preventDefault(); beginEdit(state.selected); return; }
    if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); deleteLine(state.selected); return; }
  }

  if (event.key === "Escape" && (guide?.active || guide?.tip)) {
    event.preventDefault();
    guide.handle(guide.active ? "skip" : "dismiss-tip");
    return;
  }

  if (event.key === "Escape") {
    state.composing = null;
    state.selected = null;
    closePalette();
    closePanels();
    closeModal($("#invite-dialog"));
    closeModal($("#converge-dialog"));
    render();
  }
}

function onSubmit(event) {
  const composer = event.target.closest("[data-composer]");
  if (composer) {
    event.preventDefault();
    saveThread($("#thread-title")?.value ?? "", $("#thread-body")?.value ?? "");
    return;
  }
  const reply = event.target.closest("[data-reply]");
  if (reply) {
    event.preventDefault();
    const input = reply.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    const thread = state.threads.find((item) => item.id === reply.dataset.reply);
    thread.replies.push({ author: "KC", text });
    thread.resolved = false;
    render();
    toast("Reply anchored to the thread", "amber", "message");
  }
}

/* ------------------------------------------------------------- live fabric */


function tickReplay() {
  if (!state.playing) return;
  state.position = Math.min(1, state.position + 1 / Math.max(1, state.history.length - 1) / 6);
  if (state.position >= 1) state.playing = false;
  render();
}

const timers = [];

/** Stop the live-fabric clocks — used when the app is torn down or tested. */
function stopClocks() {
  guide?.destroy();
  guide = null;
  booted = false;
  timers.splice(0).forEach((id) => { clearInterval(id); clearTimeout(id); });
  clearTimeout(publishTimer);
  try { sync?.close(); } catch { /* a half-open transport is fine to abandon */ }
  sync = null;
}

let booted = false;
const listeners = [];

/** Unbind everything this instance attached, so booting again is safe. */
function detach() {
  stopClocks();
  for (const [type, handler, options] of listeners.splice(0)) {
    try { doc?.removeEventListener(type, handler, options); } catch { /* ignore */ }
  }
  booted = false;
}

function boot(target) {
  // Only accept an actual Document; anything else falls back to the global one.
  const given = target?.nodeType === 9 ? target : null;
  const next = given ?? (typeof document !== "undefined" ? document : doc);
  if (booted) {
    if (next === doc) { render(); return; }   // already running here
    detach();                                 // moving to a different document
  }
  doc = next;
  booted = true;
  state.history.length = 0;
  seedHistory();
  load();
  try {
    bootInteractive();
  } catch (error) {
    // The fabric itself must still render and stay editable.
    console.error("BRAID: a subsystem failed to start", error);
    render();
  }
}

function bootInteractive() {
  if (!layerById(MY_LAYER)) state.layers.push({ id: MY_LAYER, author: identity.initials, ...MY_LAYER_SEED });
  state.activeLayers.add(MY_LAYER);
  ensureLayers();
  hydrateIcons();
  renderInvite();
  try { startSync(); } catch (error) { console.warn("BRAID: collaboration transport unavailable", error); }
  render();

  const onDoubleClick = (event) => {
    const line = event.target.closest?.(".code-line");
    if (line && state.mode === "fabric") beginEdit(Number(line.dataset.line));
  };
  for (const [type, handler] of [["click", onClick], ["dblclick", onDoubleClick], ["keydown", onKeydown], ["submit", onSubmit]]) {
    doc.addEventListener(type, handler);
    listeners.push([type, handler]);
  }
  $("#command-input")?.addEventListener("input", (event) => { paletteCursor = 0; renderPalette(event.target.value); });

  if (typeof setInterval === "function" && !reduceMotion) {
    timers.push(setInterval(tickReplay, 320));
  }

  guide = createGuide({
    doc,
    context: guideContext,
    storage: storage(),
    actions: { openMode: (mode) => { if (state.mode !== mode) setMode(mode); }, icon },
  });
  guide.mount();

  const reposition = () => guide?.render();
  win().addEventListener?.("resize", reposition);
  $("#editor-canvas")?.addEventListener("scroll", reposition, true);
}

if (typeof document !== "undefined") {
  // Wrapped: an event listener is called with an Event, which is not a document.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot());
  else boot();
}

export { state, boot, render, guideContext, receive as receiveMessage, toggleHuddle, toggleMute, renderHuddle, MY_LAYER, mergeFabric, runConverge, toggleLayer, stopClocks, beginEdit, commitEdit, deleteLine, insertLine, spawnFuture, adoptFuture, COMMANDS, getGuide };
