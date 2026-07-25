/**
 * Everything Opti can say, as a fixed catalogue.
 *
 * Browser speech reads these strings locally. An optional voice service may
 * accept only a line id from this catalogue, so arbitrary public text never
 * becomes a synthesis endpoint. The shipped collaboration relay does not
 * receive Opti's prose or hold a voice-provider key.
 */

export const OPTI_LINES = {
  /* greeting and housekeeping */
  hello: { text: "Hello. I'm Opti. This place doesn't work like the tools you know — want me to show you?", mood: "wave" },
  "hello-again": { text: "Back again. Pick up where we left off?", mood: "happy" },
  bye: { text: "I'll be down here if you need me.", mood: "sleep" },
  muted: { text: "Quiet from now on.", mood: "neutral" },
  nothing: { text: "Nothing to explain right now. That's a good sign.", mood: "neutral" },

  /* the walkthrough */
  "step-shape": { text: "Click any line of code, then click it again to type into it. Go ahead, I'll wait.", mood: "point" },
  "step-layer": { text: "Look at that. Your edit didn't overwrite the file — it became your own layer, floating above the same lines everyone else is reading.", mood: "happy" },
  "step-lift": { text: "Now click one of the other layers on the right. Watch the document rearrange itself as that intention leaves.", mood: "point" },
  "step-collide": { text: "Here's the interesting part. Edit the line I've ringed — someone else already rewrote that one.", mood: "curious" },
  "step-resolve": { text: "Two intentions, one line. Nothing was lost, and nothing can be sealed until a person decides. Lift a layer, or press command Z.", mood: "alarmed" },
  "step-converge": { text: "Now converge. Every compatible layer folds into one shared state at once — or nothing lands at all.", mood: "point" },
  "step-continuum": { text: "Click a moment on the timeline at the bottom. The whole document reassembles as it actually was.", mood: "curious" },
  "step-room": { text: "Last thing. This session is a room, and its link is the invitation. Whoever opens it lands right here, beside you.", mood: "wave" },
  "tour-done": { text: "That's the whole model. Branchless, layered, sealed all at once. You're set.", mood: "proud" },

  /* things that happen on their own */
  "tip-first-collision": { text: "Two layers just landed on the same line. Both are kept — the fabric refuses to guess which one you meant.", mood: "alarmed" },
  "tip-converge-ready": { text: "Everything in flight is compatible now. One convergence takes all of it.", mood: "happy" },
  "tip-peer-joined": { text: "Someone just joined your room. You're both shaping the same file from here on.", mood: "wave" },
  "tip-past-is-read-only": { text: "You're standing in the past. It's read-only — go back to the live edge to change anything.", mood: "curious" },
  "tip-mic-blocked": { text: "Your browser wouldn't give me the microphone. You can still sit in the huddle and watch who's talking.", mood: "sad" },
  "tip-future-open": { text: "That future is yours alone. Break it however you like — the room won't feel a thing until you collapse it back.", mood: "curious" },

  /* answers */
  "ask-layers": { text: "An intent layer is your edits, kept separate but shown in place. Everyone's layers sit on the same document at once, so you're never reading a copy.", mood: "explain" },
  "ask-branches": { text: "There are none. Nothing is copied, so nothing has to be reconciled later. Disagreement shows up immediately, as a collision.", mood: "explain" },
  "ask-collision": { text: "Two layers rewriting one line. Both are held and shown, and convergence stays blocked until a person resolves it.", mood: "alarmed" },
  "ask-converge": { text: "Converging fuses every compatible layer into the shared state in one move. It's all or nothing — there's no half-merged state to recover from.", mood: "explain" },
  "ask-room": { text: "Your session lives in a room on your own server. It holds the woven state, so the work outlives every browser that was in it.", mood: "explain" },
  "ask-huddle": { text: "The huddle opens your real microphone. Voice goes straight between browsers — it never touches the server.", mood: "explain" },
  "ask-continuum": { text: "The timeline at the bottom is every moment of this session. Click one and the document reassembles as it was then.", mood: "explain" },
  "ask-threads": { text: "A thread is anchored to a symbol, not a line number, so the conversation follows the code as the code moves.", mood: "explain" },
  "ask-futures": { text: "A future is a private copy of the open file. Experiment freely, then collapse the one that wins back in as a layer.", mood: "explain" },
  "ask-who": { text: "I'm Opti. I live in this fabric and I explain it. I never touch your code — everything you see is something you did.", mood: "proud" },
  "ask-unknown": { text: "I don't know that one. Try asking about layers, collisions, converging, the room, the huddle, futures, or the timeline.", mood: "sad" },
};

/** Questions Opti can answer, matched loosely against what the user typed. */
export const OPTI_TOPICS = [
  { line: "ask-layers", keys: ["layer", "intent", "attribut", "colour", "color"] },
  { line: "ask-branches", keys: ["branch", "fork", "pull request", "pr", "merge", "git"] },
  { line: "ask-collision", keys: ["collision", "collide", "conflict", "clash", "same line"] },
  { line: "ask-converge", keys: ["converge", "seal", "commit", "land", "atomic"] },
  { line: "ask-room", keys: ["room", "share", "invite", "link", "persist", "save", "server", "relay"] },
  { line: "ask-huddle", keys: ["huddle", "voice", "talk", "mic", "audio", "call"] },
  { line: "ask-continuum", keys: ["continuum", "timeline", "history", "rewind", "past", "replay", "undo history"] },
  { line: "ask-threads", keys: ["thread", "comment", "discuss", "review", "conversation"] },
  { line: "ask-futures", keys: ["future", "experiment", "try", "branch off", "sandbox", "alternative"] },
  { line: "ask-who", keys: ["who are you", "what are you", "your name", "opti", "clippy", "help me"] },
];

/** Pick the line that best answers a typed question. */
export function answerFor(question) {
  const asked = String(question ?? "").toLowerCase().trim();
  if (!asked) return "ask-unknown";
  let best = null;
  let bestScore = 0;
  for (const topic of OPTI_TOPICS) {
    let score = 0;
    for (const key of topic.keys) if (asked.includes(key)) score += key.length;
    if (score > bestScore) { bestScore = score; best = topic.line; }
  }
  return best ?? "ask-unknown";
}

export const lineText = (id) => OPTI_LINES[id]?.text ?? "";
export const lineMood = (id) => OPTI_LINES[id]?.mood ?? "neutral";
