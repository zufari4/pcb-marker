import { useState } from "react";
import type { Job, PrinterStatus } from "../shared/model";
import {
  advanceMotionProgress,
  initialMotionProgress,
  type MotionProgress,
} from "../core/motion-progress";

/** Kept in the workspace so navigating away never loses observed progress. */
export function useJobProgress(
  job: Job | null,
  printer: PrinterStatus | null,
): MotionProgress {
  const [observed, setObserved] = useState({
    jobId: "",
    job: null as Job | null,
    printer: null as PrinterStatus | null,
    progress: initialMotionProgress,
  });
  // Derive progress before committing children so the cursor and painted
  // endpoint always use the same telemetry sample, without an effect delay.
  if (observed.job !== job || observed.printer !== printer) {
    const next = (() => {
      if (!job) return { jobId: "", progress: initialMotionProgress };
      const progress =
        observed.jobId === job.id ? observed.progress : initialMotionProgress;
      if (job.state === "completed")
        return {
          jobId: job.id,
          progress: { index: job.program.motions.length - 1, fraction: 1 },
        };
      const canObserve =
        job.state === "running" &&
        printer?.connected &&
        printer.filename === job.filename &&
        !printer.paused &&
        printer.positionSource !== "commanded" &&
        printer.state === "printing";
      return {
        jobId: job.id,
        progress: canObserve
          ? advanceMotionProgress(
              job.program.motions,
              progress,
              printer.position,
              printer.filePosition,
            )
          : progress,
      };
    })();
    setObserved({ ...next, job, printer });
    return next.progress;
  }
  return observed.jobId === job?.id ? observed.progress : initialMotionProgress;
}
