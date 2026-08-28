/**
 * PI CLI「供应商认证」区块。
 * OpenSpec: openspec/changes/add-pi-provider-auth
 *
 * - 订阅授权组：只读状态 + 复制 `pi /login` 引导（不发起 OAuth 流程）。
 * - API Key 组：搜索 / 三态行（configured · env · none）/ 行内编辑器 / 删除二次确认。
 * - 状态为组件局部 state：禁挂根 hook 链、禁轮询（挂载与写操作后刷新）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Globe from "lucide-react/dist/esm/icons/globe";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import Search from "lucide-react/dist/esm/icons/search";

import {
  piAuthDeleteCredential,
  piAuthListProviders,
  piAuthSetApiKey,
  type PiAuthListResult,
  type PiAuthProviderSnapshot,
} from "../../../services/tauri/piAuth";
import {
  piModelsConfigRead,
  piModelsConfigWrite,
  type PiModelsConfigReadResult,
} from "../../../services/tauri/piModelsConfig";
import { requestTerminalCommand } from "../../terminal/utils/terminalCommandRequestEvent";
import {
  PI_AUTH_APIKEY_PROVIDERS,
  PI_AUTH_OAUTH_PROVIDERS,
  type PiAuthUiProvider,
} from "../piAuthProviderCatalog";
import { loadSettingsStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";
import { notifyPiAuthCatalogChanged } from "../piAuthCatalogEvent";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { ProviderBrandIconImg } from "./ProviderBrandIconImg";

function PiAuthBrandIcon({ iconSrc }: { iconSrc: string | null }) {
  if (!iconSrc) {
    return (
      <span className="pi-auth-brand-icon pi-auth-brand-icon-fallback">
        <Globe size={15} strokeWidth={1.8} aria-hidden />
      </span>
    );
  }
  return (
    <span className="pi-auth-brand-icon">
      <ProviderBrandIconImg src={iconSrc} className="pi-auth-brand-icon-img" />
    </span>
  );
}

export function PiProviderAuthSection({ piBin }: { piBin?: string | null }) {
  useFeatureStylesReady(loadSettingsStyles);
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<PiAuthListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftVisible, setDraftVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PiAuthUiProvider | null>(null);
  // ── 自定义供应商（models.json）──
  const [modelsConfig, setModelsConfig] = useState<PiModelsConfigReadResult | null>(null);
  const [modelsEditorOpen, setModelsEditorOpen] = useState(false);
  const [modelsDraft, setModelsDraft] = useState("");
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [authResult, modelsResult] = await Promise.all([
        piAuthListProviders(),
        piModelsConfigRead(),
      ]);
      setSnapshot(authResult);
      setModelsConfig(modelsResult);
      setLoadError(null);
    } catch (error) {
      setLoadError(String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // OAuth 在内嵌终端完成后 auth.json 会变化：窗口重新聚焦时刷新状态（事件驱动，非轮询）。
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const byId = useMemo(() => {
    const map = new Map<string, PiAuthProviderSnapshot>();
    for (const item of snapshot?.providers ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [snapshot]);

  const visibleProviders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return PI_AUTH_APIKEY_PROVIDERS.filter((provider) => {
      if (!showAll && !provider.featured && !normalized) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const envVar = byId.get(provider.id)?.envVar ?? "";
      return (
        provider.name.toLowerCase().includes(normalized) ||
        provider.id.includes(normalized) ||
        envVar.toLowerCase().includes(normalized)
      );
    });
  }, [query, showAll, byId]);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setDraftKey("");
    setDraftVisible(false);
    setActionError(null);
  }, []);

  const openEditor = useCallback(
    (id: string) => {
      if (editingId === id) {
        closeEditor();
        return;
      }
      setEditingId(id);
      setDraftKey("");
      setDraftVisible(false);
      setActionError(null);
    },
    [editingId, closeEditor],
  );

  const handleSave = useCallback(
    async (provider: PiAuthUiProvider) => {
      const key = draftKey.trim();
      if (!key) {
        // 留空 = 取消，不改动凭证。
        closeEditor();
        return;
      }
      setSaving(true);
      setActionError(null);
      try {
        await piAuthSetApiKey(provider.id, key);
        // 后端已失效 Rust 目录缓存；再广播 FE 侧重载，picker/思考档立即收敛。
        notifyPiAuthCatalogChanged();
        closeEditor();
        await refresh();
      } catch (error) {
        setActionError(String(error));
      } finally {
        setSaving(false);
      }
    },
    [draftKey, closeEditor, refresh],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await piAuthDeleteCredential(deleteTarget.id);
      // 同 handleSave：删除后广播 FE 目录重载（目录可能收缩甚至变空）。
      notifyPiAuthCatalogChanged();
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      setDeleteTarget(null);
      setActionError(String(error));
    }
  }, [deleteTarget, refresh]);

  const openModelsEditor = useCallback(() => {
    if (modelsEditorOpen) {
      setModelsEditorOpen(false);
      setModelsDraft("");
      setModelsError(null);
      return;
    }
    // 空文件 / 不存在 → 预填默认示例（不落盘，保存才写入）。
    const existing = modelsConfig?.text ?? "";
    setModelsDraft(existing.trim() ? existing : (modelsConfig?.template ?? ""));
    setModelsError(null);
    setModelsEditorOpen(true);
  }, [modelsEditorOpen, modelsConfig]);

  const handleModelsSave = useCallback(async () => {
    setModelsSaving(true);
    setModelsError(null);
    try {
      await piModelsConfigWrite(modelsDraft);
      // models.json 自定义供应商同样进入 PI 目录，保存后同步 FE 重载。
      notifyPiAuthCatalogChanged();
      setModelsEditorOpen(false);
      setModelsDraft("");
      await refresh();
    } catch (error) {
      setModelsError(String(error));
    } finally {
      setModelsSaving(false);
    }
  }, [modelsDraft, refresh]);

  // pi 的 slash 命令不能走 argv（会被当作 prompt 发给模型）：
  // 两段式 PTY 输入——先启动 pi TUI，就绪后再写入 /login <provider>。
  const handleLaunchLogin = useCallback(
    (provider: (typeof PI_AUTH_OAUTH_PROVIDERS)[number]) => {
      const customBin = piBin?.trim();
      const command = customBin
        ? customBin.includes(" ")
          ? `"${customBin}"`
          : customBin
        : "pi";
      requestTerminalCommand({
        terminalId: `pi-login-${provider.id}`,
        title: `pi /login ${provider.loginArg}`,
        command,
        followUpCommand: `/login ${provider.loginArg}`,
        followUpDelayMs: 1500,
      });
    },
    [piBin],
  );

  const renderState = (provider: PiAuthUiProvider) => {
    const state = byId.get(provider.id)?.state ?? "none";
    if (state === "configured") {
      return (
        <span className="pi-auth-status pi-auth-status-ok">
          <span className="pi-auth-dot" aria-hidden />
          {t("settings.vendor.piAuth.configured", { defaultValue: "已配置" })}
        </span>
      );
    }
    return (
      <span className="pi-auth-status pi-auth-status-idle">
        <span className="pi-auth-dot" aria-hidden />
        {t("settings.vendor.piAuth.notConfigured", { defaultValue: "未配置" })}
      </span>
    );
  };

  const renderEditor = (provider: PiAuthUiProvider) => {
    const snap = byId.get(provider.id);
    return (
      <div className="pi-auth-editor" data-testid={`pi-auth-editor-${provider.id}`}>
        <label className="pi-auth-editor-label" htmlFor={`pi-auth-key-${provider.id}`}>
          {t("settings.vendor.piAuth.keyLabel", {
            name: provider.name,
            defaultValue: `API Key · ${provider.name}`,
          })}
        </label>
        <div className="pi-auth-editor-input-row">
          <div className="pi-auth-editor-input-box">
            <input
              id={`pi-auth-key-${provider.id}`}
              type={draftVisible ? "text" : "password"}
              value={draftKey}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDraftKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSave(provider);
                } else if (event.key === "Escape") {
                  closeEditor();
                }
              }}
              placeholder={
                snap?.state === "configured"
                  ? t("settings.vendor.piAuth.keyPlaceholderKeep", {
                      mask: snap.maskedKey ?? "",
                      defaultValue: `${snap.maskedKey ?? ""}（留空保持不变）`,
                    })
                  : t("settings.vendor.piAuth.keyPlaceholderNew", {
                      env: snap?.envVar ?? "",
                      defaultValue: `粘贴 ${snap?.envVar ?? "API Key"}，例如 sk-…`,
                    })
              }
            />
            <button
              type="button"
              className="vendor-btn-icon pi-auth-eye"
              onClick={() => setDraftVisible((visible) => !visible)}
              title={t("settings.vendor.piAuth.toggleKeyVisibility", {
                defaultValue: "显示 / 隐藏",
              })}
            >
              {draftVisible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            </button>
          </div>
        </div>
        <p className="pi-auth-editor-tips">
          {t("settings.vendor.piAuth.advancedTipPrefix", {
            defaultValue: "高级用法：key 支持",
          })}
          <code>!command</code>
          {t("settings.vendor.piAuth.advancedTipMiddle", {
            defaultValue: " 执行密钥工具（如 !op read 'op://vault/item'）与 ",
          })}
          <code>$ENV_VAR</code>
          {t("settings.vendor.piAuth.advancedTipSuffix", {
            defaultValue: " 环境变量插值；留空则保持现有凭证。",
          })}
        </p>
        {actionError && editingId === provider.id ? (
          <p className="pi-auth-editor-error" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="pi-auth-editor-actions">
          <button
            type="button"
            className="vendor-btn-danger-solid pi-auth-save"
            disabled={saving}
            onClick={() => void handleSave(provider)}
          >
            {saving
              ? t("settings.vendor.piAuth.saving", { defaultValue: "保存中…" })
              : t("settings.vendor.piAuth.save", { defaultValue: "保存" })}
          </button>
          <button type="button" className="vendor-btn-cancel" onClick={closeEditor}>
            {t("settings.vendor.cancel", { defaultValue: "取消" })}
          </button>
          <span className="pi-auth-save-hint">
            {t("settings.vendor.piAuth.saveHint", {
              defaultValue: "保存后写入 ~/.pi/agent/auth.json（0600 权限）",
            })}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="pi-auth-section" data-testid="pi-auth-section">
      {/* ── 订阅授权（只读 + 终端引导） ── */}
      <div className="pi-auth-subhead">
        <span className="pi-auth-subhead-title">
          {t("settings.vendor.piAuth.oauthTitle", { defaultValue: "订阅授权" })}
        </span>
        <span className="pi-auth-subhead-hint">
          {t("settings.vendor.piAuth.oauthHint", {
            defaultValue: "OAuth 登录，token 自动刷新，存储于 auth.json",
          })}
        </span>
      </div>
      <div className="vendor-group-card">
        {PI_AUTH_OAUTH_PROVIDERS.map((provider) => {
          const subscribed = byId.get(provider.id)?.oauthSubscribed ?? false;
          return (
            <div className="pi-auth-row" key={provider.id}>
              <PiAuthBrandIcon iconSrc={provider.iconSrc} />
              <div className="pi-auth-row-copy">
                <div className="pi-auth-row-name">{provider.name}</div>
                <div className="pi-auth-row-desc">
                  {t(`settings.vendor.piAuth.oauthDesc.${provider.descKey}`, {
                    defaultValue: provider.name,
                  })}
                </div>
              </div>
              <div className="pi-auth-row-right">
                {subscribed ? (
                  <span className="pi-auth-status pi-auth-status-ok">
                    <span className="pi-auth-dot" aria-hidden />
                    {t("settings.vendor.piAuth.subscribed", {
                      defaultValue: "已授权 · 自动刷新",
                    })}
                  </span>
                ) : (
                  <span className="pi-auth-status pi-auth-status-idle">
                    <span className="pi-auth-dot" aria-hidden />
                    {t("settings.vendor.piAuth.notSubscribed", {
                      defaultValue: "未授权",
                    })}
                  </span>
                )}
                <button
                  type="button"
                  className="vendor-btn-cancel pi-auth-login-btn"
                  onClick={() => handleLaunchLogin(provider)}
                  title={`pi /login ${provider.loginArg}`}
                >
                  <LogIn size={13} aria-hidden />
                  {t("settings.vendor.piAuth.login", { defaultValue: "登录" })}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── API Key ── */}
      <div className="pi-auth-subhead">
        <span className="pi-auth-subhead-title">
          {t("settings.vendor.piAuth.apiKeyTitle", { defaultValue: "API Key" })}
        </span>
        <span className="pi-auth-subhead-hint">
          {t("settings.vendor.piAuth.apiKeyHint", {
            defaultValue: "写入 ~/.pi/agent/auth.json · 优先级高于环境变量",
          })}
        </span>
        <span className="pi-auth-subhead-spacer" />
        <div className="pi-auth-search">
          <Search size={13} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.vendor.piAuth.searchPlaceholder", {
              defaultValue: "筛选供应商…",
            })}
          />
        </div>
      </div>
      <div className="vendor-group-card">
        {loadError ? (
          <div className="pi-auth-row pi-auth-row-message" role="alert">
            {t("settings.vendor.piAuth.loadFailed", { defaultValue: "读取认证状态失败" })}
            ：{loadError}
          </div>
        ) : null}
        {visibleProviders.map((provider) => {
          const snap = byId.get(provider.id);
          const state = snap?.state ?? "none";
          const expanded = editingId === provider.id;
          return (
            <div key={provider.id} className="pi-auth-provider">
              <div className={`pi-auth-row${expanded ? " pi-auth-row-expanded" : ""}`}>
                <PiAuthBrandIcon iconSrc={provider.iconSrc} />
                <div className="pi-auth-row-copy">
                  <div className="pi-auth-row-name">{provider.name}</div>
                  <div className="pi-auth-row-desc">
                    <code className="pi-auth-env-chip">{snap?.envVar ?? "—"}</code>
                  </div>
                </div>
                <div className="pi-auth-row-right">
                  {renderState(provider)}
                  {state === "configured" && snap?.maskedKey ? (
                    <code className="pi-auth-mask-chip">{snap.maskedKey}</code>
                  ) : null}
                  {state === "configured" ? (
                    <>
                      <button
                        type="button"
                        className="vendor-btn-icon pi-auth-text-btn"
                        onClick={() => openEditor(provider.id)}
                      >
                        {expanded
                          ? t("settings.vendor.piAuth.collapse", { defaultValue: "收起" })
                          : t("settings.vendor.piAuth.edit", { defaultValue: "编辑" })}
                      </button>
                      <button
                        type="button"
                        className="vendor-btn-icon pi-auth-text-btn pi-auth-text-btn-danger"
                        onClick={() => setDeleteTarget(provider)}
                      >
                        {t("settings.vendor.piAuth.delete", { defaultValue: "删除" })}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="vendor-btn-cancel pi-auth-login-btn"
                      onClick={() => openEditor(provider.id)}
                    >
                      {expanded
                        ? t("settings.vendor.piAuth.collapse", { defaultValue: "收起" })
                        : t("settings.vendor.piAuth.setKey", {
                            defaultValue: "设置 Key",
                          })}
                    </button>
                  )}
                </div>
              </div>
              {expanded ? renderEditor(provider) : null}
            </div>
          );
        })}
        {!loadError && visibleProviders.length === 0 ? (
          <div className="pi-auth-row pi-auth-row-message">
            {t("settings.vendor.piAuth.emptySearch", {
              query,
              defaultValue: `没有匹配「${query}」的供应商`,
            })}
          </div>
        ) : null}
        {!query.trim() ? (
          <button
            type="button"
            className="pi-auth-row pi-auth-row-toggle"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? t("settings.vendor.piAuth.showLess", { defaultValue: "收起非常用供应商" })
              : t("settings.vendor.piAuth.showAll", {
                  count: PI_AUTH_APIKEY_PROVIDERS.length,
                  defaultValue: `显示全部 ${PI_AUTH_APIKEY_PROVIDERS.length} 个供应商`,
                })}
          </button>
        ) : null}
        <div className="pi-auth-foot">
          <code>{snapshot?.authFile.path ?? "~/.pi/agent/auth.json"}</code>
          <span className="pi-auth-perm-badge">0600</span>
          <span className="pi-auth-foot-spacer" />
          <span className="pi-auth-foot-prio">
            {t("settings.vendor.piAuth.resolutionOrder", {
              defaultValue: "解析顺序：--api-key → auth.json → 环境变量 → models.json",
            })}
          </span>
        </div>
      </div>

      {/* ── 自定义供应商（models.json） ── */}
      <div className="pi-auth-subhead">
        <span className="pi-auth-subhead-title">
          {t("settings.vendor.piAuth.customTitle", { defaultValue: "自定义供应商" })}
        </span>
        <span className="pi-auth-subhead-hint">
          {t("settings.vendor.piAuth.customHint", {
            defaultValue: "写入 ~/.pi/agent/models.json · 中转站 / 自定义模型",
          })}
        </span>
        <span className="pi-auth-subhead-spacer" />
        <button
          type="button"
          className="vendor-btn-cancel pi-auth-login-btn"
          onClick={openModelsEditor}
        >
          {modelsEditorOpen
            ? t("settings.vendor.piAuth.collapse", { defaultValue: "收起" })
            : t("settings.vendor.piAuth.editConfig", { defaultValue: "编辑配置" })}
        </button>
      </div>
      <div className="vendor-group-card">
        {modelsConfig?.parseError ? (
          <div className="pi-auth-row pi-auth-row-message" role="alert">
            {t("settings.vendor.piAuth.customParseError", {
              defaultValue: "models.json 解析失败，可在下方编辑修复",
            })}
            ：{modelsConfig.parseError}
          </div>
        ) : null}
        {(modelsConfig?.providers ?? []).map((provider) => (
          <div className="pi-auth-row" key={provider.id}>
            <PiAuthBrandIcon iconSrc={null} />
            <div className="pi-auth-row-copy">
              <div className="pi-auth-row-name">{provider.name ?? provider.id}</div>
              <div className="pi-auth-row-desc">
                <code className="pi-auth-env-chip">
                  {provider.baseUrl ?? provider.id}
                </code>
              </div>
            </div>
            <div className="pi-auth-row-right">
              {provider.api ? (
                <code className="pi-auth-mask-chip">{provider.api}</code>
              ) : null}
              <span className="pi-auth-status pi-auth-status-idle">
                {t("settings.vendor.piAuth.customModelCount", {
                  count: provider.modelCount,
                  defaultValue: `${provider.modelCount} 个模型`,
                })}
              </span>
              <span
                className={`pi-auth-status ${
                  provider.hasApiKey ? "pi-auth-status-ok" : "pi-auth-status-idle"
                }`}
              >
                <span className="pi-auth-dot" aria-hidden />
                {provider.hasApiKey
                  ? t("settings.vendor.piAuth.customHasKey", { defaultValue: "含 Key" })
                  : t("settings.vendor.piAuth.customNoKey", { defaultValue: "无 Key" })}
              </span>
            </div>
          </div>
        ))}
        {modelsConfig && modelsConfig.providers.length === 0 && !modelsConfig.parseError ? (
          <div className="pi-auth-row pi-auth-row-message">
            {modelsConfig.file.exists
              ? t("settings.vendor.piAuth.customEmpty", {
                  defaultValue: "尚未定义自定义供应商",
                })
              : t("settings.vendor.piAuth.customMissing", {
                  defaultValue: "models.json 不存在，点击「编辑配置」从示例模板开始",
                })}
          </div>
        ) : null}
        {modelsEditorOpen ? (
          <div className="pi-auth-editor" data-testid="pi-models-config-editor">
            <label className="pi-auth-editor-label" htmlFor="pi-models-config-text">
              {t("settings.vendor.piAuth.customEditorLabel", {
                defaultValue: "models.json · 整段 JSON（支持注释）",
              })}
            </label>
            <textarea
              id="pi-models-config-text"
              className="pi-auth-textarea"
              value={modelsDraft}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              rows={16}
              onChange={(event) => setModelsDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  openModelsEditor();
                }
              }}
            />
            <p className="pi-auth-editor-tips">
              {t("settings.vendor.piAuth.customEditorTips", {
                defaultValue:
                  "宽松校验：仅检查 JSON 结构，未知字段保留。apiKey 支持明文、$ENV_VAR 与 !command。",
              })}
            </p>
            {modelsError ? (
              <p className="pi-auth-editor-error" role="alert">
                {modelsError}
              </p>
            ) : null}
            <div className="pi-auth-editor-actions">
              <button
                type="button"
                className="vendor-btn-danger-solid pi-auth-save"
                disabled={modelsSaving}
                onClick={() => void handleModelsSave()}
              >
                {modelsSaving
                  ? t("settings.vendor.piAuth.saving", { defaultValue: "保存中…" })
                  : t("settings.vendor.piAuth.save", { defaultValue: "保存" })}
              </button>
              <button
                type="button"
                className="vendor-btn-cancel"
                onClick={openModelsEditor}
              >
                {t("settings.vendor.cancel", { defaultValue: "取消" })}
              </button>
              <span className="pi-auth-save-hint">
                {t("settings.vendor.piAuth.customSaveHint", {
                  defaultValue: "保存后写入 ~/.pi/agent/models.json（0600 权限）",
                })}
              </span>
            </div>
          </div>
        ) : null}
        <div className="pi-auth-foot">
          <code>{modelsConfig?.file.path ?? "~/.pi/agent/models.json"}</code>
          <span className="pi-auth-perm-badge">0600</span>
        </div>
      </div>

      <DeleteConfirmDialog
        isOpen={deleteTarget !== null}
        providerName={deleteTarget?.name ?? ""}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
