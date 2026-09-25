import React from 'react';
import { Composition, registerRoot } from 'remotion';
// Plain ES module shared with the website.
import { SLIDES } from '../../site/assets/js/slides-core.js';
import { Slide } from './Slide';

const FPS = 30;
/** Extra hold on the last frame so a Canva slide doesn't loop too early. */
const HOLD = 1;

export const Root: React.FC = () => (
  <>
    {(SLIDES as Array<{ id: string; dur: number }>).map(s => (
      <Composition
        key={s.id}
        id={`slide-${s.id}`}
        component={Slide}
        defaultProps={{ id: s.id }}
        durationInFrames={Math.round((s.dur + HOLD) * FPS)}
        fps={FPS}
        width={1920}
        height={1080}
      />
    ))}
  </>
);

registerRoot(Root);
