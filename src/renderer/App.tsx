import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Eye,
  FolderOpen,
  Menu,
  LoaderCircle,
  Minus,
  Pause,
  Play,
  Settings as Gear,
  Square,
  X,
  Download,
  Info,
  RefreshCw,
} from "lucide-react";
import type {
  AppSnapshot,
  Board,
  Bounds,
  LayerView,
  LoadProgress,
  Settings,
  Side,
  Stroke,
} from "../shared/model";
import { defaults } from "../shared/settings";
import { localPoint, pointBounds } from "../core/registration";
import {
  boardStrokes,
  compileProgram,
  createProgram,
  motionAt,
} from "../core/program";
import { LanguageContext, resolveLanguage, stageKey, useT } from "./i18n";
import { BoardCanvas } from "./components/BoardCanvas";
import { BindingPage, SettingsPage, WorkspacePage } from "./components/Pages";
import { useJobProgress } from "./useJobProgress";
import {
  DryRunIcon,
  CornerIcon,
  LayerIcon,
  Logo,
  OperationIcon,
  PrinterIcon,
} from "./components/Icons";
import { ActionButton } from "./components/ActionButton";
import { JobPage } from "./components/JobPage";
import { AboutPage } from "./components/AboutPage";

const initial: AppSnapshot = {
  settings: defaults,
  systemLocale: navigator.language,
  corners: {},
  board: null,
  printer: null,
  job: null,
};
export default function App() {
  const startupError = new URLSearchParams(location.search).get("startupError");
  if (startupError)
    return (
      <LanguageContext.Provider
        value={resolveLanguage("system", navigator.language)}
      >
        <StartupError message={startupError} />
      </LanguageContext.Provider>
    );
  return <AppSession />;
}
function StartupError({ message }: { message: string }) {
  const t = useT();
  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <Logo />
          <strong>PCB Marker</strong>
        </div>
        <button
          className="window-button"
          title={t("close")}
          onClick={() => window.pcb.window("close")}
        >
          <X size={19} />
        </button>
      </header>
      <main className="startup-error">
        <h2>{t("failure")}</h2>
        <p role="alert">{message}</p>
        <button onClick={() => window.pcb.window("close")}>{t("close")}</button>
      </main>
    </div>
  );
}
function AppSession() {
  const [snapshot, setSnapshot] = useState(initial),
    [languageOverride, setLanguageOverride] = useState<Settings["language"]>();
  useEffect(() => {
    void window.pcb.snapshot().then(setSnapshot);
  }, []);
  const language = resolveLanguage(
    languageOverride ?? snapshot.settings.language,
    snapshot.systemLocale,
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <LanguageContext.Provider value={language}>
      <Workspace
        snapshot={snapshot}
        setSnapshot={setSnapshot}
        onLanguage={setLanguageOverride}
      />
    </LanguageContext.Provider>
  );
}
function Workspace({
  snapshot,
  setSnapshot,
  onLanguage,
}: {
  snapshot: AppSnapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot>>;
  onLanguage(language?: Settings["language"]): void;
}) {
  const t = useT(),
    { settings, board, printer, corners, job } = snapshot;
  const [mode, setMode] = useState<"board" | "visualization">("board"),
    [layer, setLayer] = useState<LayerView>("both");
  const [menu, setMenu] = useState(false),
    [page, setPage] = useState<"settings" | "binding" | "job" | "about" | null>(
      null,
    );
  const [checkOnOpen, setCheckOnOpen] = useState(0);
  const menuAnchor = useRef<HTMLDivElement>(null);
  const [closeRequested, setCloseRequested] = useState(false);
  const [launch, setLaunch] = useState<{
    side: Side;
    dry: boolean;
    previousId?: string;
  } | null>(null);
  const awaitingJob = !!launch && (!job || job.id === launch.previousId);
  const jobProgress = useJobProgress(job, printer);
  const [load, setLoad] = useState<LoadProgress>({ busy: false, stage: "" }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [rate, setRate] = useState(4);
  const [viewWidth, setViewWidth] = useState(settings.strokeWidth),
    [showTravel, setShowTravel] = useState(settings.showTravel);
  const progressRef = useRef(0);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuAnchor.current?.contains(event.target as Node)) setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    if (page) setPlaying(false);
    if (page !== "settings") onLanguage(undefined);
  }, [page, onLanguage]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 15000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const activeJob =
    !!job &&
    ["running", "paused", "preparing", "disconnected"].includes(job.state);
  const boardActionReason = load.busy
    ? t("waitForGerber")
    : !board
      ? t("openGerberFirst")
      : undefined;
  const startActionReason =
    boardActionReason ??
    (busy
      ? t("waitForOperation")
      : layer === "both"
        ? t("bothHint")
        : undefined);
  const side: Side = layer === "both" ? "top" : layer;
  const perform = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        (e as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    setViewWidth(settings.strokeWidth);
    setShowTravel(settings.showTravel);
  }, [settings.strokeWidth, settings.showTravel]);
  useEffect(() => {
    const removers = [
      window.pcb.onError(setError),
      window.pcb.onCloseRequest(() => setCloseRequested(true)),
      window.pcb.onStatus((status) =>
        setSnapshot((s) => ({ ...s, printer: status })),
      ),
      window.pcb.onJob((job) => setSnapshot((s) => ({ ...s, job }))),
      window.pcb.onLoad(setLoad),
      window.pcb.onBoard((value) => acceptBoard(value)),
    ];
    return () => removers.forEach((remove) => remove());
  }, [setSnapshot]);
  const acceptBoard = (value: Board | null) => {
    if (!value) return;
    setSnapshot((s) => ({ ...s, board: value }));
    setLayer(
      value.layers.top && value.layers.bottom
        ? "both"
        : value.layers.top
          ? "top"
          : "bottom",
    );
    setMode("board");
    setPage(null);
    setTime(0);
  };
  const openBoard = () =>
    void perform(async () => acceptBoard(await window.pcb.openBoard()));
  const saveSettings = async (value: Settings) => {
    const saved = await window.pcb.saveSettings(value);
    setSnapshot((s) => ({ ...s, settings: saved }));
  };
  const connect = async () => {
    const status = await window.pcb.connect();
    setSnapshot((s) => ({ ...s, printer: status }));
  };
  const closeJob = useCallback(() => setPage(null), []);
  const closeDialog = useCallback(() => {
    setPage(null);
    onLanguage(undefined);
  }, [onLanguage]);
  const normalStrokes = useMemo<Stroke[]>(() => {
    if (!board) return [];
    return (layer === "both" ? (["bottom", "top"] as Side[]) : [layer]).flatMap(
      (s) =>
        board.layers[s]
          ? [
              ...boardStrokes(
                board,
                s,
                settings.drawing.frame && (layer !== "both" || s === "top"),
              ),
              ...(board.layers[s]?.padStrokes ?? []),
            ].map((stroke) => ({
              ...stroke,
              muted: layer === "both" && s === "bottom",
              points: stroke.points.map((p) =>
                localPoint(p, board.bounds, layer === "both" ? "top" : s),
              ),
            }))
          : [],
    );
  }, [board, layer, settings.drawing.frame]);
  const boardBounds: Bounds = useMemo(
    () =>
      board
        ? [
            0,
            0,
            board.bounds[2] - board.bounds[0],
            board.bounds[3] - board.bounds[1],
          ]
        : [0, 0, 107, 71],
    [board],
  );
  const preview = useMemo(() => {
    if (!board || !board.layers[side]) return null;
    if (Object.keys(corners).length === 4) {
      try {
        return {
          program: createProgram(
            board,
            side,
            corners,
            settings.drawing,
            printer?.position ?? [
              110,
              110,
              settings.drawing.contactZ + settings.drawing.lift,
            ],
          ),
          machine: true,
        };
      } catch {
        /* Unregistered preview stays available even when launch is blocked. */
      }
    }
    const strokes = boardStrokes(board, side, settings.drawing.frame).map(
      (s) => ({
        ...s,
        points: s.points.map((p) => localPoint(p, board.bounds, side)),
      }),
    );
    return {
      program: compileProgram(
        strokes,
        settings.drawing,
        [0, 0, settings.drawing.contactZ + settings.drawing.lift],
        side,
        false,
      ),
      machine: false,
    };
    // Freeze the launch origin while viewing; live printer polls must not reset playback.
  }, [board, side, corners, settings.drawing, mode]);
  const previewStrokes = useMemo<Stroke[]>(
    () =>
      preview?.program.motions
        .filter((m) => m.operation === "draw")
        .map((m) => ({
          kind: "track",
          points: [
            [m.from[0], m.from[1]],
            [m.to[0], m.to[1]],
          ],
        })) ?? [],
    [preview],
  );
  const previewBounds = useMemo<Bounds>(() => {
    if (!previewStrokes.length) return boardBounds;
    return pointBounds(previewStrokes.flatMap((s) => s.points));
  }, [previewStrokes, boardBounds]);
  const duration = preview?.program.duration ?? 0;
  useEffect(() => {
    setTime(0);
    progressRef.current = 0;
    setPlaying(false);
  }, [preview]);
  useEffect(() => {
    if (!playing || !duration) return;
    let frame = 0,
      previous = performance.now();
    const animate = (now: number) => {
      const next = Math.min(
        duration,
        progressRef.current + (Math.min(now - previous, 100) / 1000) * rate,
      );
      previous = now;
      progressRef.current = next;
      setTime(next);
      if (next < duration) frame = requestAnimationFrame(animate);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [playing, rate, duration]);
  const motion = motionAt(preview?.program.motions ?? [], time);
  const previewMode = mode === "visualization";
  const layerButtons = (
    <div className="layer-tools">
      {(["both", "top", "bottom"] as LayerView[]).map((value) => (
        <button
          key={value}
          title={t(value)}
          aria-label={t(value)}
          aria-pressed={layer === value}
          disabled={
            !board || !!activeJob || (value !== "both" && !board.layers[value])
          }
          className={`icon-button ${layer === value ? "selected" : ""}`}
          onClick={() => {
            setLayer(value);
            setPlaying(false);
          }}
        >
          <LayerIcon layer={value} />
        </button>
      ))}
    </div>
  );
  const start = (dry: boolean) =>
    void perform(async () => {
      if (!printer?.connected) {
        setPage("settings");
        return;
      }
      if (Object.keys(corners).length !== 4) {
        setPage("binding");
        return;
      }
      setLaunch({ side, dry, previousId: job?.id });
      setPage("job");
      try {
        const result = await window.pcb.startJob(side, dry);
        setSnapshot((s) => ({ ...s, job: result }));
      } catch (error) {
        setPage(null);
        throw error;
      } finally {
        setLaunch(null);
      }
    });
  const title =
    page === "settings" || page === "binding" || page === "about"
      ? t(page)
      : page === "job" && awaitingJob
        ? `${t(launch.dry ? "testJob" : "job")} · ${t(launch.side)}`
        : page === "job" && job
          ? `${t(job.program.dry ? "testJob" : "job")} · ${t(job.program.side)}`
          : `${t(mode)}${board ? " · " + t(previewMode && layer === "both" ? "top" : layer) : ""}`;
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
        if (!activeJob) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && !activeJob)
          void perform(async () =>
            acceptBoard(await window.pcb.dropBoard(file)),
          );
      }}
    >
      <header className="titlebar">
        <div className="brand">
          <Logo />
          <strong>PCB Marker</strong>
          {board && (
            <>
              <span className="title-dash">—</span>
              <span className="project-name" title={board.name}>
                {board.name.replace(/^Gerber_/, "")}
              </span>
            </>
          )}
        </div>
        <div className="mode-title" role="heading" aria-level={1}>
          {title}
        </div>
        <div className="title-controls">
          <button
            className={`printer-indicator ${printer?.connected ? "connected" : ""}`}
            title={
              printer?.state === "connecting"
                ? t("connecting")
                : printer?.connected
                  ? t("connected")
                  : printer?.state === "connection_error"
                    ? `${t("disconnected")}: ${printer.message}`
                    : t("disconnected")
            }
            onClick={() => setPage("settings")}
          >
            <PrinterIcon
              state={
                printer?.state === "connecting"
                  ? "connecting"
                  : printer?.connected
                    ? printer.paused
                      ? "paused"
                      : printer.state
                    : "disconnected"
              }
            />
            <span>{settings.printerName}</span>
          </button>
          <span className="divider" />
          <div className="menu-anchor" ref={menuAnchor}>
            <button
              className="title-icon"
              title={t("settings")}
              disabled={!!activeJob}
              onClick={() => setMenu((v) => !v)}
            >
              <Menu size={22} />
            </button>
            {menu && (
              <>
                <div className="dropdown">
                  <button
                    disabled={busy || !!activeJob}
                    onClick={() => {
                      setMenu(false);
                      openBoard();
                    }}
                  >
                    <FolderOpen size={19} />
                    {t("openFile")}
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setPage("binding");
                    }}
                  >
                    <CornerIcon />
                    {t("binding")}
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setPage("settings");
                    }}
                  >
                    <Gear size={19} />
                    {t("settings")}
                  </button>
                  {board && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        void perform(async () => {
                          await window.pcb.exportGcode(side, false);
                        });
                      }}
                    >
                      <Download size={19} />
                      {t("export")}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMenu(false);
                      setCheckOnOpen((value) => value + 1);
                      setPage("about");
                    }}
                  >
                    <RefreshCw size={19} />
                    {t("checkUpdates")}
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setCheckOnOpen(0);
                      setPage("about");
                    }}
                  >
                    <Info size={19} />
                    {t("about")}
                  </button>
                </div>
              </>
            )}
          </div>
          <span className="divider" />
          <button
            className="window-button"
            title={t("minimize")}
            onClick={() => window.pcb.window("minimize")}
          >
            <Minus size={18} />
          </button>
          <button
            className="window-button"
            title={t("maximize")}
            onClick={() => window.pcb.window("maximize")}
          >
            <Square size={14} />
          </button>
          <button
            className="window-button close-window"
            title={t("close")}
            onClick={() => window.pcb.window("close")}
          >
            <X size={21} />
          </button>
        </div>
      </header>
      <main
        hidden={!!page}
        className={`workspace ${previewMode ? "replay" : ""}`}
      >
        <div className="canvas-column">
          {previewMode && (
            <button
              className="back-button"
              title={t("back")}
              onClick={() => {
                setMode("board");
                setPlaying(false);
              }}
            >
              <ArrowLeft size={24} strokeWidth={2.6} />
            </button>
          )}
          <BoardCanvas
            strokes={
              load.busy ? [] : previewMode ? previewStrokes : normalStrokes
            }
            bounds={previewMode ? previewBounds : boardBounds}
            width={previewMode ? viewWidth : 0.23}
            motions={previewMode ? preview?.program.motions : undefined}
            motionIndex={motion.index}
            motionFraction={motion.fraction}
            cursor={previewMode ? motion.position : undefined}
            showTravel={previewMode && showTravel}
            dimensions={
              !!board && !load.busy && (!previewMode || !preview?.machine)
            }
            fitKey={`${board?.name}-${mode}`}
          >
            {board && !load.busy && layerButtons}
            {previewMode && board && (
              <div
                className="motion-hud"
                title={preview?.machine ? undefined : t("localCoordinates")}
              >
                <span>
                  <OperationIcon operation={motion.operation} />
                  {t(
                    motion.operation === "draw"
                      ? "drawing"
                      : motion.operation === "lift"
                        ? "lifting"
                        : motion.operation === "lower"
                          ? "lower"
                          : "travel",
                  )}
                </span>
                <i />
                {["X", "Y", "Z"].map((axis, i) => (
                  <span key={axis}>
                    {axis} <b>{motion.position[i].toFixed(3)}</b>
                  </span>
                ))}
              </div>
            )}
          </BoardCanvas>
          {(!board || load.busy) && (
            <div className="empty-overlay">
              {load.busy ? (
                <div className="loading-card">
                  <LoaderCircle size={30} className="spin" />
                  <h2>{t(stageKey(load.stage))}</h2>
                  <div className="indeterminate" />
                  <button onClick={() => void window.pcb.cancelLoad()}>
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <div className="drop-zone">
                  <FolderOpen size={48} strokeWidth={1.3} />
                  <h2>{t("dropTitle")}</h2>
                  <p>{t("dropSubtitle")}</p>
                  <button className="primary" onClick={openBoard}>
                    {t("openFile")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {previewMode && (
          <aside className="replay-panel">
            <label>
              {t("width")}
              <div className="input-wrap">
                <input
                  aria-label={t("width")}
                  type="number"
                  min=".01"
                  max="5"
                  step=".05"
                  value={viewWidth}
                  onChange={(e) =>
                    setViewWidth(
                      Math.max(0.01, Math.min(5, Number(e.target.value))),
                    )
                  }
                  onBlur={() =>
                    void perform(() =>
                      saveSettings({ ...settings, strokeWidth: viewWidth }),
                    )
                  }
                />
                <span className="unit">{t("mm")}</span>
              </div>
            </label>
            <p className="subtle">{t("displayOnly")}</p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={showTravel}
                onChange={(e) => {
                  setShowTravel(e.target.checked);
                  void perform(() =>
                    saveSettings({ ...settings, showTravel: e.target.checked }),
                  );
                }}
              />
              {t("showTravel")}
            </label>
            <hr />
            <div className="legend">
              <span>
                <i className="drawn" />
                {t("completedPath")}
              </span>
              <span>
                <i />
                {t("remainingPath")}
              </span>
              <span>
                <i className="travel" />
                {t("travel")}
              </span>
            </div>
          </aside>
        )}
      </main>
      <footer
        hidden={!!page}
        className={previewMode ? "playback-bar" : "action-bar"}
      >
        <span className="app-version">v{__APP_VERSION__}</span>
        {previewMode ? (
          <>
            <button
              className="primary playback-toggle"
              title={t(playing ? "pausePreview" : "playing")}
              disabled={!preview}
              onClick={() => {
                if (time >= duration) {
                  setTime(0);
                  progressRef.current = 0;
                }
                setPlaying((v) => !v);
              }}
            >
              {playing ? (
                <Pause fill="currentColor" />
              ) : (
                <Play fill="currentColor" />
              )}
            </button>
            <input
              aria-label={t("seek")}
              type="range"
              min={0}
              max={duration || 1}
              step={0.01}
              value={time}
              style={
                {
                  "--progress": `${(time / (duration || 1)) * 100}%`,
                } as React.CSSProperties
              }
              onChange={(e) => {
                const value = Number(e.target.value);
                setTime(value);
                progressRef.current = value;
              }}
            />
            <span className="percent">
              {Math.floor((time / (duration || 1)) * 100)}%
            </span>
            <select
              aria-label={t("playbackSpeed")}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              {[1, 2, 4, 8, 16, 32].map((speed) => (
                <option value={speed} key={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            {board?.warnings.length ? (
              <span className="board-notice" title={board.warnings.join("\n")}>
                {t("warning")}
              </span>
            ) : null}
            {activeJob ? (
              <button className="primary" onClick={() => setPage("job")}>
                <Eye size={20} />
                {t("jobWindow")}
              </button>
            ) : (
              <>
                <ActionButton
                  disabledReason={boardActionReason}
                  onClick={() => {
                    if (layer === "both")
                      setLayer(board?.layers.top ? "top" : "bottom");
                    setMode("visualization");
                  }}
                >
                  <Eye size={21} />
                  {t("visualization")}
                </ActionButton>
                <ActionButton
                  disabledReason={startActionReason}
                  onClick={() => start(true)}
                >
                  <DryRunIcon />
                  {t("dryRun")}
                </ActionButton>
                <ActionButton
                  className="primary"
                  disabledReason={startActionReason}
                  onClick={() => start(false)}
                >
                  <Play size={19} fill="currentColor" />
                  {t("start")}
                </ActionButton>
              </>
            )}
          </>
        )}
      </footer>
      {dragging && (
        <div className="drag-overlay">
          <FolderOpen size={54} />
          <h2>{t("dropTitle")}</h2>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label={t("close")} onClick={() => setError("")}>
            <X size={19} />
          </button>
        </div>
      )}
      {closeRequested && (
        <div
          className="close-confirmation"
          role="alertdialog"
          aria-label={t("closeWhileRunning")}
        >
          <span>{t("closeWhileRunning")}</span>
          <button autoFocus onClick={() => setCloseRequested(false)}>
            {t("stay")}
          </button>
          <button onClick={() => window.pcb.window("confirm-close")}>
            {t("close")}
          </button>
        </div>
      )}
      {page === "about" && (
        <AboutPage
          key={String(checkOnOpen)}
          checkOnOpen={checkOnOpen}
          onClose={() => setPage(null)}
        />
      )}
      {page === "settings" && (
        <SettingsPage
          settings={settings}
          connected={!!printer?.connected}
          connecting={printer?.state === "connecting"}
          onSave={saveSettings}
          onConnect={connect}
          onClose={closeDialog}
          onLanguage={onLanguage}
        />
      )}
      {page === "binding" && (
        <BindingPage
          corners={corners}
          onCapture={async (key) => {
            const value = await window.pcb.captureCorner(key);
            setSnapshot((s) => ({ ...s, corners: value }));
          }}
          onReset={async () => {
            const value = await window.pcb.resetCorners();
            setSnapshot((s) => ({ ...s, corners: value }));
          }}
          onClose={closeDialog}
        />
      )}
      {page === "job" && awaitingJob && (
        <WorkspacePage
          title={title}
          className="job-starting-page"
          onClose={closeJob}
        >
          <div className="job-preparing" role="status">
            <LoaderCircle className="spin" size={30} />
            <h2>{t("preparing")}</h2>
          </div>
        </WorkspacePage>
      )}
      {page === "job" && job && !awaitingJob && (
        <JobPage
          job={job}
          printer={printer}
          motionProgress={jobProgress}
          busy={busy}
          onControl={(action) =>
            void perform(async () => {
              const value = await window.pcb.controlJob(action);
              setSnapshot((s) => ({ ...s, job: value }));
            })
          }
          onConnect={() => void perform(connect)}
          onClose={closeJob}
        />
      )}
    </div>
  );
}
