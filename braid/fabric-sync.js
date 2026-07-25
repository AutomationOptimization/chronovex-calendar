/**
 * BRAID sync — one message bus over three transports.
 *
 *   • BroadcastChannel — other tabs of this page in the same browser. Free,
 *     instant, always on.
 *   • Relay room — a Cloudflare Durable Object that holds the fabric
 *     permanently and connects people on different networks. Optional: without
 *     it the app is simply local.
 *   • WebRTC — carries huddle voice directly between people. When a relay is
 *     configured it pairs automatically; without one, two devices can still
 *     pair by exchanging a code each way.
 *
 * The merge rules live in `mergeFabric` below and are transport-agnostic:
 * operations form a grow-only set keyed by id, removals are tombstones, and the
 * sealed base text is versioned. Two people editing different lines both land;
 * two people editing the same line stay visible as a collision, which is the
 * whole point of the product.
 */

import { createRelay } from "./fabric-relay.js";

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
  const localVersion = local.baseVersion ?? 0;
  const remoteVersion = remote.baseVersion ?? 0;
  const localTombstones = new Set(local.tombstones ?? []);
  const tombstones = new Set([...localTombstones, ...(remote.tombstones ?? [])]);
  const files = {};
  // Causal metadata is state too. A tombstone can arrive before the operation
  // it removes, and a newer seal can carry byte-identical text. Both still
  // have to be persisted and relayed or stale peers can resurrect old work.
  let changed = tombstones.size !== localTombstones.size || remoteVersion > localVersion;
  const fingerprint = (list) => (list ?? []).map((op) => `${op.id}:${op.rev ?? 0}`).sort().join("|");

  const names = new Set([...Object.keys(local.files ?? {}), ...Object.keys(remote.files ?? {})]);
  for (const name of names) {
    const mine = local.files?.[name];
    const theirs = remote.files?.[name];
    if (!mine) changed = true;

    // The sealed text only moves forward, and only on a newer convergence.
    const takeTheirBase = !mine || Boolean(theirs && remoteVersion > localVersion);
    const base = takeTheirBase ? theirs.base : mine.base;
    if (mine && takeTheirBase && JSON.stringify(base) !== JSON.stringify(mine.base)) changed = true;

    const ops = new Map();
    // Run even one-sided files through the removal set. Copying them directly
    // would let a stale peer revive an operation that was already tombstoned.
    for (const op of [...(mine?.ops ?? []), ...(theirs?.ops ?? [])]) {
      if (!op?.id || tombstones.has(op.id)) continue;
      const existing = ops.get(op.id);
      // Same op edited by its own author twice: keep the later revision.
      if (!existing || (op.rev ?? 0) > (existing.rev ?? 0)) ops.set(op.id, op);
    }
    const merged = [...ops.values()].sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)));
    // Compare identities and revisions, not counts: a swap of one op for
    // another would leave the count identical while changing the document.
    if (mine && fingerprint(merged) !== fingerprint(mine.ops)) changed = true;
    files[name] = { ...(mine ?? theirs), base, ops: merged };
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
  const threadPrint = (list) => list.map((thread) => `${thread.id}:${thread.replies?.length ?? 0}:${thread.aligned ?? 0}:${thread.resolved ? 1 : 0}`).sort().join("|");
  if (threadPrint([...threads.values()]) !== threadPrint(local.threads ?? [])) changed = true;

  return {
    files,
    threads: [...threads.values()],
    tombstones: [...tombstones],
    baseVersion: Math.max(localVersion, remoteVersion),
    changed,
  };
}


const VOICE_TIMEOUT = 20000;

/**
 * Open the message bus. `onMessage(message)` receives every remote message;
 * `onPeers(peers)` fires whenever the roster changes; `onStatus(status)`
 * reports the relay connection.
 */
