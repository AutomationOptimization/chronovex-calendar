/**
 * BRAID sync — real multi-party collaboration with no server behind it.
 *
 * Two transports, one message bus:
 *   • BroadcastChannel — every tab or window of this page on the same browser,
 *     connected automatically, zero configuration.
 *   • WebRTC data channel — a second device, connected by exchanging one code
 *     each way. No signalling server, no backend, so it works on static hosting
 *     like GitHub Pages.
 *
 * The merge rules live in `mergeFabric` below and are transport-agnostic:
 * operations form a grow-only set keyed by id, removals are tombstones, and the
 * sealed base text is versioned. Two people editing different lines both land;
 * two people editing the same line stay visible as a collision, which is the
 * whole point of the product.
 */

const TONES = ["mint", "violet", "coral", "amber"];
const PEER_TIMEOUT = 12000;
const STUN = [{ urls: "stun:stun.l.google.com:19302" }];

/** A stable identity for this browser, so a reload rejoins as the same mind. */
export function createIdentity(storage) {
  const KEY = "braid-identity-v1";
  try {
    const saved = storage?.getItem(KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* fall through to a fresh identity */ }
  const seed = Math.random().toString(36).slice(2, 8);
  const identity = {
    id: `mind-${seed}`,
    initials: seed.slice(0, 2).toUpperCase(),
    name: `Mind ${seed.slice(0, 3).toUpperCase()}`,
    tone: TONES[Math.floor(Math.random() * TONES.length)],
  };
  try { storage?.setItem(KEY, JSON.stringify(identity)); } catch { /* ignore */ }
  return identity;
}

/**
 * Merge a remote fabric snapshot into the local one.
 * Pure and synchronous so it can be unit tested without any transport.
 *
 * @returns {{files: object, threads: Array, tombstones: string[], baseVersion: number, changed: boolean}}
 */
export function mergeFabric(local, remote) {
  const tombstones = new Set([...(local.tombstones ?? []), ...(remote.tombstones ?? [])]);
  const files = {};
  let changed = false;

  const names = new Set([...Object.keys(local.files ?? {}), ...Object.keys(remote.files ?? {})]);
  for (const name of names) {
    const mine = local.files?.[name];
    const theirs = remote.files?.[name];
    if (!mine) { files[name] = theirs; changed = true; continue; }
    if (!theirs) { files[name] = mine; continue; }

    // The sealed text only moves forward, and only on a newer convergence.
    const takeTheirBase = (remote.baseVersion ?? 0) > (local.baseVersion ?? 0);
    const base = takeTheirBase ? theirs.base : mine.base;
    if (takeTheirBase && JSON.stringify(base) !== JSON.stringify(mine.base)) changed = true;

    const ops = new Map();
    for (const op of [...mine.ops, ...theirs.ops]) {
      if (!op?.id || tombstones.has(op.id)) continue;
      const existing = ops.get(op.id);
      // Same op edited by its own author twice: keep the later revision.
      if (!existing || (op.rev ?? 0) > (existing.rev ?? 0)) ops.set(op.id, op);
    }
    const merged = [...ops.values()].sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)));
    if (merged.length !== mine.ops.length) changed = true;
    files[name] = { ...mine, base, ops: merged };
  }

  const threads = new Map();
  for (const thread of [...(local.threads ?? []), ...(remote.threads ?? [])]) {
    const existing = threads.get(thread.id);
    if (!existing) { threads.set(thread.id, thread); continue; }
    threads.set(thread.id, {
      ...existing,
      replies: thread.replies.length >= existing.replies.length ? thread.replies : existing.replies,
      aligned: Math.max(existing.aligned, thread.aligned),
      resolved: existing.resolved || thread.resolved,
    });
  }
  if (threads.size !== (local.threads ?? []).length) changed = true;

  return {
    files,
    threads: [...threads.values()],
    tombstones: [...tombstones],
    baseVersion: Math.max(local.baseVersion ?? 0, remote.baseVersion ?? 0),
    changed,
  };
}

/**
 * Open the message bus. `onMessage(message)` receives every remote message;
 * `onPeers(peers)` fires whenever the roster changes.
 */
