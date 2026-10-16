import { useLayoutEffect, useRef, useState } from "react";
import type { Motion } from "../shared/model";
import {
  interpolateMotionProgress,
  type MotionProgress,
} from "../core/motion-progress";

/** Animate only confirmed progress. Cursor and painted path share this clock. */
export function useInterpolatedProgress(
  jobId: string,
  motions: Motion[],
  target: MotionProgress,
  running: boolean,
): MotionProgress {
  const [displayed, setDisplayed] = useState(target);
  const current = useRef(target);
  const sample = useRef({ jobId, motions, at: 0 });
  useLayoutEffect(() => {
    const now = performance.now();
    const previous = sample.current;
    const reset = previous.jobId !== jobId || previous.motions !== motions;
    const duration = previous.at
      ? Math.max(100, Math.min(600, now - previous.at))
      : 500;
    sample.current = { jobId, motions, at: now };
    const publish = (value: MotionProgress) => {
      current.current = value;
      setDisplayed(value);
    };
    if (
      reset ||
      !running ||
      current.current.index < 0 ||
      target.index < current.current.index
    ) {
      publish(target);
      return;
    }
    const from = current.current;
    let frame = 0;
    const tick = (time: number) => {
      const amount = Math.min(1, (time - now) / duration);
      publish(interpolateMotionProgress(motions, from, target, amount));
      if (amount < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [jobId, motions, target.index, target.fraction, running]);
  return displayed;
}
