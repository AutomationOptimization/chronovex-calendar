/**
 * The guide's brain. Opti is its face and voice; this decides what he says.
 *
 * Two jobs, one module:
 *
 *   • A walkthrough of BRAID's actual model. Every step advances ONLY when the
 *     application state really changed. There is no timer, no scripted
 *     playback, and it never performs the user's work for them. If the step
 *     says "collide with another intent", the guide waits until a collision
 *     genuinely exists.
 *
 *   • A coach that watches real state and explains a concept the first time
 *     the user hits it — a collision appearing, someone joining the room,
 *     trying to edit a past moment — then never mentions it again.
 *
 * It is deliberately hard to hate: it never covers the control it points at,
 * never steals focus, never speaks while you are typing, says each thing once,
 * and stays gone once dismissed.
 */

import { createOpti } from "./opti.js";

const KEY = "braid-guide-v1";

/* ------------------------------------------------------------------ script */

/**
 * A step is complete when `done(ctx, start)` is true, where `ctx` is the live
 * application state and `start` is that same state captured when the step
 * opened. Steps that teach rather than ask use `acknowledge: true`.
 */
export const STEPS = [
  {
    id: "shape",
    line: "step-shape",
    title: "Shape a line",
    body: "Click any line of code, then click it again to type into it.",
    concept: "Nothing is checked out and nothing is locked. You edit the shared file directly.",
    anchor: '.code-line[data-line="4"]',
    mode: "fabric",
    done: (ctx, start) => ctx.myOps > start.myOps,
  },
  {
    id: "layer",
    line: "step-layer",
    title: "That became your layer",
    body: "Your edit did not overwrite the file. It hovers above the same lines everyone else is reading, in your colour.",
    concept: "Branches are replaced by intent layers that coexist on one document.",
    anchor: '.intent-card:last-of-type',
    acknowledge: "I see it",
  },
  {
    id: "lift",
    line: "step-lift",
    title: "Lift someone's intent",
    body: "Click another layer in the Convergence panel. The document re-weaves under you as it leaves.",
    concept: "Any subset of intentions can be read at once. The file is a view, not a fixed text.",
    anchor: '.intent-card[data-intent="latency"]',
    done: (ctx, start) => ctx.activeSignature !== start.activeSignature,
  },
  {
    id: "collide",
    line: "step-collide",
    title: "Collide on purpose",
    body: "The ringed line was rewritten by someone else's layer. Edit that one.",
    concept: "Two intentions on one line is a collision, surfaced immediately, not a merge conflict discovered later.",
    anchor: ".code-line[data-layer].is-edited:not(.is-mine)",
    mode: "fabric",
    done: (ctx) => ctx.collisions > 0,
  },
  {
    id: "resolve",
    line: "step-resolve",
    title: "Nothing was lost",
    body: "Both intents are still here, and convergence is blocked until a person decides. Lift one layer, or press ⌘Z.",
    concept: "The fabric refuses to guess. Resolution is a human act, in place, with no branch to reconcile.",
    anchor: "#converge-button",
    done: (ctx, start) => start.collisions > 0 && ctx.collisions === 0,
  },
  {
    id: "converge",
    line: "step-converge",
    title: "Seal the fabric",
    body: "Converge fuses every compatible layer into one shared state at once — or nothing lands at all.",
    concept: "Convergence is atomic. There is no half-merged repository to recover from.",
    anchor: "#converge-button",
    done: (ctx, start) => ctx.baseVersion > start.baseVersion,
  },
  {
    id: "continuum",
    line: "step-continuum",
    title: "Rewind the session",
    body: "Click a moment on the continuum at the bottom. The document reassembles exactly as it was then.",
    concept: "History is a state you can stand in, not a list of diffs to read.",
    anchor: ".timeline-wrap",
    done: (ctx) => !ctx.live,
  },
  {
    id: "room",
    line: "step-room",
    title: "Bring in another mind",
    body: "Your session is a room. Anyone who opens its link joins this fabric and appears beside you.",
    concept: "The room holds the woven state, so it outlives every browser that was in it.",
    anchor: ".invite-button",
    acknowledge: "Finish",
  },
];

