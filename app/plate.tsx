"use client";

import { useEffect, useRef, useState } from "react";
import { plateCut } from "./density";

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
  const [cut, setCut] = useState<string | undefined>();

  useEffect(() => setCut(plateCut()), []);

  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    element.playbackRate = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : rate;

    // A plate three screens down should not be decoding while somebody reads
    // the top of the page.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) void element.play().catch(() => undefined);
        else element.pause();
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rate, cut]);

  // Until the cut is known the poster stands in, so nothing downloads twice.
  if (cut === undefined) return <img className="plate" src={poster} alt="" aria-hidden="true" />;

  return (
    <video ref={video} autoPlay muted loop playsInline poster={cut === "@2x" ? poster.replace(".jpg", "@2x.jpg") : poster} aria-hidden="true">
      <source src={`${src}${cut}.webm`} type="video/webm" />
      <source src={`${src}${cut}.mp4`} type="video/mp4" />
    </video>
  );
}
