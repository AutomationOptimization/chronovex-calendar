/**
 * BRAID relay — room logic, with no runtime dependencies.
 *
 * The Durable Object is a thin shell around these functions: it owns storage
 * and sockets, this owns the rules. Keeping them apart means the rules can be
 * unit tested on plain Node without a Cloudflare runtime.
 *
 * The room is authoritative for the fabric. Every client sends its own view,
 * the room merges it with the stored one using exactly the same rules the
 * clients use among themselves, persists the result, and broadcasts it back.
 * Convergence therefore does not depend on who was online when.
 */

import { mergeFabric } from "../braid/fabric-sync.js";

export const EMPTY_ROOM = { files: {}, threads: [], tombstones: [], baseVersion: 0, updatedAt: 0, seeded: false };

/** Messages the room stores and rebroadcasts, versus ones it just relays. */
const EPHEMERAL = new Set(["caret", "ghost", "huddle", "signal", "hello", "bye"]);

export function isEphemeral(type) {
  return EPHEMERAL.has(type);
}

/**
 * Fold an incoming message into the room.
 *
 * @returns {{room: object, broadcast: object|null, reply: object|null, to: string|null, changed: boolean}}
 */
export function applyMessage(room, message, { now = 0 } = {}) {
  const current = { ...EMPTY_ROOM, ...room };

  if (!message || typeof message.type !== "string") {
    return { room: current, broadcast: null, reply: null, to: null, changed: false };
  }

  // Directed messages (WebRTC offers and answers) go to one peer, untouched.
  if (message.type === "signal") {
    return { room: current, broadcast: null, reply: null, to: message.to ?? null, relay: message, changed: false };
  }

  if (isEphemeral(message.type)) {
    return { room: current, broadcast: message, reply: null, to: null, changed: false };
  }

  if (message.type !== "state" || !message.payload) {
    return { room: current, broadcast: null, reply: null, to: null, changed: false };
  }

  // The first client into an empty room seeds it; after that the room decides.
  const merged = mergeFabric(
    { files: current.files, threads: current.threads, tombstones: current.tombstones, baseVersion: current.baseVersion },
    message.payload,
  );

  const next = {
    files: merged.files,
    threads: merged.threads,
    tombstones: merged.tombstones,
    baseVersion: merged.baseVersion,
    updatedAt: merged.changed || !current.seeded ? now : current.updatedAt,
    seeded: true,
  };

  const changed = merged.changed || !current.seeded;
  return {
    room: next,
    changed,
    to: null,
    reply: null,
    // Everyone, including the sender, receives the authoritative result.
    broadcast: changed ? { type: "state", from: "room", who: { name: "the room" }, payload: snapshotOf(next) } : null,
  };
}

/** The payload handed to a client the moment it connects. */
export function snapshotOf(room) {
  const current = { ...EMPTY_ROOM, ...room };
  return {
    files: current.files,
    threads: current.threads,
    tombstones: current.tombstones,
    baseVersion: current.baseVersion,
    updatedAt: current.updatedAt,
  };
}

/** Roster broadcast whenever someone joins or leaves. */
export function rosterOf(members) {
  return { type: "roster", from: "room", payload: { minds: [...members] } };
}

/** Rooms nobody has touched in a long time are not worth storing forever. */
export function isStale(room, now, ttlMs = 1000 * 60 * 60 * 24 * 30) {
  return Boolean(room?.updatedAt) && now - room.updatedAt > ttlMs;
}
