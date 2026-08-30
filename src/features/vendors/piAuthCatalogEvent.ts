export const PI_AUTH_CATALOG_CHANGED_EVENT = "ccgui:pi-auth-catalog-changed";

/**
 * PI 供应商凭证（auth.json 写入/删除）或 models.json 配置保存成功后调用。
 * 后端命令已同步失效 Rust 侧目录缓存（invalidate_engine_models）；本事件
 * 通知 FE 引擎控制器强制重载 PI 目录并清空其状态副本中的旧 models——
 * 否则 engineStatuses / engineCatalogsByEngine / engineModels 三层会话级
 * 缓存要等下次切换/翻转/重启才收敛，picker 会继续展示已删 provider 的模型。
 */
export function notifyPiAuthCatalogChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(PI_AUTH_CATALOG_CHANGED_EVENT));
}
