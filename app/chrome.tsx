"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "day" | "night";

/**
 * The masthead knows whether it is over the sky or over the paper.
 *
 * White text on the plate and ink on parchment are both correct; the only wrong
 * answer is picking one and keeping it through the handover.
 */
export default function Chrome() {
  const [over, setOver] = useState(true);
  const [theme, setTheme] = useState<Theme>("day");

  useEffect(() => {
    const onScroll = () => setOver(window.scrollY < window.innerHeight * 0.72);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    setTheme(stored === "night" ? "night" : "day");
  }, []);

  /**
   * Switch the theme through a View Transition when the browser has one.
   *
   * The wipe originates at the button, so the change reads as coming from the
   * thing that was pressed rather than happening to the whole page at once. The
   * fallback is the same swap without the sweep — the token transitions in CSS
   * still carry it, so nothing snaps on a browser that lacks the API.
   */
  const flip = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const next: Theme = theme === "day" ? "night" : "day";
      const rect = event.currentTarget.getBoundingClientRect();
      const root = document.documentElement;
      root.style.setProperty("--switch-x", `${((rect.left + rect.width / 2) / window.innerWidth) * 100}%`);
      root.style.setProperty("--switch-y", `${((rect.top + rect.height / 2) / window.innerHeight) * 100}%`);

      const apply = () => {
        if (next === "night") root.setAttribute("data-theme", "night");
        else root.removeAttribute("data-theme");
        setTheme(next);
        try {
          localStorage.setItem("yuzu-theme", next === "night" ? "night" : "");
        } catch {
          // Private window. The choice just will not survive a reload.
        }
      };

      const start = (document as Document & { startViewTransition?: (cb: () => void) => void }).startViewTransition;
      if (typeof start === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        start.call(document, apply);
      } else {
        apply();
      }
    },
    [theme],
  );

  return (
    <header className="top" data-over={over} data-solid={!over}>
      <a className="brand" href="/">
        <img src="/art/yuzu-logo-32.webp" alt="Yuzu" width={30} height={30} className="pixellated" style={{ imageRendering: "pixelated" }} />
        <b>Yuzu</b>
      </a>
      <div className="spacer" />
      <a className="top-link hide-sm" href="/#market">
        The market
      </a>
      <a className="top-link hide-sm" href="/dashboard">
        Grant map
      </a>
      <a className="top-link hide-sm" href="/deal">
        Check a receipt
      </a>
      <a className="top-link hide-sm" href="/judge" style={{ color: "var(--yuzu)", fontWeight: 600 }}>
        Judge panel
      </a>
      <button className="theme-btn" onClick={flip} aria-label={`Switch to ${theme === "day" ? "night" : "day"}`}>
        {theme === "day" ? "NIGHT" : "DAY"}
      </button>
      <a className="btn btn-solid" href="/#market" style={{ padding: "0.45rem 0.9rem", fontSize: "0.84rem" }}>
        Plant a goal
      </a>
    </header>
  );
}
