/**
 * BRAID huddle — actual microphone capture and level metering.
 *
 * The huddle is not a status flag. Joining opens your real microphone, meters
 * it continuously, and hands the track to any paired device so they hear you.
 * Everything degrades honestly: a denied or missing microphone still lets you
 * sit in the huddle, it just says so instead of pretending.
 */

const SILENCE = 0.02;

/** Browser APIs are always read off the page's window, never a host global. */
const scope = () => (typeof window !== "undefined" ? window : globalThis);

/**
 * @param {(level: number, speaking: boolean) => void} onLevel
 * @param {(state: string) => void} onState  idle | live | muted | denied | unsupported
 */
export function createHuddle({ onLevel, onState } = {}) {
  let stream = null;
  let context = null;
  let analyser = null;
  let raf = null;
  let muted = false;
  let micState = "idle";

  const setState = (next) => { micState = next; onState?.(next); };

  function meter() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const value = (sample - 128) / 128;
      sum += value * value;
    }
    const level = muted ? 0 : Math.min(1, Math.sqrt(sum / data.length) * 4);
    onLevel?.(level, level > SILENCE);
    raf = scope().requestAnimationFrame?.(meter) ?? null;
  }

  async function join() {
    const view = scope();
    const media = view.navigator?.mediaDevices ?? null;
    const Context = view.AudioContext ?? view.webkitAudioContext;
    if (!media?.getUserMedia || !Context) {
      setState("unsupported");
      return { ok: false, reason: "unsupported" };
    }
    try {
      stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch {
      setState("denied");
      return { ok: false, reason: "denied" };
    }
    try {
      context = new Context();
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      if (typeof view.requestAnimationFrame === "function") raf = view.requestAnimationFrame(meter);
      setState("live");
      return { ok: true, stream, track: stream.getAudioTracks()[0] ?? null };
    } catch {
      setState("live");   // the microphone is open even if metering is not available
      return { ok: true, stream, track: stream.getAudioTracks()[0] ?? null };
    }
  }

  function setMuted(next) {
    muted = next;
    for (const track of stream?.getAudioTracks() ?? []) track.enabled = !next;
    setState(next ? "muted" : stream ? "live" : micState);
    if (next) onLevel?.(0, false);
    return muted;
  }

  function leave() {
    if (raf) scope().cancelAnimationFrame?.(raf);
    raf = null;
    for (const track of stream?.getAudioTracks() ?? []) track.stop();
    context?.close?.();
    stream = null;
    context = null;
    analyser = null;
    muted = false;
    setState("idle");
  }

  return {
    join,
    leave,
    setMuted,
    get muted() { return muted; },
    get state() { return micState; },
    get stream() { return stream; },
    get track() { return stream?.getAudioTracks()[0] ?? null; },
  };
}
