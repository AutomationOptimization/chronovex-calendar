/**
 * Where BRAID's room lives.
 *
 * Empty means "no room": the app runs locally and syncs between tabs only.
 * After deploying relay/ (see relay/README.md) put your Worker's URL here —
 * e.g. "https://braid-relay.yourname.workers.dev" — and every visitor to the
 * page joins the same persistent fabric.
 *
 * It can also be set per visit with ?relay=... , or from the Invite dialog,
 * which remembers it in this browser.
 */
export const DEFAULT_RELAY = "";