/** Contextual explanations. Each fires at most once, ever. */
export const TIPS = [
  {
    id: "first-collision",
    line: "tip-first-collision",
    title: "Two layers, one line",
    body: "Both edits are held and shown. Convergence stays blocked until someone lifts a layer or changes a line.",
    when: (ctx) => ctx.collisions > 0,
  },
  {
    id: "converge-ready",
    line: "tip-converge-ready",
    title: "Ready to seal",
    body: "Every layer in flight is compatible. Converging now folds them all into the shared state together.",
    when: (ctx) => ctx.collisions === 0 && ctx.layersInFlight >= 2 && ctx.myOps > 0,
  },
  {
    id: "peer-joined",
    line: "tip-peer-joined",
    title: "Someone is in the room",
    body: "You are both editing the same fabric now. Their unfinished typing appears as a ghost line before they commit.",
    when: (ctx) => ctx.peers > 0,
  },
  {
    id: "past-is-read-only",
    line: "tip-past-is-read-only",
    title: "You are in the past",
    body: "This is the document as it actually was. Return to the live edge to shape it again.",
    when: (ctx) => !ctx.live,
  },
  {
    id: "mic-blocked",
    line: "tip-mic-blocked",
    title: "The huddle has no microphone",
    body: "Your browser blocked it. You can still sit in the huddle and see who is speaking.",
    when: (ctx) => ctx.micState === "denied" || ctx.micState === "unsupported",
  },
  {
    id: "future-open",
    line: "tip-future-open",
    title: "A future is yours alone",
    body: "Edit it freely — the room is untouched until you collapse it back in as an intent layer.",
    when: (ctx) => ctx.futures > 0,
  },
];

/* ------------------------------------------------------------------ memory */

export function loadMemory(storage) {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return { dismissed: false, tourDone: false, seenTips: [], step: 0, ...JSON.parse(raw) };
  } catch { /* a guide that cannot remember is still a guide */ }
  return { dismissed: false, tourDone: false, seenTips: [], step: 0, offered: false };
}

export function saveMemory(storage, memory) {
  try { storage?.setItem(KEY, JSON.stringify(memory)); } catch { /* ignore */ }
}

/**
 * Which tip, if any, should be shown right now.
 * Pure so the policy can be tested without a DOM: it is the part that decides
 * whether this feature is tolerable.
 */
export function nextTip(ctx, memory, { tips = TIPS } = {}) {
  if (memory.dismissed) return null;
  if (ctx.editing) return null;            // never interrupt someone mid-keystroke
  if (ctx.paletteOpen || ctx.dialogOpen) return null;
  const seen = new Set(memory.seenTips ?? []);
  return tips.find((tip) => !seen.has(tip.id) && tip.when(ctx)) ?? null;
}

/** The first step the user has not already satisfied. */
export function stepIndexFor(memory, { steps = STEPS } = {}) {
  const index = Math.min(memory.step ?? 0, steps.length - 1);
  return Math.max(0, index);
}

/* ------------------------------------------------------------------ engine */

/**
 * @param {object} options
 * @param {Document} options.doc         the document this guide belongs to
 * @param {() => object} options.context reads live application state
 * @param {Storage|null} options.storage
 * @param {object} options.actions       { openMode, icon }
 */
