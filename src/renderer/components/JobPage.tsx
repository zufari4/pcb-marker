import { useContext, useMemo } from "react";
import { Pause, Play, Square } from "lucide-react";
import type { Bounds, Job, PrinterStatus, Stroke } from "../../shared/model";
import { displayMotions, motionPoint } from "../../core/program";
import { useInterpolatedProgress } from "../useInterpolatedProgress";
import type { MotionProgress } from "../../core/motion-progress";
import { pointBounds } from "../../core/registration";
import { LanguageContext, useT } from "../i18n";
import { localizeMessage } from "../../shared/messages";
import { BoardCanvas } from "./BoardCanvas";
import { OperationIcon } from "./Icons";
import { WorkspacePage } from "./Pages";

export function JobPage({
  job,
  printer,
  motionProgress,
  busy,
  onControl,
  onConnect,
  onClose,
}: {
  job: Job;
  printer: PrinterStatus | null;
  motionProgress: MotionProgress;
  busy: boolean;
  onControl(action: "pause" | "resume" | "stop"): void;
  onConnect(): void;
  onClose(): void;
}) {
  const t = useT(),
    language = useContext(LanguageContext);
  const displayedMotions = useMemo(
    () => displayMotions(job.program),
    [job.program],
  );
  const strokes = useMemo<Stroke[]>(
    () =>
      displayedMotions
        .filter((m) => m.operation === "draw")
        .map((m) => ({
          kind: "track",
          points: [
            [m.from[0], m.from[1]],
            [m.to[0], m.to[1]],
          ],
        })),
    [displayedMotions],
  );
  const bounds = useMemo<Bounds>(
    () => pointBounds(strokes.flatMap((s) => s.points)),
    [strokes],
  );
  const matched = printer?.filename === job.filename;
  const active = ["running", "paused"].includes(job.state),
    disconnected = !printer?.connected;
  const animated = useInterpolatedProgress(
    job.id,
    job.program.motions,
    motionProgress,
    job.state === "running" &&
      matched &&
      !disconnected &&
      !printer.paused &&
      printer.state === "printing" &&
      printer.positionSource !== "commanded",
  );
  const motion = displayedMotions[animated.index];
  const elapsed = motion
    ? motion.start + (motion.end - motion.start) * animated.fraction
    : 0;
  const progress =
    job.state === "completed"
      ? 100
      : Math.min(99, Math.floor((100 * elapsed) / (job.program.duration || 1)));
  const operation = motion?.operation ?? "idle";
  const position = matched ? printer.position : null;
  const cursor = motion ? motionPoint(motion, animated.fraction) : position;
  const stateText =
    disconnected && active
      ? t("connectionLost")
      : t(job.state === "disconnected" ? "connectionLost" : job.state);
  return (
    <WorkspacePage
      title={`${t(job.program.dry ? "testJob" : "job")} · ${t(job.program.side)}`}
      className="job-page"
      onClose={onClose}
    >
      <div className="job-content">
        <BoardCanvas
          strokes={strokes}
          bounds={bounds}
          motions={displayedMotions}
          showTravel
          motionIndex={animated.index}
          motionFraction={animated.fraction}
          cursor={cursor ?? undefined}
          width={0.25}
          dimensions={false}
          fitKey={job.id}
        />
        <aside className="job-panel">
          <span className="section-label">{t("status")}</span>
          <h2 className={job.state === "error" ? "danger-text" : ""}>
            {stateText}
          </h2>
          <div className="job-progress">
            <progress
              aria-label={t("jobProgress")}
              max={100}
              value={progress}
            />
            <span>{progress}%</span>
          </div>
          <hr />
          <span className="section-label">{t("operation")}</span>
          <div className="job-operation">
            <OperationIcon
              operation={job.state === "paused" ? "lift" : operation}
              size={44}
            />
            <span>
              {job.state === "paused"
                ? t("raised")
                : !active
                  ? t("idle")
                  : t(
                      operation === "draw"
                        ? job.program.dry
                          ? "tracing"
                          : "drawing"
                        : operation === "lift"
                          ? "lifting"
                          : operation === "lower"
                            ? "lower"
                            : operation === "idle"
                              ? "idle"
                              : "travel",
                    )}
            </span>
          </div>
          <hr />
          <span className="section-label">
            {t("position")} <small>{t("mm")}</small>
          </span>
          <div className="coordinate-list">
            {["X", "Y", "Z"].map((axis, i) => (
              <div key={axis}>
                <span>{axis}</span>
                <strong>{position ? position[i].toFixed(3) : "—"}</strong>
              </div>
            ))}
          </div>
          {job.error && (
            <p className="inline-error">
              {localizeMessage(job.error, language)}
            </p>
          )}
          <div className="job-controls">
            {disconnected ? (
              <button className="primary" disabled={busy} onClick={onConnect}>
                {t("reconnect")}
              </button>
            ) : active ? (
              <>
                <button
                  className={job.state === "paused" ? "primary" : ""}
                  disabled={busy}
                  onClick={() =>
                    onControl(job.state === "paused" ? "resume" : "pause")
                  }
                >
                  {job.state === "paused" ? (
                    <Play size={18} fill="currentColor" />
                  ) : (
                    <Pause size={18} fill="currentColor" />
                  )}
                  {t(job.state === "paused" ? "resume" : "pause")}
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => onControl("stop")}
                >
                  <Square size={17} fill="currentColor" />
                  {t("stop")}
                </button>
              </>
            ) : null}
          </div>
        </aside>
      </div>
    </WorkspacePage>
  );
}
