import { useContext, useEffect, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  HelpCircle,
  Languages,
  ArrowLeft,
  LoaderCircle,
  LocateFixed,
} from "lucide-react";
import type { CornerKey, Corners, Settings } from "../../shared/model";
import { fitCorners } from "../../core/registration";
import { LanguageContext, useT } from "../i18n";
import { localizeMessage } from "../../shared/messages";
import { PrinterIcon } from "./Icons";

export function WorkspacePage({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose(): void;
  className?: string;
}) {
  const t = useT();
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".dropdown"))
        onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <section className={`workspace-page ${className}`} aria-label={title}>
      <nav className="page-navigation">
        <button className="back-button" title={t("back")} onClick={onClose}>
          <ArrowLeft size={24} strokeWidth={2.6} />
        </button>
      </nav>
      <div className="page-content">{children}</div>
    </section>
  );
}
export function SettingsPage({
  settings,
  connected,
  connecting = false,
  onSave,
  onConnect,
  onClose,
  onLanguage,
}: {
  settings: Settings;
  connected: boolean;
  connecting?: boolean;
  onSave(settings: Settings): Promise<void>;
  onConnect(): Promise<void>;
  onClose(): void;
  onLanguage(language: Settings["language"]): void;
}) {
  const t = useT(),
    language = useContext(LanguageContext),
    [draft, setDraft] = useState(settings),
    [showPassword, setShowPassword] = useState(false),
    [busy, setBusy] = useState(false),
    [readingZ, setReadingZ] = useState(false),
    [error, setError] = useState("");
  const connectionChanged =
    draft.host.trim() !== settings.host ||
    draft.username.trim() !== settings.username ||
    draft.password !== settings.password;
  const readContactZ = async () => {
    setReadingZ(true);
    setError("");
    try {
      const contactZ = await window.pcb.readContactZ();
      setDraft((d) => ({ ...d, drawing: { ...d.drawing, contactZ } }));
    } catch (e) {
      setError(localizeMessage((e as Error).message, language));
    } finally {
      setReadingZ(false);
    }
  };
  const field = (
    key: "printerName" | "host" | "username" | "password",
    label: string,
  ) => (
    <label className="setting-row">
      <span>{label}</span>
      <div className="input-wrap">
        <input
          aria-label={label}
          value={draft[key]}
          placeholder={key === "host" ? "192.168.1.100" : undefined}
          type={key === "password" && !showPassword ? "password" : "text"}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        />
        {key === "password" && (
          <button
            type="button"
            className="input-action"
            aria-label={t("password")}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        )}
      </div>
    </label>
  );
  const drawingField = (
    key:
      | "contactZ"
      | "lift"
      | "drawSpeed"
      | "travelSpeed"
      | "zLiftSpeed"
      | "zLowerSpeed",
    label: string,
    help: string,
    unit: string,
  ) => (
    <div className="setting-row drawing-field">
      <label htmlFor={`drawing-${key}`}>{label}</label>
      <div className="drawing-input">
        <div className="input-wrap">
          <input
            id={`drawing-${key}`}
            disabled={key === "contactZ" && readingZ}
            type="number"
            step={key === "contactZ" ? ".001" : ".1"}
            min={
              key === "zLiftSpeed" || key === "zLowerSpeed" ? 0.1 : undefined
            }
            max={key === "zLiftSpeed" || key === "zLowerSpeed" ? 5 : undefined}
            aria-label={label}
            value={Number.isNaN(draft.drawing[key]) ? "" : draft.drawing[key]}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                drawing: {
                  ...d.drawing,
                  [key]: e.target.value === "" ? NaN : Number(e.target.value),
                },
              }))
            }
          />
          <span className="unit">{unit}</span>
        </div>
        {key === "contactZ" && (
          <span
            title={t(connected ? "readContactZ" : "readContactZDisconnected")}
          >
            <button
              type="button"
              className="read-position"
              aria-label={t("readContactZ")}
              aria-busy={readingZ}
              disabled={!connected || connecting || busy || readingZ}
              onClick={readContactZ}
            >
              {readingZ ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <LocateFixed size={18} />
              )}
            </button>
          </span>
        )}
      </div>
      <HelpCircle size={17} className="help" aria-label={help}>
        <title>{help}</title>
      </HelpCircle>
    </div>
  );
  const save = async (connect = false) => {
    setBusy(true);
    setError("");
    try {
      await onSave(draft);
      if (connect) await onConnect();
      else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <WorkspacePage
      title={t("settings")}
      onClose={onClose}
      className="settings-page"
    >
      <div className="settings-columns">
        <div>
          <section
            className="general-settings"
            aria-labelledby="general-settings-title"
          >
            <h3 id="general-settings-title">{t("general")}</h3>
            <label className="setting-row language-picker">
              <span>
                <Languages size={18} aria-hidden="true" />
                {t("language")}
              </span>
              <select
                aria-label={t("language")}
                value={draft.language}
                onChange={(e) => {
                  const language = e.target.value as Settings["language"];
                  setDraft((d) => ({ ...d, language }));
                  onLanguage(language);
                }}
              >
                <option value="system">{t("system")}</option>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
          </section>
          <h3>{t("connection")}</h3>
          {field("printerName", t("printerName"))}
          {field("host", t("address"))}
          {field("username", t("username"))}
          {field("password", t("password"))}
          <div className="connection-row">
            <span className={connected ? "connection on" : "connection"}>
              <PrinterIcon
                state={
                  connecting
                    ? "connecting"
                    : connected
                      ? "ready"
                      : "disconnected"
                }
              />
              {connecting
                ? t("connecting")
                : connected
                  ? t("connected")
                  : t("disconnected")}
            </span>
            <button
              className="primary"
              disabled={
                busy ||
                readingZ ||
                connecting ||
                (connected && !connectionChanged)
              }
              onClick={() => void save(true)}
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : null}
              {t("connect")}
            </button>
          </div>
        </div>
        <div>
          <h3>{t("drawing")}</h3>
          {drawingField("contactZ", t("contactZ"), t("contactHelp"), t("mm"))}
          {drawingField("lift", t("lift"), t("liftHelp"), t("mm"))}
          <div className="frame-setting">
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.drawing.frame}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    drawing: { ...d.drawing, frame: e.target.checked },
                  }))
                }
              />
              <span>{t("frame")}</span>
            </label>
            <button
              type="button"
              className="help-tip"
              aria-label={t("frameHelp")}
            >
              <HelpCircle size={17} aria-hidden="true" />
              <span role="tooltip">{t("frameHelp")}</span>
            </button>
          </div>
          <section
            className="speed-settings"
            aria-labelledby="speed-settings-title"
          >
            <h3 id="speed-settings-title">{t("speeds")}</h3>
            {drawingField(
              "drawSpeed",
              t("drawSpeed"),
              t("drawHelp"),
              t("speedUnit"),
            )}
            {drawingField(
              "travelSpeed",
              t("travelSpeed"),
              t("travelHelp"),
              t("speedUnit"),
            )}
            {drawingField(
              "zLiftSpeed",
              t("zLiftSpeed"),
              t("zLiftHelp"),
              t("speedUnit"),
            )}
            {drawingField(
              "zLowerSpeed",
              t("zLowerSpeed"),
              t("zLowerHelp"),
              t("speedUnit"),
            )}
          </section>
        </div>
      </div>
      <div className="settings-footer">
        <button
          className="primary save-button"
          disabled={busy || readingZ}
          onClick={() => void save()}
        >
          {t("save")}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </WorkspacePage>
  );
}
export function BindingPage({
  corners,
  onCapture,
  onReset,
  onClose,
}: {
  corners: Corners;
  onCapture(key: CornerKey): Promise<void>;
  onReset(): Promise<void>;
  onClose(): void;
}) {
  const language = useContext(LanguageContext);
  const t = useT(),
    [busy, setBusy] = useState<CornerKey | "reset" | null>(null),
    [error, setError] = useState("");
  let angle: number | undefined,
    fitError = "";
  if (Object.keys(corners).length === 4)
    try {
      angle = (fitCorners(corners).angle * 180) / Math.PI;
    } catch (e) {
      fitError = (e as Error).message;
    }
  const action = async (key: CornerKey | "reset") => {
    setBusy(key);
    setError("");
    try {
      if (key === "reset") await onReset();
      else await onCapture(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <WorkspacePage
      title={t("binding")}
      onClose={onClose}
      className="binding-page"
    >
      <p className="dialog-hint">{t("cornerHint")}</p>
      <div className="corner-layout">
        <span className="printer-edge rear">{t("rear")}</span>
        <span className="printer-edge front">{t("front")}</span>
        <div className="blank-3d">
          <i />
          <span>
            {angle !== undefined ? `${t("angle")} ${angle.toFixed(2)}°` : "—"}
          </span>
        </div>
        {(["rl", "rr", "fl", "fr"] as CornerKey[]).map((key) => (
          <div className={`corner-card ${key}`} key={key}>
            <div className="corner-label">
              <span className={`corner-dot ${corners[key] ? "captured" : ""}`}>
                {corners[key] && <Check size={17} />}
              </span>
              <strong>
                {t(
                  key === "rl"
                    ? "rearLeft"
                    : key === "rr"
                      ? "rearRight"
                      : key === "fl"
                        ? "frontLeft"
                        : "frontRight",
                )}
              </strong>
            </div>
            <div className="corner-coordinates">
              {corners[key]
                ? `X ${corners[key]![0].toFixed(3)} · Y ${corners[key]![1].toFixed(3)}`
                : "X — · Y —"}
            </div>
            <button disabled={!!busy} onClick={() => void action(key)}>
              {busy === key ? (
                <LoaderCircle size={17} className="spin" />
              ) : null}
              {t(corners[key] ? "recapture" : "capture")}
            </button>
          </div>
        ))}
      </div>
      <div className="corner-progress">
        {[0, 1, 2, 3].map((i) => (
          <span
            className={i < Object.keys(corners).length ? "active" : ""}
            key={i}
          />
        ))}
        <span>{Object.keys(corners).length} / 4</span>
      </div>
      {(error || fitError) && (
        <p className="inline-error" role="alert">
          {localizeMessage(error || fitError, language)}
        </p>
      )}
      <footer>
        <button disabled={!!busy} onClick={() => void action("reset")}>
          {t("reset")}
        </button>
        <button
          className="primary"
          disabled={!!busy || angle === undefined}
          onClick={onClose}
        >
          {t("done")}
        </button>
      </footer>
    </WorkspacePage>
  );
}