export function createGuide({ doc, context, storage, voice, actions = {} } = {}) {
  const memory = loadMemory(storage);
  let opti = null;
  let root = null;
  let step = null;           // { index, start }
  let tip = null;
  let finale = false;
  let mounted = false;

  const remember = () => saveMemory(storage, memory);

  function mount() {
    if (!doc || mounted) return;
    root = doc.createElement("div");
    root.className = "guide-root";
    root.id = "guide-root";
    doc.body.append(root);
    opti = createOpti({ doc, voice, storage, onAction: handle });
    opti.mount(root);
    mounted = true;
    sync();
  }

  /* ------------------------------- lifecycle ------------------------------ */

  function start(index = stepIndexFor(memory)) {
    finale = false;
    memory.dismissed = false;
    memory.offered = true;
    memory.tourDone = false;
    memory.step = index;
    remember();
    openStep(index);
  }

  function openStep(index) {
    if (index >= STEPS.length) { finish(); return; }
    const definition = STEPS[index];
    if (definition.mode && actions.openMode) actions.openMode(definition.mode);
    step = { index, start: context() };
    memory.step = index;
    remember();
    render();
  }

  function advance() {
    if (!step) return;
    openStep(step.index + 1);
  }

  function finish() {
    step = null;
    tip = null;
    finale = true;
    memory.tourDone = true;
    memory.step = 0;
    remember();
    render();
  }

  function dismiss() {
    step = null;
    tip = null;
    finale = false;
    memory.dismissed = true;
    memory.offered = true;
    remember();
    render();
  }

  function dismissTip() {
    if (tip) {
      memory.seenTips = [...new Set([...(memory.seenTips ?? []), tip.id])];
      remember();
      tip = null;
    }
    render();
  }

  /**
   * Called after every application render. Decides whether the current step is
   * satisfied and whether a tip is due — always from real state, never a timer.
   */
  function sync() {
    if (!mounted) return;
    const ctx = context();

    // Q&A deliberately suspends the walkthrough/tips without destroying their
    // state. Closing the answer returns to exactly what was underneath it.
    if (opti?.engaged) { render(); return; }

    if (step) {
      const definition = STEPS[step.index];
      const complete = definition.done ? definition.done(ctx, step.start) : false;
      if (complete) {
        // Teaching steps are acknowledged; doing steps advance the moment they are done.
        openStep(step.index + 1);
        return;
      }
    } else if (!memory.dismissed && !finale) {
      const due = nextTip(ctx, memory);
      if (due && due !== tip) tip = due;
      if (!due && tip) tip = null;
    }

    render();
  }

  /* -------------------------------- drawing ------------------------------- */

  function anchorRect(selector) {
    if (!selector) return null;
    const node = doc.querySelector(selector);
    if (!node?.getBoundingClientRect) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return rect;
  }

  function clearRing() {
    root?.querySelectorAll(".guide-ring").forEach((node) => node.remove());
  }

  function drawRing(rect) {
    clearRing();
    if (!rect || !root) return;
    const node = doc.createElement("div");
    node.className = "guide-ring";
    node.style.left = `${Math.round(rect.left - 4)}px`;
    node.style.top = `${Math.round(rect.top - 4)}px`;
    node.style.width = `${Math.round(rect.width + 8)}px`;
    node.style.height = `${Math.round(rect.height + 8)}px`;
    root.append(node);
  }

  function waitingLabel(definition) {
    return { shape: "waiting for your edit", lift: "waiting for a layer to move", collide: "waiting for a collision",
      resolve: "waiting for it to clear", converge: "waiting for a convergence",
      continuum: "waiting for you to rewind" }[definition.id] ?? "waiting for you";
  }

  function render() {
    if (!root || !opti) return;

    if (opti.engaged) {
      clearRing();
      opti.positionBubble();
      return;
    }

    if (step) {
      const definition = STEPS[step.index];
      const rect = anchorRect(definition.anchor);
      drawRing(rect);
      opti.lookAt(rect);
      opti.say({
        line: definition.line,
        title: definition.title,
        body: definition.body,
        concept: definition.concept,
        count: `${step.index + 1} of ${STEPS.length}`,
        actions: definition.acknowledge
          ? [{ id: "advance", kind: "primary", label: definition.acknowledge }, { id: "skip", label: "Skip" }]
          : [{ kind: "waiting", label: waitingLabel(definition) }, { id: "skip", label: "Skip" }],
      });
      return;
    }

    clearRing();

    if (finale) {
      opti.lookAt(null);
      opti.say({
        line: "tour-done",
        title: "That's the model",
        count: "done",
        closeAction: "close-finale",
        actions: [{ id: "close-finale", kind: "primary", label: "Thanks" }],
      });
      return;
    }

    if (tip) {
      opti.lookAt(null);
      opti.say({
        line: tip.line,
        title: tip.title,
        body: tip.body,
        count: "opti",
        tone: "is-tip",
        actions: [{ id: "dismiss-tip", kind: "primary", label: "Got it" }, { id: "dismiss", label: "Stop explaining" }],
      });
      return;
    }

    if (!memory.dismissed && !memory.offered) {
      opti.lookAt(null);
      opti.say({
        line: memory.tourDone ? "hello-again" : "hello",
        title: "Hello, I'm Opti",
        count: "opti",
        tone: "is-offer",
        actions: [{ id: "start", kind: "primary", label: "Show me" }, { id: "dismiss", label: "Not now" }],
      });
      return;
    }

    if (memory.dismissed) opti.sleep();
    else opti.idle();
  }

  /* ------------------------------- delegation ----------------------------- */

  function handle(action, value) {
    voice?.unlock?.();
    switch (action) {
      case "poke":
        if (opti.wasDragged()) return true;       // a drag is not a poke
        if (opti.engaged) { opti.idle(); render(); } else opti.openAsk();
        return true;
      case "open-ask":
        if (!opti.engaged) opti.openAsk();
        return true;
      case "mute": {
        voice?.setMuted(!voice.muted);
        opti.refresh();
        return true;
      }
      case "ask": opti.ask(value); return true;
      case "ask-more": opti.openAsk(); return true;
      case "close-opti": opti.idle(); render(); opti.focus(); return true;
      case "close-finale": finale = false; opti.idle(); render(); return true;
      case "start": start(memory.tourDone ? 0 : stepIndexFor(memory)); return true;
      case "advance": advance(); return true;
      case "skip": advance(); return true;
      case "dismiss": dismiss(); return true;
      case "wake": memory.dismissed = false; remember(); render(); return true;
      case "dismiss-tip": dismissTip(); return true;
      default: return false;
    }
  }

  function destroy() {
    opti?.destroy();
    opti = null;
    voice?.destroy?.();
    root?.remove();
    root = null;
    mounted = false;
  }

  return {
    mount, sync, render, handle, start, dismiss, destroy,
    get memory() { return memory; },
    get opti() { return opti; },
    unlockVoice: () => voice?.unlock(),
    get step() { return step ? { ...STEPS[step.index], index: step.index } : null; },
    get tip() { return tip; },
    get finale() { return finale; },
    get active() { return Boolean(step); },
  };
}
