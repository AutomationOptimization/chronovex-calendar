/**
 * BRAID relay — a Cloudflare Worker that gives the static Pages app the two
 * things static hosting cannot: a place for people on different networks to
 * find each other, and a fabric that outlives every browser tab.
 *
 * One Durable Object per room. It holds the authoritative fabric in storage,
 * merges what each client sends, and relays presence and WebRTC handshakes.
 * Code never sits anywhere else — the room *is* the file.
 */

import { applyMessage, rosterOf, snapshotOf } from "./room-core.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "braid-relay" }, { headers: CORS });
    }

    const match = url.pathname.match(/^\/room\/([\w-]{1,64})$/);
    if (!match) return new Response("Not found", { status: 404, headers: CORS });

    const id = env.BRAID_ROOM.idFromName(match[1]);
    return env.BRAID_ROOM.get(id).fetch(request);
  },
};

export class BraidRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
  }

  async load() {
    if (!this.room) this.room = (await this.state.storage.get("room")) ?? null;
    return this.room ?? {};
  }

  async save(room) {
    this.room = room;
    await this.state.storage.put("room", room);
  }

  members() {
    return this.state.getWebSockets()
      .map((socket) => this.state.getTags(socket)[0])
      .filter(Boolean);
  }

  broadcast(message, { except } = {}) {
    const body = JSON.stringify(message);
    for (const socket of this.state.getWebSockets()) {
      if (except && this.state.getTags(socket)[0] === except) continue;
      try { socket.send(body); } catch { /* the socket is going away anyway */ }
    }
  }

  sendTo(id, message) {
    const body = JSON.stringify(message);
    for (const socket of this.state.getWebSockets(id)) {
      try { socket.send(body); } catch { /* ignore */ }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    // A plain GET is a readable, shareable view of the stored fabric.
    if (request.headers.get("Upgrade") !== "websocket") {
      const room = await this.load();
      return Response.json({ room: snapshotOf(room), minds: this.members().length }, { headers: CORS });
    }

    const mind = url.searchParams.get("mind") || `mind-${crypto.randomUUID().slice(0, 6)}`;
    const pair = new WebSocketPair();
    // Hibernation: the object can sleep between messages without dropping anyone.
    this.state.acceptWebSocket(pair[1], [mind]);

    const room = await this.load();
    pair[1].send(JSON.stringify({ type: "snapshot", from: "room", payload: snapshotOf(room) }));
    this.broadcast(rosterOf(this.members()));

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(socket, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const from = this.state.getTags(socket)[0];
    message.from = from;                       // never trust a client's claim about who it is

    const room = await this.load();
    const result = applyMessage(room, message, { now: Date.now() });

    if (result.relay && result.to) {
      this.sendTo(result.to, result.relay);
      return;
    }
    if (result.changed) await this.save(result.room);
    if (result.broadcast) {
      const ephemeral = result.broadcast.type !== "state";
      this.broadcast(result.broadcast, ephemeral ? { except: from } : undefined);
    }
  }

  async webSocketClose(socket) {
    const from = this.state.getTags(socket)[0];
    this.broadcast({ type: "bye", from });
    this.broadcast(rosterOf(this.members().filter((id) => id !== from)));
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }
}