export function createSync({ room = "helix", identity, onMessage, onPeers } = {}) {
  const peers = new Map();
  const channels = [];
  let channel = null;
  let connection = null;
  let dataChannel = null;

  const emitPeers = () => onPeers?.([...peers.values()]);

  function receive(message) {
    if (!message || message.from === identity.id) return;
    if (message.type === "bye") { peers.delete(message.from); emitPeers(); return; }
    const known = peers.get(message.from);
    peers.set(message.from, { ...(known ?? {}), ...(message.who ?? {}), id: message.from, seen: Date.now(), via: message.via ?? "tab" });
    if (!known) emitPeers();
    onMessage?.(message);
  }

  // Deliberately the page's BroadcastChannel, not a host runtime's global of the
  // same name — this bus is for browser tabs of this document only.
  const scope = typeof window !== "undefined" ? window : null;
  if (scope && typeof scope.BroadcastChannel === "function") {
    channel = new scope.BroadcastChannel(`braid-${room}`);
    channel.onmessage = (event) => receive(event.data);
    channels.push({ post: (data) => channel.postMessage(data) });
  }

  function send(type, payload) {
    const message = { type, payload, from: identity.id, who: identity, at: Date.now() };
    for (const transport of channels) {
      try { transport.post(message); } catch { /* a closed transport is not fatal */ }
    }
  }

  const sweep = setInterval(() => {
    let dropped = false;
    for (const [id, peer] of peers) {
      if (Date.now() - peer.seen > PEER_TIMEOUT) { peers.delete(id); dropped = true; }
    }
    if (dropped) emitPeers();
  }, 4000);

  /* ---------------- WebRTC: a second device, no signalling server ---------------- */

  function wireChannel(next) {
    dataChannel = next;
    next.onmessage = (event) => {
      try { receive({ ...JSON.parse(event.data), via: "device" }); } catch { /* ignore malformed frames */ }
    };
    next.onopen = () => {
      channels.push({ post: (data) => next.readyState === "open" && next.send(JSON.stringify(data)) });
      onMessage?.({ type: "device-connected", from: "local", payload: null });
    };
    next.onclose = () => { dataChannel = null; };
  }

  /** Wait for ICE to settle so the code we hand over is complete. */
  function gathered(peer) {
    return new Promise((resolve) => {
      if (peer.iceGatheringState === "complete") { resolve(); return; }
      const check = () => {
        if (peer.iceGatheringState === "complete") { peer.removeEventListener("icegatheringstatechange", check); resolve(); }
      };
      peer.addEventListener("icegatheringstatechange", check);
      setTimeout(resolve, 2500);
    });
  }

  const encode = (value) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  const decode = (value) => JSON.parse(decodeURIComponent(escape(atob(value.trim()))));

  async function createOffer() {
    if (typeof RTCPeerConnection !== "function") throw new Error("This browser cannot open a direct connection.");
    connection = new RTCPeerConnection({ iceServers: STUN });
    wireChannel(connection.createDataChannel("braid"));
    await connection.setLocalDescription(await connection.createOffer());
    await gathered(connection);
    return encode(connection.localDescription);
  }

  async function acceptOffer(code) {
    if (typeof RTCPeerConnection !== "function") throw new Error("This browser cannot open a direct connection.");
    connection = new RTCPeerConnection({ iceServers: STUN });
    connection.ondatachannel = (event) => wireChannel(event.channel);
    await connection.setRemoteDescription(decode(code));
    await connection.setLocalDescription(await connection.createAnswer());
    await gathered(connection);
    return encode(connection.localDescription);
  }

  async function acceptAnswer(code) {
    if (!connection) throw new Error("Create an invite code first.");
    await connection.setRemoteDescription(decode(code));
  }

  function close() {
    clearInterval(sweep);
    try { send("bye"); } catch { /* ignore */ }
    channel?.close();
    dataChannel?.close();
    connection?.close();
    peers.clear();
  }

  return { send, close, peers, sweep, createOffer, acceptOffer, acceptAnswer, get connected() { return peers.size; } };
}
