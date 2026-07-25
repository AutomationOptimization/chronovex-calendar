# BRAID relay

The room. A Cloudflare Worker with one Durable Object per session, giving the
static Pages app the two things static hosting cannot:

- **People on different networks find each other.** The room is a WebSocket
  hub, so collaborators do not need to be on your LAN or trade codes.
- **The fabric outlives every browser.** The Durable Object stores the woven
  state. Close everything, come back next week, open the link: it is as you
  left it.

Editing flows through the room. Huddle voice is negotiated through it but
travels peer-to-peer, so audio never touches the server.

## Deploy it (about two minutes, free tier)

```bash
cd relay && npx wrangler deploy
```

The first run opens a browser to log in to Cloudflare and creates the Worker.
It prints a URL like `https://braid-relay.<your-subdomain>.workers.dev`.

Then tell the app where its room lives — either edit
[`braid/relay-config.js`](../braid/relay-config.js):

```js
export const DEFAULT_RELAY = "https://braid-relay.your-subdomain.workers.dev";
```

commit, and push (Pages redeploys automatically), **or** paste the URL into
**Invite → Change room server** in the running app, which remembers it in that
browser only.

Check it any time:

```bash
curl https://braid-relay.<your-subdomain>.workers.dev/health
```

## How a session works

A room id is generated on first visit and kept in the URL:

```
https://<you>.github.io/chronovex-calendar/braid/#room=k3f9x2m8q1
```

**That link is the invitation.** Anyone who opens it joins the same fabric,
sees the same document, and appears in the avatar stack. The id is random and
unguessable, which is also the access control: there are no accounts, so
whoever has the link is in the room. Use a fresh room for anything you would
not paste into a shared channel.

`GET /room/<id>` returns the stored fabric as JSON, which is handy for
inspecting or backing up a session.

## Why it converges

The Worker imports the same `mergeFabric` the browsers use
([`braid/fabric-sync.js`](../braid/fabric-sync.js)). Operations form a
grow-only set keyed by an id namespaced per mind, removals are tombstones, and
sealed text is versioned. So:

- two people editing different lines both land;
- two people editing the same line both survive, and everyone sees the same
  collision blocking convergence;
- a message that arrives twice, or late, or out of order changes nothing.

The room merges, persists, and broadcasts the authoritative result, so
convergence does not depend on who happened to be online.

`relay/room-core.js` holds these rules with no Cloudflare dependency, and
`tests/braid-room.test.mjs` plus `tests/braid-collaboration.test.mjs` run them
against real app instances — the collaboration tests wire two browsers to this
exact code in one process.

## Costs

Free tier: 100k Worker requests/day and SQLite-backed Durable Objects. A
WebSocket message is not a request, and hibernation means an idle room bills
nothing. Ordinary use will not leave the free tier.
