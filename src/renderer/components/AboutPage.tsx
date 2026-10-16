import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { project, type UpdateResult } from "../../shared/project";
import { useT } from "../i18n";
import { Logo } from "./Icons";
import { WorkspacePage } from "./Pages";
export function AboutPage({
  checkOnOpen,
  onClose,
}: {
  checkOnOpen: number;
  onClose(): void;
}) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [failed, setFailed] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await window.pcb.checkUpdates());
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (checkOnOpen) void check();
  }, [checkOnOpen, check]);
  const open = async (page: "repository" | "releases") => {
    try {
      await window.pcb.openProjectPage(page);
    } catch {
      setFailed(true);
    }
  };
  return (
    <WorkspacePage title={t("about")} className="about-page" onClose={onClose}>
      <div className="about-content">
        <div className="about-logo">
          <Logo />
        </div>
        <h1>{project.name}</h1>
        <dl>
          <div>
            <dt>{t("version")}</dt>
            <dd>{__APP_VERSION__}</dd>
          </div>
          <div>
            <dt>{t("author")}</dt>
            <dd>{project.author}</dd>
          </div>
        </dl>
        <div className="about-actions">
          <button onClick={() => void open("repository")}>
            <ExternalLink size={18} />
            {t("projectPage")}
          </button>
        </div>
        <div className="update-result" role="status" aria-live="polite">
          {checking ? (
            t("checkingUpdates")
          ) : failed ? (
            t("updateFailed")
          ) : result?.status === "available" ? (
            <>
              <p>
                {t("updateAvailable")} {result.version}
              </p>
              <button onClick={() => void open("releases")}>
                {t("downloadUpdate")}
                <ExternalLink size={16} />
              </button>
            </>
          ) : result?.status === "current" ? (
            t("upToDate")
          ) : result?.status === "unpublished" ? (
            t("noReleases")
          ) : null}
        </div>
        <small>© {project.author} · MIT</small>
      </div>
    </WorkspacePage>
  );
}
