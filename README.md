# Chronovex

**Time, made alive.** Chronovex is a dependency-free, adaptive calendar designed as a GitHub Pages artifact. It includes real calendar views, event editing, flexible scheduling, deterministic Reflow suggestions, natural-language quick creation, search, themes, density controls, offline support, and local persistence.

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
