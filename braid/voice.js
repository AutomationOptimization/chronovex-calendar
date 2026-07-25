/**
 * Opti's voice.
 *
 * The shipped Pages app uses the browser's own speech synthesis: no API key,
 * account, or pretend audio service. An optional relay may expose
 * `/speak/<catalogue-id>` later; if it does not, one failed capability probe
 * disables that path for the session and speech falls back locally.
 *
 * Browsers require a real user gesture before audio, so callers explicitly
 * unlock the voice. Mute, stop, and a newer utterance cancel every pending
 * fetch/playback before it can make sound.
 */

const speaker = () => (typeof window !== "undefined" ? window : globalThis);
const VOICE_STORAGE_KEY = "braid-opti-voice";

export function createVoice({
  relayUrl = "",
  storage = null,
  fetchImpl,
  AudioImpl,
  speechSynthesisImpl,
  UtteranceImpl,
  requestTimeoutMs = 2500,
  playbackTimeoutMs,
} = {}) {
  let muted = readMuted(storage);
  let unlocked = false;
  let currentAudio = null;
  let controller = null;
  let finishActive = null;
  let generation = 0;
  let roomAvailable = relayUrl ? "unknown" : "none";
  let lastChannel = "none";
  const cache = new Map();

  function readMuted(store) {
    try { return store?.getItem(VOICE_STORAGE_KEY) === "muted"; } catch { return false; }
  }

  function persist() {
    try { storage?.setItem(VOICE_STORAGE_KEY, muted ? "muted" : "loud"); } catch { /* ignore */ }
  }

  function unlock() {
    unlocked = true;
  }

  function active(run) {
    return run === generation && unlocked && !muted;
  }

  function stop() {
    generation += 1;
    try { controller?.abort?.(); } catch { /* ignore */ }
    controller = null;
    const finish = finishActive;
    finishActive = null;
    finish?.(false);
    try { currentAudio?.pause?.(); } catch { /* ignore */ }
    currentAudio = null;
    try { (speechSynthesisImpl ?? speaker().speechSynthesis)?.cancel?.(); } catch { /* ignore */ }
  }

  function durationFor(text) {
    if (Number.isFinite(playbackTimeoutMs)) return Math.max(1, playbackTimeoutMs);
    return Math.max(3500, Math.min(22000, String(text ?? "").length * 72 + 1200));
  }

  function waitForAudio(audio, text, run) {
    return new Promise((resolve) => {
      let settled = false;
      let started = false;
      let timer = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (finishActive === finish) finishActive = null;
        if (currentAudio === audio) currentAudio = null;
        resolve(Boolean(ok && active(run)));
      };
      finishActive = finish;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      timer = setTimeout(() => {
        try { audio.pause?.(); } catch { /* ignore */ }
        finish(started);
      }, durationFor(text));
      try {
        if (typeof audio.play !== "function") { finish(false); return; }
        Promise.resolve(audio.play()).then(() => { started = true; }, () => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  async function fromRoom(line, text, run) {
    if (!relayUrl || roomAvailable === "none") return false;
    const view = speaker();
    const get = fetchImpl ?? view.fetch?.bind(view);
    if (typeof get !== "function") { roomAvailable = "none"; return false; }

    let audioUrl = cache.get(line);
    if (!audioUrl) {
      const Controller = view.AbortController ?? globalThis.AbortController;
      const requestController = typeof Controller === "function" ? new Controller() : null;
      controller = requestController;
      const timeout = requestController ? setTimeout(() => requestController.abort(), requestTimeoutMs) : null;
      try {
        const response = await get(`${relayUrl}/speak/${encodeURIComponent(line)}`, {
          signal: requestController?.signal,
        });
        if (!active(run)) return false;
        if (!response?.ok) { roomAvailable = "none"; return false; }
        const blob = await response.blob();
        if (!active(run)) return false;
        audioUrl = view.URL?.createObjectURL?.(blob) ?? null;
        if (!audioUrl) { roomAvailable = "none"; return false; }
        cache.set(line, audioUrl);
      } catch {
        if (run === generation) roomAvailable = "none";
        return false;
      } finally {
        if (timeout) clearTimeout(timeout);
        if (controller === requestController) controller = null;
      }
    }

    if (!active(run)) return false;
    const Sound = AudioImpl ?? speaker().Audio;
    if (typeof Sound !== "function") { roomAvailable = "none"; return false; }
    try {
      const audio = new Sound(audioUrl);
      currentAudio = audio;
      const played = await waitForAudio(audio, text, run);
      if (played) roomAvailable = "room";
      return played;
    } catch {
      roomAvailable = "none";
      return false;
    }
  }

  function fromBrowser(text, run) {
    const view = speaker();
    const synth = speechSynthesisImpl ?? view.speechSynthesis;
    const Utterance = UtteranceImpl ?? view.SpeechSynthesisUtterance;
    if (!synth || typeof Utterance !== "function") return Promise.resolve(false);

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const utterance = new Utterance(String(text ?? ""));
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (finishActive === finish) finishActive = null;
        resolve(Boolean(ok && active(run)));
      };
      finishActive = finish;
      utterance.rate = 1.03;
      utterance.pitch = 1.15;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      timer = setTimeout(() => {
        try { synth.cancel?.(); } catch { /* ignore */ }
        finish(true);
      }, durationFor(text));
      try { synth.speak(utterance); } catch { finish(false); }
    });
  }

  async function speak(line, text) {
    if (muted || !unlocked) return "silent";
    stop();
    const run = generation;
    if (await fromRoom(line, text, run)) { lastChannel = "room"; return "room"; }
    if (!active(run)) return "silent";
    if (await fromBrowser(text, run)) { lastChannel = "browser"; return "browser"; }
    if (active(run)) lastChannel = "none";
    return "silent";
  }

  function setMuted(next) {
    muted = Boolean(next);
    stop();
    persist();
    return muted;
  }

  function destroy() {
    stop();
    const revoke = speaker().URL?.revokeObjectURL?.bind(speaker().URL);
    if (revoke) for (const url of cache.values()) try { revoke(url); } catch { /* ignore */ }
    cache.clear();
  }

  return {
    speak, stop, unlock, setMuted, destroy,
    get muted() { return muted; },
    get unlocked() { return unlocked; },
    get channel() { return lastChannel; },
    get roomAvailable() { return roomAvailable; },
  };
}
