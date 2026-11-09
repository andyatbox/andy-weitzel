/**
 * The sizzle reel, as one id.
 *
 * Two surfaces play it and they must never drift apart: the landing gate's
 * shape-and-sky (`IntroCube`), where it is bent through WebGL, and the "My
 * Reel" overlay (`ReelOverlay`), where it is shown flat. It lives here rather
 * than in either of them so neither has to import the other — the overlay
 * would otherwise pull the whole R3F module graph in behind a constant.
 *
 * Replacing a Gumlet asset in place regenerates only its DASH output and
 * leaves the HLS ladder on the old video — upload a new asset and swap the id
 * here instead (see CLAUDE.md).
 */
export const REEL_EMBED = "https://play.gumlet.io/embed/6ac0ee1dd6a6ba7c2cbf0b19";
