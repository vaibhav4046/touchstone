"use client";

import { useEffect } from "react";

export default function HoverMotion() {
  useEffect(() => {
    const isTouch = window.matchMedia("(hover: none)").matches;
    const containers = document.querySelectorAll<HTMLElement>(".motion-hover-play");

    const cleanups: (() => void)[] = [];

    containers.forEach((container) => {
      const video = container.querySelector<HTMLVideoElement>("video");
      if (!video) return;

      if (!isTouch) {
        // Desktop: hover to play, leave to pause
        const onEnter = () => {
          container.classList.add("is-hovered");
          video.play().catch(() => {});
        };
        const onLeave = () => {
          container.classList.remove("is-hovered");
          video.pause();
        };

        container.addEventListener("mouseenter", onEnter);
        container.addEventListener("mouseleave", onLeave);

        cleanups.push(() => {
          container.removeEventListener("mouseenter", onEnter);
          container.removeEventListener("mouseleave", onLeave);
        });
      } else {
        // Touch devices: tap to toggle
        const onTap = () => {
          if (video.paused) {
            video.play().catch(() => {});
            container.classList.add("is-hovered");
          } else {
            video.pause();
            container.classList.remove("is-hovered");
          }
        };
        container.addEventListener("click", onTap);
        cleanups.push(() => container.removeEventListener("click", onTap));
      }
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
