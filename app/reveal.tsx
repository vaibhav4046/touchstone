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
      // Threshold is a fraction of the TARGET, not of the viewport, so a
      // section taller than the screen can never reach 0.15 and stays at
      // opacity 0 forever. That is exactly what happened to the long panels on
      // the dashboard. Fire on first contact instead and let the negative
      // bottom margin do the "wait until it is properly on screen" part.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );

    // Last resort. If the observer never fires -- a zero-area viewport, a
    // background render, a print, a browser that throttles a hidden tab past
    // the point of caring -- every section stays at opacity 0 and the page is
    // blank. An animation is worth losing; the content is not.
    const failsafe = window.setTimeout(() => {
      for (const element of targets) element.dataset.revealed = "true";
    }, 2500);

    for (const element of targets) {
      // Anything already at or above the fold is shown outright rather than
      // observed. A restored scroll position or a fast flick can put a section
      // behind the viewport before the observer is even attached, and an
      // element that misses its only chance to intersect stays at opacity 0
      // forever. Content that cannot be seen is a worse failure than content
      // that arrives without its animation.
      if (element.getBoundingClientRect().top < window.innerHeight) element.dataset.revealed = "true";
      else observer.observe(element);
    }
    return () => {
      window.clearTimeout(failsafe);
      observer.disconnect();
    };
  }, []);

  return null;
}
