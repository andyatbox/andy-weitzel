// Turns a pasted Vimeo/Gumlet URL or full embed code into a player iframe src.
// Mirrors box-creative's src/sanity/videoEmbed.js.
export function getVideoEmbedSrc(input?: string): string | null {
  if (!input) return null;
  const vimeoId = input.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
  if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
  const gumletId = input.match(/gumlet\.io\/embed\/([\w-]+)/)?.[1];
  if (gumletId) return `https://play.gumlet.io/embed/${gumletId}`;
  return null;
}

// --- end-of-playback detection (cross-origin, via postMessage) --------------
// Both players speak JSON over postMessage: Vimeo its own protocol, Gumlet
// the player.js protocol. We subscribe to the "ended" event and watch window
// "message" events for it.

/** Ask a loaded player iframe to emit its end-of-playback event. */
export function subscribeVideoEnded(win: Window, src: string) {
  if (src.includes("vimeo")) {
    // Older embeds emit "finish", newer "ended" — subscribe to both.
    win.postMessage(JSON.stringify({ method: "addEventListener", value: "finish" }), "*");
    win.postMessage(JSON.stringify({ method: "addEventListener", value: "ended" }), "*");
  } else {
    win.postMessage(
      JSON.stringify({
        context: "player.js",
        version: "0.0.11",
        method: "addEventListener",
        value: "ended",
      }),
      "*"
    );
  }
}

function parseMessage(data: unknown): { event?: string } | null {
  let d = data;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  return d && typeof d === "object" ? (d as { event?: string }) : null;
}

/** True if a window "message" signals the player is ready (either provider). */
export function isVideoReadyMessage(data: unknown): boolean {
  return parseMessage(data)?.event === "ready";
}

/** True if a window "message" signals playback finished (either provider). */
export function isVideoEndedMessage(data: unknown): boolean {
  const evt = parseMessage(data)?.event;
  return evt === "ended" || evt === "finish";
}
