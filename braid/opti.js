/**
 * OPTI — the small creature who lives in the fabric.
 *
 * He is drawn from the three strands the app is built out of, so he belongs to
 * this product rather than being a mascot bolted onto it. He blinks, breathes,
 * looks at whatever he is pointing at, reacts to what actually happens, can be
 * dragged anywhere, talked to, muted and sent away.
 *
 * He never touches the document. Everything he says is about something the
 * user did, and every line he speaks comes from the fixed catalogue in
 * opti-lines.js.
 */

import { OPTI_LINES, answerFor, lineMood, lineText } from "./opti-lines.js";

const POSITION_KEY = "braid-opti-position";

const MOODS = new Set([
  "neutral", "happy", "curious", "alarmed", "sad", "proud",
  "point", "wave", "sleep", "explain", "thinking",
]);

/** Opti's body: three strands, a soft shell, two eyes, one expressive mouth. */
export function optiSVG() {
  return `<svg class="opti-body" viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="optiShell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2740"/><stop offset="1" stop-color="#131b2b"/>
    </linearGradient>
  </defs>
  <g class="opti-strands">
    <path d="M14 40c0-14 36-14 36 0" />
    <path d="M14 34c0-14 36-14 36 0" />
    <path d="M32 12v6" />
  </g>
  <circle class="opti-antenna-tip" cx="32" cy="10" r="3.2"/>
  <rect class="opti-shell" x="12" y="20" width="40" height="34" rx="15" fill="url(#optiShell)"/>
  <g class="opti-face">
    <ellipse class="opti-eye left" cx="24" cy="35" rx="5.4" ry="5.8"/>
    <ellipse class="opti-eye right" cx="40" cy="35" rx="5.4" ry="5.8"/>
    <circle class="opti-pupil left" cx="24" cy="35" r="2.5"/>
    <circle class="opti-pupil right" cx="40" cy="35" r="2.5"/>
    <path class="opti-mouth smile" d="M26 45c2.6 3 9.4 3 12 0"/>
    <path class="opti-mouth flat" d="M27 45.5h10"/>
    <path class="opti-mouth open" d="M28 44c0 4 8 4 8 0 0-2-8-2-8 0z"/>
    <path class="opti-mouth wobble" d="M26 46c2-2.4 4-0.4 6 0s4 2.4 6 0"/>
    <path class="opti-mouth small" d="M30 45.5h4"/>
  </g>
  <g class="opti-arm"><path d="M50 38c5-1 7-4 7-7"/></g>
</svg>`;
}

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {object} options.voice        from createVoice()
 * @param {Storage|null} options.storage
 * @param {(action: string, value?: string) => void} options.onAction
 */
