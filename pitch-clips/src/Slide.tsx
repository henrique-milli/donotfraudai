import React, { useLayoutEffect, useRef, useState } from 'react';
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
// Plain ES module shared with the website.
import { mountSlide } from '../../site/assets/js/slides-core.js';
import '../../site/assets/css/explode.css';
import '../../site/assets/css/console.css';
import '../../site/assets/css/slides.css';

type Api = { render: (t: number) => void };

/** One pitch slide, rendered by the exact code the website's slides.html runs. */
export const Slide: React.FC<{ id: string }> = ({ id }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [handle] = useState(() => delayRender(`mount ${id}`));

  useLayoutEffect(() => {
    const el = ref.current!;
    api.current = mountSlide(el, id, (p: string) => staticFile(`site/${p}`));
    api.current!.render(frame / fps);
    const imgs = [...el.querySelectorAll('img')];
    Promise.all([
      document.fonts.ready,
      ...imgs.map(img => (img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = () => r(null); }))),
    ]).then(() => continueRender(handle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const t = frame / fps;
    ref.current!.style.setProperty('--clock', String(t));
    api.current?.render(t);
  }, [frame, fps]);

  return <div ref={ref} data-clock="" style={{ width: 1920, height: 1080 }} />;
};
