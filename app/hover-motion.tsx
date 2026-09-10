"use client";

import { useEffect } from "react";

export default function HoverMotion() {
  useEffect(() => {
    // 1. Stage Card Hover-to-Play
    const cardContainers = document.querySelectorAll<HTMLElement>(".card-media-wrap");
    const cleanups: (() => void)[] = [];

    cardContainers.forEach((container) => {
      const video = container.querySelector<HTMLVideoElement>("video");
      if (!video) return;

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

      // Touch tap support
      const onClick = () => {
        if (video.paused) {
          container.classList.add("is-hovered");
          video.play().catch(() => {});
        } else {
          container.classList.remove("is-hovered");
          video.pause();
        }
      };
      container.addEventListener("click", onClick);

      cleanups.push(() => {
        container.removeEventListener("mouseenter", onEnter);
        container.removeEventListener("mouseleave", onLeave);
        container.removeEventListener("click", onClick);
      });
    });

    // 2. Continuous Autoplay Videos (ensure they keep playing smoothly without pausing on leave)
    const continuousVideos = document.querySelectorAll<HTMLVideoElement>(
      ".pixel-screen-video, .endcard-video"
    );
    continuousVideos.forEach((video) => {
      video.play().catch(() => {});
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
