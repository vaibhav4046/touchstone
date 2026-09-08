"use client";

import { useEffect, useRef } from "react";

/**
 * A background plate that plays slower than it was rendered.
 *
 * `playbackRate` cannot be set from markup, so anything that wants to drift
 * rather than race needs a client component. Paired with the palindrome cuts in
 * `public/film`, half speed is what turns a ten-second render into weather.
 */
export default function Plate({
  src,
  poster,
  rate = 0.5,
}: {
  readonly src: string;
  readonly poster: string;
  readonly rate?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    element.playbackRate = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : rate;
  }, [rate]);

  return (
    <video ref={video} autoPlay muted loop playsInline poster={poster} aria-hidden="true">
      <source src={`${src}.mp4`} type="video/mp4" />
      <source src={`${src}.webm`} type="video/webm" />
    </video>
  );
}
