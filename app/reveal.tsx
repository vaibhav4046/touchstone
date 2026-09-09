"use client";

import { useEffect } from "react";

/**
 * One observer for the whole page.
 *
 * Anything with `data-reveal` rises into place the first time it is seen. The
 * alternative is a wrapper component around every element, which turns the page
 * into a tree of `<Reveal>` and makes the markup about the animation rather than
 * about the content. An attribute costs nothing and reads as what it is.
 *
 * It unobserves after firing, because a section that has already arrived should
 * not animate again on the way back up — re-entry animation is what makes a
 * long page feel restless.
 */
export default function Reveal() {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const element of targets) element.dataset.revealed = "true";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          element.dataset.revealed = "true";
          observer.unobserve(element);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );

    for (const element of targets) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return null;
}
