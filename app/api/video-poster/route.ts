import { NextRequest, NextResponse } from "next/server";

// Resolves a player embed src to the media it exposes: a poster image, and
// for Gumlet an HLS manifest the gallery can pull into a WebGL VideoTexture.
// Needed server-side: both live under
// video.gumlet.io/{collectionId}/{assetId}/, and the collection id only
// appears in the embed page HTML, which browsers can't fetch cross-origin.
// (The media itself is served with Access-Control-Allow-Origin: *, so the
// video can be textured without tainting the canvas.) Vimeo exposes only a
// poster, via its public oEmbed endpoint — it publishes no usable stream.
export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("src") ?? "";
  const vimeoId = src.match(/player\.vimeo\.com\/video\/(\d+)/)?.[1];
  const gumletId = src.match(/play\.gumlet\.io\/embed\/([\w-]+)/)?.[1];
  const headers = { "Cache-Control": "public, s-maxage=86400, max-age=3600" };

  try {
    if (vimeoId) {
      const r = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
          `https://vimeo.com/${vimeoId}`
        )}`,
        { next: { revalidate: 86400 } }
      );
      const data = (await r.json()) as { thumbnail_url?: string };
      return NextResponse.json(
        { poster: data.thumbnail_url ?? null, hls: null },
        { headers }
      );
    }
    if (gumletId) {
      // Short revalidate: this HTML is Gumlet's live page, and its embedded
      // ?v=<timestamp> is how a re-uploaded poster busts the CDN cache. A
      // long-lived cache here would keep serving a pre-upload snapshot for
      // hours after the asset actually changed.
      const r = await fetch(`https://play.gumlet.io/embed/${gumletId}`, {
        next: { revalidate: 300 },
      });
      const html = await r.text();
      // The og:image meta tag is the single canonical poster URL (matches
      // twitter:image, JSON-LD thumbnailUrl, and the player's slot="poster").
      // The <img slot="poster"> element also lists a responsive srcSet with
      // several sizes — don't match against that, or a random small variant
      // wins depending on ordering. HTML-entity-decode &amp; -> & so the
      // query string (which carries ?v=) parses correctly.
      const raw = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
      const poster = raw ? raw.replace(/&amp;/g, "&") : null;
      // The master playlist is linked in the same page. Gumlet publishes no
      // usable MP4 (every variant 401/403s), so HLS is the only option.
      const hls =
        html.match(
          /https:\/\/video\.gumlet\.io\/[a-f0-9]+\/[a-f0-9]+\/main\.m3u8/
        )?.[0] ?? null;
      return NextResponse.json({ poster, hls }, { headers });
    }
  } catch {
    // fall through to null
  }
  return NextResponse.json({ poster: null, hls: null }, { headers });
}
