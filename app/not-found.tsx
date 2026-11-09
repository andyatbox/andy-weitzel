import { LABELS, PORTFOLIO_IDS } from "@/lib/portfolioMeta";
import { PORTFOLIO_PATH } from "@/lib/routes";

/**
 * Anything that isn't a page here. Plain HTML on the site's own black, with
 * the way back out — the app itself is a WebGL scene that takes a moment to
 * arrive, and a wrong address shouldn't start it up just to say no.
 *
 * Links are ordinary anchors: from here the app has to load anyway, so there
 * is nothing to preserve by routing it in the client.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-8 bg-[#070707] px-6 text-center text-white">
      <p className="text-sm uppercase tracking-[0.3em] text-white/40">404</p>
      <h1 className="max-w-xl text-3xl font-medium leading-tight tracking-tight sm:text-5xl">
        There’s nothing at this address.
      </h1>
      <nav className="flex flex-wrap items-center justify-center gap-3">
        <a
          href="/"
          className="inline-flex items-center rounded-full border-2 border-white px-5 py-2 font-medium text-white transition-colors hover:bg-white hover:text-black"
        >
          Start over
        </a>
        {PORTFOLIO_IDS.map((id) => (
          <a
            key={id}
            href={`/${PORTFOLIO_PATH[id]}`}
            className="inline-flex items-center rounded-full border border-white px-5 py-2 font-medium text-white transition-colors hover:bg-white hover:text-black"
          >
            {LABELS[id]}
          </a>
        ))}
      </nav>
    </main>
  );
}
