"use client";

import { useEffect, useState } from "react";

/**
 * The masthead knows whether it is over the sky or over the paper.
 *
 * White text on the twilight plate and ink on parchment are both correct; the
 * only wrong answer is picking one and keeping it through the handover.
 */
export default function Chrome() {
  const [over, setOver] = useState(true);

  useEffect(() => {
    const onScroll = () => setOver(window.scrollY < window.innerHeight * 0.72);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="top" data-over={over} data-solid={!over}>
      <a className="brand" href="/">
        <img src="/art/yuzu-mark.svg" alt="" width={30} height={30} />
        <b>Yuzu</b>
      </a>
      <div className="spacer" />
      <a className="top-link hide-sm" href="#market">
        The market
      </a>
      <a className="top-link hide-sm" href="/api/manifest">
        Manifest
      </a>
      <a className="btn btn-solid" href="#market" style={{ padding: "0.45rem 0.9rem", fontSize: "0.84rem" }}>
        Plant a goal
      </a>
    </header>
  );
}
