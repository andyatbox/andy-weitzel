import { NextRequest, NextResponse } from "next/server";

// Resolves a player embed src to its poster/thumbnail image URL.
// Needed server-side: Gumlet's poster lives at
// video.gumlet.io/{collectionId}/{assetId}/thumbnail-1-0.png, and the
// collection id only appears in the embed page HTML, which browsers can't
// fetch cross-origin. Vimeo posters come from its public oEmbed endpoint.
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
      return NextResponse.json({ poster: data.thumbnail_url ?? null }, { headers });
    }
    if (gumletId) {
      const r = await fetch(`https://play.gumlet.io/embed/${gumletId}`, {
        next: { revalidate: 86400 },
      });
      const html = await r.text();
      const poster =
        html.match(
          /https:\/\/video\.gumlet\.io\/[\w-]+\/[\w-]+\/thumbnail-[\w.-]+\.(?:png|jpe?g|webp)/
        )?.[0] ?? null;
      return NextResponse.json({ poster }, { headers });
    }
  } catch {
    // fall through to null
  }
  return NextResponse.json({ poster: null }, { headers });
}
