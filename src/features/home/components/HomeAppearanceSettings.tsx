import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useHomeAppearance } from "../hooks/useHomeAppearance";
import { DEFAULT_HOME_APPEARANCE, readHomeLogo, type HomeAppearance } from "../utils/homeAppearance";

/** Embedded in Settings → Appearance; Home itself only renders the wordmark. */
export function HomeAppearanceSettings() {
  const { t } = useTranslation();
  const { appearance, saveAppearance } = useHomeAppearance();
  const id = useId();
  const [draft, setDraft] = useState(appearance);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const uploadVersion = useRef(0);
  useEffect(() => () => { uploadVersion.current++; }, []);
  useEffect(() => { setDraft(appearance); }, [appearance]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query?.matches ?? false);
    update();
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(appearance);
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_HOME_APPEARANCE);
  const motionMode = !draft.particles ? "off" : draft.respectReducedMotion ? "system" : "on";

  function replaceDraft(value: HomeAppearance) {
    uploadVersion.current++;
    setLoading(false);
    setError(false);
    setDraft(value);
  }

  async function uploadLogo(file: File) {
    const version = ++uploadVersion.current;
    setLoading(true);
    setError(false);
    try {
      const logoDataUrl = await readHomeLogo(file);
      if (version === uploadVersion.current) setDraft((prev) => ({ ...prev, logoDataUrl }));
    } catch {
      if (version === uploadVersion.current) setError(true);
    } finally {
      if (version === uploadVersion.current) setLoading(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!loading) saveAppearance(draft);
  }

  return (
    <form className="settings-basic-group-card settings-basic-group-card--list settings-pref-card settings-home-appearance"
      aria-labelledby={`${id}-heading`} onSubmit={save}>
      <div className="settings-pref-row">
        <div className="settings-pref-meta">
          <h3 className="settings-pref-title" id={`${id}-heading`}>{t("homeChat.appearance.customize")}</h3>
          <p className="settings-pref-desc">{t("homeChat.appearance.description")}</p>
        </div>
      </div>
      <div className="settings-pref-row">
        <label className="settings-pref-title" htmlFor={`${id}-title`}>{t("homeChat.appearance.title")}</label>
        <div className="settings-pref-control">
          <input className="settings-input" id={`${id}-title`} value={draft.title} maxLength={80}
            placeholder={t("homeChat.minimalTitle")}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </div>
      </div>
      <div className="settings-pref-row">
        <label className="settings-pref-title" htmlFor={`${id}-font`}>{t("homeChat.appearance.font")}</label>
        <div className="settings-pref-control">
          <select className="settings-pref-select" id={`${id}-font`} value={draft.titleStyle}
            onChange={(event) => setDraft({ ...draft, titleStyle: event.target.value as HomeAppearance["titleStyle"] })}>
            <option value="system">{t("homeChat.appearance.system")}</option>
            <option value="serif">{t("homeChat.appearance.serif")}</option>
            <option value="mono">{t("homeChat.appearance.mono")}</option>
          </select>
        </div>
      </div>
      <div className="settings-pref-row settings-pref-row--stack">
        <div className="settings-pref-row-main">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor={`${id}-logo`}>{t("homeChat.appearance.logo")}</label>
            <p className="settings-pref-desc">{t("homeChat.appearance.logoHint")}</p>
          </div>
          <div className="settings-pref-control settings-home-logo-control">
            {draft.logoDataUrl && <img src={draft.logoDataUrl} alt={t("homeChat.appearance.logo")} />}
            <input id={`${id}-logo`} type="file" accept="image/png,image/jpeg,image/webp"
              disabled={loading} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadLogo(file);
              }} />
          </div>
        </div>
        {draft.logoDataUrl && <button type="button" className="settings-pref-reset"
          onClick={() => replaceDraft({ ...draft, logoDataUrl: "" })}>
          {t("homeChat.appearance.engineLogo")}
        </button>}
        {loading && <p className="settings-pref-hint" role="status">{t("homeChat.appearance.loading")}</p>}
        {error && <p role="alert" className="settings-home-appearance-error">{t("homeChat.appearance.logoError")}</p>}
      </div>
      <div className="settings-pref-row settings-pref-row--stack">
        <div className="settings-pref-row-main">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor={`${id}-particles`}>{t("homeChat.appearance.particles")}</label>
            <p className="settings-pref-desc">{t("homeChat.appearance.motionHint")}</p>
          </div>
          <div className="settings-pref-control">
            <select className="settings-pref-select" id={`${id}-particles`} value={motionMode}
              onChange={(event) => setDraft({ ...draft, particles: event.target.value !== "off",
                respectReducedMotion: event.target.value !== "on" })}>
              <option value="on">{t("homeChat.appearance.motionOn")}</option>
              <option value="system">{t("homeChat.appearance.motionSystem")}</option>
              <option value="off">{t("homeChat.appearance.motionOff")}</option>
            </select>
          </div>
        </div>
        {motionMode === "system" && reducedMotion && <p className="settings-pref-hint" role="status">
          {t("homeChat.appearance.motionPaused")}
        </p>}
      </div>
      {draft.particles && <>
        <div className="settings-pref-row">
          <label className="settings-pref-title" htmlFor={`${id}-density`}>{t("homeChat.appearance.density")}</label>
          <div className="settings-pref-control">
            <select className="settings-pref-select" id={`${id}-density`} value={draft.spacing}
              onChange={(event) => setDraft({ ...draft, spacing: Number(event.target.value) })}>
              <option value={1}>{t("homeChat.appearance.dense")}</option>
              <option value={2}>{t("homeChat.appearance.balanced")}</option>
              <option value={3}>{t("homeChat.appearance.sparse")}</option>
            </select>
          </div>
        </div>
        <div className="settings-pref-row">
          <label className="settings-pref-title" htmlFor={`${id}-color-mode`}>{t("homeChat.appearance.color")}</label>
          <div className="settings-pref-control">
            <select className="settings-pref-select" id={`${id}-color-mode`} value={draft.colorMode}
              onChange={(event) => setDraft({ ...draft, colorMode: event.target.value as HomeAppearance["colorMode"] })}>
              <option value="theme">{t("homeChat.appearance.theme")}</option>
              <option value="custom">{t("homeChat.appearance.customColor")}</option>
            </select>
            {draft.colorMode === "custom" && <input type="color" value={draft.color}
              aria-label={t("homeChat.appearance.customColor")}
              onChange={(event) => setDraft({ ...draft, color: event.target.value })} />}
          </div>
        </div>
      </>}
      {(dirty || !isDefault || loading || error) && <div className="settings-pref-row settings-home-appearance-actions">
        {!isDefault && <button type="button" className="settings-pref-reset"
          onClick={() => replaceDraft(DEFAULT_HOME_APPEARANCE)}>{t("homeChat.appearance.reset")}</button>}
        <div className="settings-pref-control">
          {(dirty || loading || error) && <button type="button" className="settings-web-btn"
            onClick={() => replaceDraft(appearance)}>{t("homeChat.appearance.cancel")}</button>}
          {dirty && <button type="submit" className="settings-web-btn settings-web-btn--primary" disabled={loading}>
            {t("homeChat.appearance.apply")}
          </button>}
        </div>
      </div>}
    </form>
  );
}
