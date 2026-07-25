# Chronovex

**Time, made alive.** Chronovex is a dependency-free, adaptive calendar designed as a GitHub Pages artifact. It includes real calendar views, event editing, flexible scheduling, deterministic Reflow suggestions, natural-language quick creation, search, themes, density controls, offline support, and local persistence.

## BRAID — `/braid/`

The same Pages site also hosts **BRAID**, a branchless code collaboration platform: many people shape one live file instead of forking it.

- **Intent layers instead of branches.** Your edits hover above the shared file as your own attributed layer. Toggle any layer and the document re-weaves under you.
- **Collisions, not conflicts.** Two minds reshaping the same line is surfaced live and blocks convergence — both intents are held, neither is overwritten.
- **Atomic convergence.** Every compatible layer seals into one shared state at once, or nothing lands.
- **Real multi-party collaboration.** Tabs find each other automatically over `BroadcastChannel`. For people on other machines, deploy the room in [`relay/`](relay/README.md) — one command — and the session URL becomes the invitation. The room also stores the fabric, so a session outlives every browser that was in it. Huddle voice is negotiated through the room but travels peer-to-peer.
- **A continuum you can scrub.** Every action snapshots the fabric, so rewinding shows the document as it actually was.

Merge rules live in `braid/fabric-sync.js` (grow-only operation set keyed per mind, tombstones for removals, versioned sealed text) and the weave/convergence model in `braid/fabric-core.js` — both DOM-free and unit tested. The Worker runs the *same* merge function the browsers do, so the room and its clients cannot disagree.

```bash
npm run relay:deploy
```

`node scripts/bundle-braid.mjs out.html` inlines BRAID into a single self-contained file.

## Run locally

```bash
npm run dev
```

Open <http://127.0.0.1:4173>.

## Verify the artifact

```bash
npm run check
npm run preview
```

`npm run check` runs the calendar-core tests and builds the exact static artifact into `_site/`.

The ready-to-upload bundle is also available as `chronovex-github-pages.zip`.

## Publish with GitHub Pages

1. Push this folder to a GitHub repository with `main` as the default branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Run **Deploy Chronovex to GitHub Pages** from the Actions tab, or push to `main`.

All app data stays in the browser via `localStorage`. No API keys, backend, or build dependencies are required.