export function createSync({ room = "helix", identity, connectionId, relay, onMessage, onPeers, onStatus, onStream } = {}) {
  const peers = new Map();
  const channels = [];
  const voices = new Map();          // peer id -> { connection, sender }
  let channel = null;
  let relayClient = null;
  let micTrack = null;
  let manual = null;                 // the code-exchange connection, when there is no relay
  // Author identity survives reloads for attribution; transport identity is
  // per tab so two tabs sharing localStorage do not discard each other as self.
  const nonceScope = typeof window !== "undefined" ? window : globalThis;
  const nonce = nonceScope.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 12);
  const selfId = connectionId ?? `${identity.id}:${nonce}`;

  const emitPeers = () => onPeers?.([...peers.values()]);

  function note(id, patch, via) {
    const known = peers.get(id);
    const authorId = patch.authorId ?? patch.id ?? known?.authorId ?? null;
    peers.set(id, { ...(known ?? {}), ...patch, authorId, id, seen: Date.now(), via: via ?? known?.via ?? "tab" });
    if (!known) emitPeers();
  }

  function receive(message) {
    if (!message || message.from === selfId) return;

    if (message.type === "bye") { dropPeer(message.from); return; }

    if (message.type === "roster") {
      const minds = (message.payload?.minds ?? []).filter((id) => id !== selfId);
      for (const id of minds) note(id, peers.get(id) ?? { name: "Mind", initials: "??" }, "room");
      for (const id of [...peers.keys()]) {
        if (peers.get(id)?.via === "room" && !minds.includes(id)) peers.delete(id);
      }
      emitPeers();
      // Everyone re-announces so names and colours fill in.
      send("hello");
      return;
    }

    if (message.type === "signal") { handleSignal(message); return; }

    if (message.from && message.from !== "room") note(message.from, message.who ?? {}, message.via);
    // A snapshot is the stored fabric; it merges exactly like a peer's state.
    onMessage?.(message.type === "snapshot" ? { ...message, type: "state" } : message);
  }

  function dropPeer(id) {
    peers.delete(id);
    const voice = voices.get(id);
    if (voice) { try { voice.connection.close(); } catch { /* ignore */ } voices.delete(id); }
    emitPeers();
  }

  /* ------------------------------- transports ------------------------------ */

  try {
    const scope = typeof window !== "undefined" ? window : null;
    if (scope && typeof scope.BroadcastChannel === "function") {
      channel = new scope.BroadcastChannel(`braid-${room}`);
      channel.onmessage = (event) => receive(event.data);
      channels.push({ post: (data) => channel.postMessage(data) });
    }
  } catch {
    // Some sandboxes refuse the channel outright; the page still works alone.
  }

  if (relay?.url && relay?.room) {
    relayClient = createRelay({
      url: relay.url,
      room: relay.room,
      identity,
      mind: selfId,
      onMessage: (message) => receive({ ...message, via: "room" }),
      onStatus,
    });
    channels.push({ post: (data) => relayClient.send(data) });
  } else {
    onStatus?.("offline");
  }

  function send(type, payload, extra = {}) {
    const message = { type, payload, from: selfId, who: identity, at: Date.now(), ...extra };
    for (const transport of channels) {
      try { transport.post(message); } catch { /* a closed transport is not fatal */ }
    }
  }

  const sweep = setInterval(() => {
    let dropped = false;
    for (const [id, peer] of peers) {
      if (peer.via !== "room" && Date.now() - peer.seen > PEER_TIMEOUT) { peers.delete(id); dropped = true; }
    }
    if (dropped) emitPeers();
  }, 4000);

  /* --------------------------------- voice --------------------------------- */

  function newConnection(id) {
    const peer = new RTCPeerConnection({ iceServers: STUN });
    const sender = peer.addTransceiver("audio", { direction: "sendrecv" }).sender;
    if (micTrack) sender.replaceTrack(micTrack).catch(() => {});
    peer.ontrack = (event) => onStream?.(event.streams[0] ?? new MediaStream([event.track]), id);
    peer.onicecandidate = (event) => {
      if (event.candidate) send("signal", { kind: "ice", candidate: event.candidate.toJSON() }, { to: id });
    };
    peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(peer.connectionState)) voices.delete(id);
    };
    const entry = { connection: peer, sender };
    voices.set(id, entry);
    return entry;
  }

  /** Open voice to a peer. The lexicographically lower id makes the offer. */
  async function callPeer(id) {
    if (typeof RTCPeerConnection !== "function" || voices.has(id)) return;
    if (selfId > id) return;                            // they will call us instead
    const { connection } = newConnection(id);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    send("signal", { kind: "offer", sdp: connection.localDescription }, { to: id });
  }

  async function handleSignal(message) {
    if (typeof RTCPeerConnection !== "function") return;
    const id = message.from;
    const payload = message.payload ?? {};
    try {
      if (payload.kind === "offer") {
        const entry = voices.get(id) ?? newConnection(id);
        await entry.connection.setRemoteDescription(payload.sdp);
        const answer = await entry.connection.createAnswer();
        await entry.connection.setLocalDescription(answer);
        send("signal", { kind: "answer", sdp: entry.connection.localDescription }, { to: id });
      } else if (payload.kind === "answer") {
        await voices.get(id)?.connection.setRemoteDescription(payload.sdp);
      } else if (payload.kind === "ice") {
        await voices.get(id)?.connection.addIceCandidate(payload.candidate);
      }
    } catch { /* a failed handshake just means no voice with that peer */ }
  }

  /** Put the live microphone on every voice connection, opening them if needed. */
  async function attachMic(track) {
    micTrack = track ?? null;
    if (track) await Promise.all([...peers.keys()].map((id) => callPeer(id).catch(() => {})));
    await Promise.all([...voices.values()].map((voice) => voice.sender.replaceTrack(track ?? null).catch(() => {})));
    if (manual?.sender) await manual.sender.replaceTrack(track ?? null).catch(() => {});
    return voices.size > 0 || Boolean(manual);
  }

  /* ------------- manual pairing, for when no relay is configured ------------ */

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

  function manualConnection() {
    const peer = new RTCPeerConnection({ iceServers: STUN });
    const sender = peer.addTransceiver("audio", { direction: "sendrecv" }).sender;
    if (micTrack) sender.replaceTrack(micTrack).catch(() => {});
    peer.ontrack = (event) => onStream?.(event.streams[0] ?? new MediaStream([event.track]), "device");
    manual = { connection: peer, sender };
    return peer;
  }

  function wireManualChannel(next) {
    next.onmessage = (event) => {
      try { receive({ ...JSON.parse(event.data), via: "device" }); } catch { /* ignore */ }
    };
    next.onopen = () => {
      channels.push({ post: (data) => next.readyState === "open" && next.send(JSON.stringify(data)) });
      onMessage?.({ type: "device-connected", from: "local", payload: null });
      send("hello");
    };
  }

  async function createOffer() {
    if (typeof RTCPeerConnection !== "function") throw new Error("This browser cannot open a direct connection.");
    const peer = manualConnection();
    wireManualChannel(peer.createDataChannel("braid"));
    await peer.setLocalDescription(await peer.createOffer());
    await gathered(peer);
    return encode(peer.localDescription);
  }

  async function acceptOffer(code) {
    if (typeof RTCPeerConnection !== "function") throw new Error("This browser cannot open a direct connection.");
    const peer = manualConnection();
    peer.ondatachannel = (event) => wireManualChannel(event.channel);
    await peer.setRemoteDescription(decode(code));
    await peer.setLocalDescription(await peer.createAnswer());
    await gathered(peer);
    return encode(peer.localDescription);
  }

  async function acceptAnswer(code) {
    if (!manual) throw new Error("Create an invite code first.");
    await manual.connection.setRemoteDescription(decode(code));
  }

  function close() {
    clearInterval(sweep);
    try { send("bye"); } catch { /* ignore */ }
    channel?.close();
    relayClient?.close();
    for (const voice of voices.values()) { try { voice.connection.close(); } catch { /* ignore */ } }
    voices.clear();
    try { manual?.connection.close(); } catch { /* ignore */ }
    manual = null;
    peers.clear();
  }

  return {
    send,
    close,
    peers,
    sweep,
    attachMic,
    callPeer,
    createOffer,
    acceptOffer,
    acceptAnswer,
    get voiceReady() { return typeof RTCPeerConnection === "function"; },
    get relayStatus() { return relayClient?.status ?? "offline"; },
    get connected() { return peers.size; },
  };
}