export function createOpti({ doc, voice, storage, onAction } = {}) {
  let root = null;
  let mood = "neutral";
  let bubble = null;
  let panel = null;              // null | ask | answer
  let lastSpoken = null;
  let lastPresentation = null;
  let lastAttempt = null;
  let lastOptions = null;
  let speechRun = 0;
  let dragging = null;
  let targetRect = null;

  const position = loadPosition();

  function loadPosition() {
    try {
      const raw = storage?.getItem(POSITION_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved;
      }
    } catch { /* ignore */ }
    return null;
  }

  function savePosition(next) {
    try { storage?.setItem(POSITION_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function mount(container) {
    if (!doc || root) return root;
    root = doc.createElement("div");
    root.className = "opti";
    root.dataset.mood = mood;
    root.innerHTML = `
      <span class="opti-status" aria-live="polite" aria-atomic="true"></span>
      <button type="button" class="opti-character" data-guide="poke" aria-label="Ask Opti a question"
        aria-expanded="false" aria-controls="opti-bubble">
        ${optiSVG()}
        <span class="opti-shadow" aria-hidden="true"></span>
      </button>`;
    (container ?? doc.body).append(root);
    if (position) {
      const placed = clampPosition(position.x, position.y);
      root.style.left = `${placed.x}px`;
      root.style.top = `${placed.y}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      root.classList.add("is-placed");
    }
    wireDrag();
    return root;
  }

  function clampPosition(x, y) {
    const view = doc?.defaultView;
    const width = root?.offsetWidth || 72;
    const height = root?.offsetHeight || 76;
    const maxX = Math.max(8, (view?.innerWidth ?? 1280) - width - 8);
    const maxY = Math.max(8, (view?.innerHeight ?? 800) - height - 8);
    return {
      x: Math.max(8, Math.min(maxX, Number(x) || 0)),
      y: Math.max(8, Math.min(maxY, Number(y) || 0)),
    };
  }

  /* ---------------------------------------------------------------- moods */

  function setMood(next) {
    mood = MOODS.has(next) ? next : "neutral";
    if (root) root.dataset.mood = mood;
  }

  /** Nudge Opti's eyes toward whatever he is talking about. */
  function lookAt(rect) {
    if (!root) return;
    targetRect = rect ?? null;
    if (!rect) {
      root.style.setProperty("--look-x", "0px");
      root.style.setProperty("--look-y", "0px");
      return;
    }
    const own = root.getBoundingClientRect?.();
    if (!own?.width) return;
    const dx = Math.max(-1, Math.min(1, (rect.left + rect.width / 2 - (own.left + own.width / 2)) / 400));
    const dy = Math.max(-1, Math.min(1, (rect.top + rect.height / 2 - (own.top + own.height / 2)) / 400));
    root.style.setProperty("--look-x", `${(dx * 2.1).toFixed(2)}px`);
    root.style.setProperty("--look-y", `${(dy * 1.6).toFixed(2)}px`);
  }

  /* --------------------------------------------------------------- speech */

  /**
   * Show a bubble and, if he has a voice, say it out loud.
   * `line` is a catalogue id — the only thing ever sent to the speech service.
   */
  async function say({ line, title, body, concept, count, actions = [], tone = "", closeAction = "dismiss" } = {}) {
    if (!root) return;
    const text = body ?? lineText(line);
    if (line) setMood(lineMood(line));
    lastOptions = { line, title, body, concept, count, actions, tone, closeAction };
    lastSpoken = line ?? null;
    const signature = JSON.stringify({ line, title, text, concept, count, actions, tone, closeAction, panel, muted: voice?.muted });
    if (signature !== lastPresentation || !bubble?.isConnected) {
      renderBubble({ title, body: text, concept, count, actions, tone, closeAction });
      lastPresentation = signature;
      const status = root.querySelector(".opti-status");
      if (status) status.textContent = [title, text].filter(Boolean).join(". ");
    } else {
      positionBubble();
    }

    if (!line || !voice?.unlocked || voice.muted || lastAttempt === signature) return "silent";
    lastAttempt = signature;
    const run = ++speechRun;
    root.classList.add("is-speaking");
    const how = await voice?.speak(line, text);
    // A newer line, mute, close, or destroy owns the animation now.
    if (!root || run !== speechRun) return how ?? "silent";
    root.classList.remove("is-speaking");
    if (how && how !== "silent") root.dataset.voiced = how;
    return how ?? "silent";
  }

  function renderBubble({ title, body, concept, count, actions, tone, closeAction }) {
    if (!root) return;
    bubble?.remove();
    bubble = doc.createElement("div");
    bubble.id = "opti-bubble";
    bubble.className = `guide-card opti-bubble${tone ? ` ${tone}` : ""}`;
    bubble.setAttribute("role", panel ? "dialog" : "note");
    if (panel) bubble.setAttribute("aria-label", panel === "ask" ? "Ask Opti" : "Opti's answer");
    bubble.innerHTML = `
      <div class="guide-head">
        <span class="guide-count">${escapeOpti(count ?? "opti")}</span>
        <button type="button" class="opti-mute" data-guide="mute" aria-pressed="${voice?.muted ? "true" : "false"}" aria-label="${voice?.muted ? "Unmute Opti" : "Mute Opti"}" title="${voice?.muted ? "Unmute Opti" : "Mute Opti"}">${voice?.muted ? "🔇" : "🔊"}</button>
        <button type="button" class="guide-x" data-guide="${escapeOpti(closeAction)}" aria-label="Close Opti">✕</button>
      </div>
      ${title ? `<strong class="guide-title">${escapeOpti(title)}</strong>` : ""}
      <p class="guide-body">${escapeOpti(body)}</p>
      ${concept ? `<p class="guide-concept">${escapeOpti(concept)}</p>` : ""}
      <div class="guide-actions">${actions.map(actionHTML).join("")}</div>
      ${panel === "ask" ? askHTML() : ""}`;
    root.append(bubble);
    root.querySelector(".opti-character")?.setAttribute("aria-expanded", "true");
    positionBubble();
  }

  function positionBubble() {
    if (!root) return;
    if (root.classList.contains("is-placed")) {
      const placed = clampPosition(Number.parseFloat(root.style.left), Number.parseFloat(root.style.top));
      root.style.left = `${placed.x}px`;
      root.style.top = `${placed.y}px`;
    }
    if (!bubble) return;
    const view = doc?.defaultView;
    const viewportWidth = view?.innerWidth ?? 1280;
    const viewportHeight = view?.innerHeight ?? 800;
    const own = root.getBoundingClientRect?.() ?? { left: 16, right: 88, top: viewportHeight - 124, bottom: viewportHeight - 48 };
    const width = Math.min(300, Math.max(240, viewportWidth - 24));
    const height = bubble.offsetHeight || 250;
    const anchor = targetRect;
    let left = (anchor?.right ?? own.right) + 12;
    if (left + width > viewportWidth - 12) left = (anchor?.left ?? own.left) - width - 12;
    left = Math.max(12, Math.min(viewportWidth - width - 12, left));
    let top = (anchor?.top ?? own.top) - 16;
    top = Math.max(12, Math.min(viewportHeight - height - 12, top));
    bubble.style.width = `${width}px`;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  }

  function actionHTML(action) {
    if (action.kind === "waiting") return `<span class="guide-waiting">${escapeOpti(action.label)}</span>`;
    const className = action.kind === "primary" ? "guide-go" : "guide-skip";
    return `<button type="button" class="${className}" data-guide="${escapeOpti(action.id)}">${escapeOpti(action.label)}</button>`;
  }

  function askHTML() {
    return `<form class="opti-ask" data-opti-ask>
      <input name="question" placeholder="Ask Opti about this place…" autocomplete="off" aria-label="Ask Opti a question" />
      <button type="submit" class="guide-go">Ask</button>
    </form>`;
  }

  /** Answer a typed question from the catalogue. Never invents an answer. */
  async function ask(question) {
    const line = answerFor(question);
    panel = "answer";
    await say({
      line,
      title: line === "ask-unknown" ? "I don't know that one" : "Opti",
      count: "answer",
      closeAction: "close-opti",
      actions: [{ id: "ask-more", kind: "primary", label: "Ask another" }, { id: "close-opti", label: "Close" }],
    });
    queueMicrotask(() => bubble?.querySelector('[data-guide="ask-more"]')?.focus?.());
    return line;
  }

  function openAsk() {
    lookAt(null);
    panel = "ask";
    say({
      line: "ask-who",
      title: "Ask me anything about BRAID",
      count: "opti",
      closeAction: "close-opti",
      actions: [{ id: "close-opti", label: "Close" }],
    });
    queueMicrotask(() => bubble?.querySelector("input")?.focus?.());
  }

  function closeAsk() { panel = null; }

  function refresh() {
    if (!lastOptions) return;
    lastPresentation = null;
    lastAttempt = null;
    say(lastOptions);
  }

  function idle() {
    speechRun += 1;
    voice?.stop?.();
    bubble?.remove();
    bubble = null;
    panel = null;
    targetRect = null;
    lastPresentation = null;
    lastAttempt = null;
    lastOptions = null;
    root?.querySelector(".opti-character")?.setAttribute("aria-expanded", "false");
    root?.classList.remove("is-speaking");
    setMood("neutral");
  }

  function sleep() {
    idle();
    setMood("sleep");
  }

  /* ----------------------------------------------------------------- drag */

  function wireDrag() {
    const handle = root.querySelector(".opti-character");
    if (!handle?.addEventListener) return;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      dragging = {
        pointerId: event.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        left: rect.left || Number.parseFloat(root.style.left) || 0,
        top: rect.top || Number.parseFloat(root.style.top) || 0,
        moved: false,
      };
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const dx = event.clientX - dragging.pointerX;
      const dy = event.clientY - dragging.pointerY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
      if (!dragging.moved) return;
      event.preventDefault?.();
      const { x, y } = clampPosition(dragging.left + dx, dragging.top + dy);
      root.classList.add("is-placed", "is-dragging");
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      positionBubble();
    });
    const drop = (event) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const moved = dragging.moved;
      dragging = null;
      root.classList.remove("is-dragging");
      handle.releasePointerCapture?.(event.pointerId);
      if (moved) {
        savePosition({ x: Number.parseFloat(root.style.left) || 0, y: Number.parseFloat(root.style.top) || 0 });
        // A drag is not a click: swallow the click that follows.
        root.dataset.justDragged = "true";
        setTimeout(() => { delete root.dataset.justDragged; }, 60);
      }
    };
    handle.addEventListener("pointerup", drop);
    handle.addEventListener("pointercancel", drop);
  }

  function wasDragged() { return root?.dataset.justDragged === "true"; }

  function destroy() {
    speechRun += 1;
    voice?.stop?.();
    root?.remove();
    root = null;
    bubble = null;
    panel = null;
  }

  return {
    mount, say, ask, idle, sleep, setMood, lookAt, openAsk, closeAsk, refresh, positionBubble, destroy, wasDragged,
    get element() { return root; },
    get mood() { return mood; },
    get asking() { return panel === "ask"; },
    get engaged() { return panel !== null; },
    get lastSpoken() { return lastSpoken; },
    get bubble() { return bubble; },
    focus: () => root?.querySelector(".opti-character")?.focus?.(),
  };
}

export const OPTI_LINE_IDS = Object.keys(OPTI_LINES);

function escapeOpti(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
