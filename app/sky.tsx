"use client";

import { useEffect, useRef, useState } from "react";
import { plateCut } from "./density";

/**
 * One continuous shot.
 *
 * This used to be two clips cross-faded on scroll, which was a lot of machinery
 * to hide the fact that they were two clips. The pixel sky already scrolls, so
 * the page just plays it: the loop point is a dissolve of the tail into the
 * head, motion only ever runs one way, and there is nothing to catch.
 *
 * It is blurred a little and sat under a scrim, because the hero text has to be
 * readable and a busy sky behind white type is not a background, it is noise.
 */
export default function Sky() {
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState(false);
  const [cut, setCut] = useState<string | undefined>();

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduced.matches);
    setCut(plateCut());
    const onChange = (event: MediaQueryListEvent) => setStill(event.matches);
    reduced.addEventListener("change", onChange);
    return () => reduced.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (element === null || still) return;
    // Slower than rendered: at native speed the scroll reads as a loop rather
    // than as sky.
    element.playbackRate = 0.42;
  }, [still, cut]);

  useEffect(() => {
    if (still) return;
    let frame = 0;

    const paint = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 1.25)));
      if (wrap.current) wrap.current.style.opacity = String(1 - progress * progress);

      // Past the hero it is costing battery and showing nothing.
      const element = video.current;
      if (element !== null) {
        if (progress > 0.98 && !element.paused) element.pause();
        else if (progress <= 0.98 && element.paused) void element.play().catch(() => undefined);
      }
    };

    const onScroll = () => {
      frame ||= requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [still]);

  useEffect(() => {
    const onVisibility = () => {
      const element = video.current;
      if (element === null) return;
      if (document.hidden) element.pause();
      else void element.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const poster = cut === "@2x" ? "/film/skyscroll@2x.jpg" : "/film/skyscroll.jpg";

  return (
    <div className="sky" ref={wrap} aria-hidden="true">
      {cut === undefined || still ? (
        <img className="plate" src={poster} alt="" />
      ) : (
        <video ref={video} autoPlay muted loop playsInline preload="metadata" poster={poster}>
          <source src={`/film/skyscroll${cut}.webm`} type="video/webm" />
          <source src={`/film/skyscroll${cut}.mp4`} type="video/mp4" />
        </video>
      )}
      <div className="veil" />
    </div>
  );
}
