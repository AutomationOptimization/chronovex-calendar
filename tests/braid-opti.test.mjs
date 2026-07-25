import test from "node:test";
import assert from "node:assert/strict";

import { createGuide } from "../braid/guide.js";
import { answerFor, lineMood, lineText, OPTI_LINES } from "../braid/opti-lines.js";
import { createOpti } from "../braid/opti.js";
import { createVoice } from "../braid/voice.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeUtterance {
  constructor(text) { this.text = text; }
}

function endingSynth() {
  return {
    spoken: [],
    cancelled: 0,
    speak(utterance) {
      this.spoken.push(utterance);
      queueMicrotask(() => utterance.onend?.());
    },
    cancel() { this.cancelled += 1; },
  };
}

test("every Opti answer comes from the fixed catalogue", () => {
  assert.equal(answerFor("why are there no branches?"), "ask-branches");
  assert.equal(answerFor("how does the room persist?"), "ask-room");
  assert.equal(answerFor("tell me about collisions"), "ask-collision");
  assert.equal(answerFor("something unrelated"), "ask-unknown");
  for (const [id, line] of Object.entries(OPTI_LINES)) {
    assert.equal(lineText(id), line.text);
    assert.equal(lineMood(id), line.mood);
    assert.ok(line.text.length > 10, `${id} has a real answer`);
  }
});

test("browser voice is gesture-gated, cancellable, and remembers mute", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const synth = endingSynth();
  const voice = createVoice({ storage, speechSynthesisImpl: synth, UtteranceImpl: FakeUtterance, playbackTimeoutMs: 50 });

  assert.equal(await voice.speak("hello", "Hello"), "silent");
  assert.equal(synth.spoken.length, 0, "no sound happens before a real gesture");

  voice.unlock();
  assert.equal(await voice.speak("hello", "Hello"), "browser");
  assert.equal(synth.spoken[0].text, "Hello");

  voice.setMuted(true);
  assert.equal(values.get("braid-opti-voice"), "muted");
  assert.equal(await voice.speak("hello", "Hello again"), "silent");
  assert.equal(synth.spoken.length, 1);

  voice.setMuted(false);
  assert.equal(values.get("braid-opti-voice"), "loud");
  voice.destroy();
});

test("mute cancels a pending room voice before it can play", async () => {
  let resolveFetch;
  let plays = 0;
  const fetchImpl = () => new Promise((resolve) => { resolveFetch = resolve; });
  class FakeAudio {
    play() { plays += 1; return Promise.resolve(); }
    pause() {}
  }
  const synth = endingSynth();
  const voice = createVoice({
    relayUrl: "https://voice.example",
    fetchImpl,
    AudioImpl: FakeAudio,
    speechSynthesisImpl: synth,
    UtteranceImpl: FakeUtterance,
    playbackTimeoutMs: 20,
  });
  voice.unlock();
  const pending = voice.speak("hello", "Hello");
  await settle();
  voice.setMuted(true);
  resolveFetch({ ok: true, blob: async () => new Blob(["audio"]) });
  assert.equal(await pending, "silent");
  assert.equal(plays, 0, "late audio cannot start after mute");
  assert.equal(synth.spoken.length, 0);
});

test("an unavailable optional voice route is probed once, then falls back locally", async () => {
  let requests = 0;
  const synth = endingSynth();
  const voice = createVoice({
    relayUrl: "https://relay-without-voice.example",
    fetchImpl: async () => { requests += 1; return { ok: false, status: 404 }; },
    speechSynthesisImpl: synth,
    UtteranceImpl: FakeUtterance,
    playbackTimeoutMs: 50,
  });
  voice.unlock();
  assert.equal(await voice.speak("hello", "Hello"), "browser");
  assert.equal(await voice.speak("ask-room", "The room persists"), "browser");
  assert.equal(requests, 1);
  assert.equal(voice.roomAvailable, "none");
  assert.equal(synth.spoken.length, 2);
});

test("Opti deduplicates repeated renders and keeps Q&A state coherent", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const calls = [];
  const voice = {
    muted: false,
    unlocked: true,
    speak: async (line) => { calls.push(line); return "silent"; },
    stop() {},
  };
  const opti = createOpti({ doc: dom.window.document, voice, storage: null });
  opti.mount();
  try {
    const card = { line: "hello", title: "Hello", count: "opti", actions: [] };
    await opti.say(card);
    await opti.say(card);
    await opti.say(card);
    assert.deepEqual(calls, ["hello"], "the same presentation is spoken once");
    assert.equal(dom.window.document.querySelectorAll(".opti-bubble").length, 1);

    opti.openAsk();
    await settle();
    assert.ok(dom.window.document.querySelector("[data-opti-ask]"));
    assert.equal(dom.window.document.activeElement?.name, "question");

    await opti.ask("how does the room work?");
    assert.equal(opti.asking, false);
    assert.equal(opti.engaged, true);
    assert.equal(dom.window.document.querySelector("[data-opti-ask]"), null, "the answer does not retain a duplicate form");
    assert.match(dom.window.document.querySelector(".guide-body").textContent, /session lives in a room/i);
  } finally {
    opti.destroy();
    dom.window.close();
  }
});

