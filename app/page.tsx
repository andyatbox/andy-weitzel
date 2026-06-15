"use client";

import dynamic from "next/dynamic";

const PortfolioApp = dynamic(() => import("@/components/PortfolioApp"), {
  ssr: false,
});

export default function Page() {
  return <PortfolioApp />;
}
