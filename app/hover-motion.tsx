"use client";

import { useEffect } from "react";

export default function HoverMotion() {
  useEffect(() => {
    // 1. Stage Card Hover-to-Play
    const cardContainers = document.querySelectorAll<HTMLElement>(".card-media-wrap");
    const cleanups: (() => void)[] = [];

    cardContainers.forEach((container) => {
      const video = container.querySelector<HTMLVideoElement>("video");
      if (!video || !(video instanceof HTMLVideoElement) || typeof video.play !== "function") return;

      const onEnter = () => {
        container.classList.add("is-hovered");
        try {
          video.play().catch(() => {});
        } catch {}
      };
      const onLeave = () => {
        container.classList.remove("is-hovered");
        try {
          video.pause();
        } catch {}
      };

      container.addEventListener("mouseenter", onEnter);
      container.addEventListener("mouseleave", onLeave);

      // Touch tap support
      const onClick = () => {
        try {
          if (video.paused) {
            container.classList.add("is-hovered");
            video.play().catch(() => {});
          } else {
            container.classList.remove("is-hovered");
            video.pause();
          }
        } catch {}
      };
      container.addEventListener("click", onClick);

      cleanups.push(() => {
        container.removeEventListener("mouseenter", onEnter);
        container.removeEventListener("mouseleave", onLeave);
        container.removeEventListener("click", onClick);
      });
    });

    // 2. Continuous Autoplay Videos (ensure actual videos keep playing smoothly)
    const continuousVideos = document.querySelectorAll<HTMLVideoElement>(
      "video.pixel-screen-video"
    );
    continuousVideos.forEach((video) => {
      if (video instanceof HTMLVideoElement && typeof video.play === "function") {
        try {
          video.play().catch(() => {});
        } catch {}
      }
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
