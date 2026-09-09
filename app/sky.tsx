"use client";

import { useEffect, useRef, useState } from "react";
import { plateCut } from "./density";

/**
 * One sky, two plates.
 *
 * The twilight clip and the mascot clip were rendered in the same world, so the
 * page treats them as one continuous shot: both are stacked, both play, and
 * scroll cross-fades between them. Cutting would announce two files. Fading
 * lets the reader believe the camera drifted down through the cloud and found
 * something sitting on it.
 *
 * The fade is driven by scroll position rather than a timeline, so the reader
 * controls the descent — stop halfway and the mascot is half-there, in cloud
 * that matches on both plates because it is the same cloud.
 */
export default function Sky() {
  const twilight = useRef<HTMLVideoElement>(null);
  const yuzu = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState(false);
  const [cut, setCut] = useState<string | undefined>();

  useEffect(() => setCut(plateCut()), []);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduced.matches);
    const onChange = (event: MediaQueryListEvent) => setStill(event.matches);
    reduced.addEventListener("change", onChange);
    return () => reduced.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (still) return;
    let frame = 0;

    const paint = () => {
      frame = 0;
      const viewport = window.innerHeight;
      // The handover happens across the first screen and a half: long enough to
      // read as a camera move, short enough that nobody scrolls past it.
      const progress = Math.min(1, Math.max(0, window.scrollY / (viewport * 1.15)));
      const eased = progress * progress * (3 - 2 * progress);

      if (twilight.current) {
        twilight.current.style.opacity = String(1 - eased);
        twilight.current.style.transform = `scale(${1 + eased * 0.09})`;
      }
      if (yuzu.current) {
        yuzu.current.style.opacity = String(eased);
        yuzu.current.style.transform = `scale(${1.07 - eased * 0.07})`;
      }
      // Past the handover the sky is doing nothing but costing battery.
      const skyOpacity = Math.max(0, 1 - Math.max(0, progress - 0.82) / 0.18);
      if (wrap.current) wrap.current.style.opacity = String(skyOpacity);

      // Decoding a plate nobody can see is the whole cost and none of the
      // effect. Two 1080p clips playing at once was what made the handover
      // stutter on the machine it was meant to look best on.
      settle(twilight.current, skyOpacity > 0.01 && eased < 0.985);
      settle(yuzu.current, skyOpacity > 0.01 && eased > 0.015);
    };

    const settle = (element: HTMLVideoElement | null, shouldPlay: boolean) => {
      if (element === null) return;
      if (shouldPlay && element.paused) void element.play().catch(() => undefined);
      else if (!shouldPlay && !element.paused) element.pause();
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

  /**
   * Slow, and seamless.
   *
   * The clips are ten seconds of drifting cloud, which at native speed reads as
   * a loop rather than as weather — the eye catches the repeat and the spell
   * breaks. Both plates are now palindromes (forward, then the same footage
   * reversed), so the seam is mathematically identical on both sides and there
   * is no cut to notice. Playing them at just under half speed turns twenty
   * seconds of file into forty-odd seconds of apparent drift, which is long
   * enough that nobody is counting.
   */
  useEffect(() => {
    if (still) return;
    for (const element of [twilight.current, yuzu.current]) {
      if (element !== null) element.playbackRate = 0.45;
    }
  }, [still, cut]);

  // A tab nobody is looking at should not be decoding two 1080p clips.
  useEffect(() => {
    if (still) return;
    const onVisibility = () => {
      for (const element of [twilight.current, yuzu.current]) {
        if (element === null) continue;
        if (document.hidden) element.pause();
        else void element.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [still]);

  if (cut === undefined) {
    return (
      <div className="sky" ref={wrap} aria-hidden="true">
        <img className="plate" src="/film/twilight.jpg" alt="" />
        <div className="veil" />
      </div>
    );
  }

  if (still) {
    return (
      <div className="sky" ref={wrap} aria-hidden="true">
        <img className="plate" src="/film/yuzu.jpg" alt="" />
        <div className="veil" />
      </div>
    );
  }

  return (
    <div className="sky" ref={wrap} aria-hidden="true">
      <video ref={twilight} autoPlay muted loop playsInline preload="metadata" poster="/film/twilight.jpg">
        <source src={`/film/twilight${cut}.webm`} type="video/webm" />
        <source src={`/film/twilight${cut}.mp4`} type="video/mp4" />
      </video>
      <video ref={yuzu} autoPlay muted loop playsInline preload="metadata" poster="/film/yuzu.jpg" style={{ opacity: 0 }}>
        <source src={`/film/yuzu${cut}.webm`} type="video/webm" />
        <source src={`/film/yuzu${cut}.mp4`} type="video/mp4" />
      </video>
      <div className="veil" />
    </div>
  );
}
