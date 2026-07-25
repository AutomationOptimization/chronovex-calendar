/**
 * BRAID relay client — the socket to your own room.
 *
 * The room is authoritative and persistent, so this transport does two jobs:
 * it carries live messages between everyone connected, and on connect it hands
 * back the stored fabric so a session can be resumed days later by someone who
 * was never there.
 *
 * It reconnects on its own with backoff, and it is always optional: with no
 * relay configured the app runs perfectly well on its own.
 */

const host = () => (typeof window !== "undefined" ? window : globalThis);

/** Where the room lives, and which room it is. Both are overridable per visit. */
export function resolveRelay({ location, storage, fallback = "" } = {}) {
  const view = host();
  const here = location ?? view.location ?? { search: "", hash: "" };
  const params = new URLSearchParams(here.search ?? "");
  const hash = new URLSearchParams(String(here.hash ?? "").replace(/^#/, ""));

  let url = params.get("relay") ?? hash.get("relay") ?? "";
  if (!url) {
    try { url = storage?.getItem("braid-relay-url") ?? ""; } catch { url = ""; }
  }
  if (!url) url = fallback;

  let room = params.get("room") ?? hash.get("room") ?? "";
  if (!room) room = "";

  return { url: url.trim().replace(/\/+$/, ""), room: room.trim() };
}

/** A room id that is also the invitation: unguessable, and shared by link. */
export function newRoomId() {
  const bytes = new Uint8Array(9);
  const view = host();
  if (view.crypto?.getRandomValues) view.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return [...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 14);
}

export function socketUrl(base, room, mind) {
  if (!base) return "";
  const url = new URL(`${base}/room/${encodeURIComponent(room)}`);
  url.protocol = url.protocol === "http:" ? "ws:" : url.protocol === "https:" ? "wss:" : url.protocol;
  url.searchParams.set("mind", mind);
  return url.toString();
}

/**
 * @param {object} options
 * @param {(message: object) => void} options.onMessage
 * @param {(status: string, detail?: object) => void} options.onStatus  offline | connecting | live | retrying
 */
export function createRelay({ url, room, identity, onMessage, onStatus, WebSocketImpl } = {}) {
  const Socket = WebSocketImpl ?? host().WebSocket;
  let socket = null;
  let attempt = 0;
  let closed = false;
  let timer = null;
  let status = "offline";

  const setStatus = (next, detail) => {
    if (status === next) return;
    status = next;
    onStatus?.(next, detail);
  };

  function connect() {
    if (closed || !url || !room || typeof Socket !== "function") { setStatus("offline"); return; }
    setStatus(attempt === 0 ? "connecting" : "retrying", { attempt });
    let next;
    try {
      next = new Socket(socketUrl(url, room, identity.id));
    } catch {
      retry();
      return;
    }
    socket = next;

    next.onopen = () => {
      attempt = 0;
      setStatus("live");
      send({ type: "hello", who: identity });
    };
    next.onmessage = (event) => {
      try {
        onMessage?.(JSON.parse(event.data));
      } catch { /* a frame we cannot read is a frame we ignore */ }
    };
    next.onclose = () => { socket = null; retry(); };
    next.onerror = () => { try { next.close(); } catch { /* ignore */ } };
  }

  function retry() {
    if (closed) { setStatus("offline"); return; }
    attempt += 1;
    const delay = Math.min(15000, 500 * 2 ** Math.min(attempt, 5));
    setStatus("retrying", { attempt, delay });
    timer = setTimeout(connect, delay);
  }

  function send(message) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify({ ...message, who: message.who ?? identity }));
      return true;
    } catch {
      return false;
    }
  }

  function close() {
    closed = true;
    clearTimeout(timer);
    try { socket?.close(); } catch { /* ignore */ }
    socket = null;
    setStatus("offline");
  }

  connect();

  return { send, close, get status() { return status; }, get connected() { return socket?.readyState === 1; } };
}