test("guide Q&A suspends the tour and the finale remains until acknowledged", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body><button class=invite-button></button></body>", { pretendToBeVisual: true });
  const voice = { muted: false, unlocked: true, speak: async () => "silent", stop() {}, destroy() {} };
  const ctx = {
    mode: "fabric", live: true, editing: false, selected: null, myOps: 0, collisions: 0,
    activeSignature: "a,b", layersInFlight: 0, baseVersion: 0, peers: 0, threads: 0,
    futures: 0, micState: "idle", huddleOpen: false, paletteOpen: false, dialogOpen: false,
  };
  const guide = createGuide({ doc: dom.window.document, context: () => ctx, storage: null, voice });
  guide.mount();
  try {
    guide.start(7);
    assert.equal(guide.step.id, "room");
    guide.handle("open-ask");
    assert.ok(dom.window.document.querySelector("[data-opti-ask]"));
    assert.equal(guide.step.id, "room", "asking does not discard walkthrough progress");
    guide.handle("close-opti");
    assert.match(dom.window.document.querySelector(".guide-title").textContent, /Bring in another mind/);

    guide.handle("advance");
    assert.equal(guide.finale, true);
    assert.ok(dom.window.document.querySelector(".opti-bubble"));
    assert.match(dom.window.document.querySelector(".guide-body").textContent, /whole model/i);
    guide.render();
    assert.ok(dom.window.document.querySelector(".opti-bubble"), "ordinary renders cannot erase the finale");
    guide.handle("close-finale");
    assert.equal(guide.finale, false);
  } finally {
    guide.destroy();
    dom.window.close();
  }
});

test("guide hides a live tip while the user is typing and restores it afterward", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const values = new Map([["braid-guide-v1", JSON.stringify({
    dismissed: false, offered: true, tourDone: true, seenTips: [], step: 0,
  })]]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const ctx = {
    mode: "fabric", live: true, editing: false, selected: null, myOps: 0, collisions: 1,
    activeSignature: "a,b", layersInFlight: 1, baseVersion: 0, peers: 0, threads: 0,
    futures: 0, micState: "idle", huddleOpen: false, paletteOpen: false, dialogOpen: false,
  };
  const voice = { muted: false, unlocked: true, speak: async () => "silent", stop() {}, destroy() {} };
  const guide = createGuide({ doc: dom.window.document, context: () => ctx, storage, voice });
  guide.mount();
  try {
    assert.equal(guide.tip.id, "first-collision");
    assert.ok(dom.window.document.querySelector(".opti-bubble"));
    ctx.editing = true;
    guide.sync();
    assert.equal(guide.tip, null);
    assert.equal(dom.window.document.querySelector(".opti-bubble"), null, "Opti gets out of the way mid-keystroke");
    ctx.editing = false;
    guide.sync();
    assert.equal(guide.tip.id, "first-collision", "the unsaid tip can return after typing");
  } finally {
    guide.destroy();
    dom.window.close();
  }
});

test("mute updates the visible control without speaking the wrong line", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const spoken = [];
  const voice = {
    muted: false,
    unlocked: true,
    unlock() {},
    stop() {},
    destroy() {},
    setMuted(next) { this.muted = Boolean(next); this.stop(); return this.muted; },
    async speak(line) { spoken.push(line); return "silent"; },
  };
  const guide = createGuide({ doc: dom.window.document, context: () => ({ ...{
    mode: "fabric", live: true, editing: false, selected: null, myOps: 0, collisions: 0,
    activeSignature: "a", layersInFlight: 0, baseVersion: 0, peers: 0, threads: 0,
    futures: 0, micState: "idle", huddleOpen: false, paletteOpen: false, dialogOpen: false,
  } }), storage: null, voice });
  guide.mount();
  try {
    guide.handle("open-ask");
    await settle();
    assert.equal(dom.window.document.querySelector(".opti-mute").getAttribute("aria-label"), "Mute Opti");
    guide.handle("mute");
    assert.equal(dom.window.document.querySelector(".opti-mute").getAttribute("aria-label"), "Unmute Opti");
    assert.equal(dom.window.document.querySelector(".opti-mute").getAttribute("aria-pressed"), "true");
    guide.handle("mute");
    await settle();
    assert.equal(dom.window.document.querySelector(".opti-mute").getAttribute("aria-label"), "Mute Opti");
    assert.doesNotMatch(spoken.join(" "), /muted/, "unmuting never says 'Quiet from now on'");
  } finally {
    guide.destroy();
    dom.window.close();
  }
});
