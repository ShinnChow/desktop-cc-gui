import { invoke } from "@tauri-apps/api/core";

/**
 * PI CLI 供应商认证（`~/.pi/agent/auth.json`）。
 * OpenSpec: openspec/changes/add-pi-provider-auth
 *
 * 安全边界：完整 API key 永不回传前端，list 只携带 mask 后的展示串。
 */

export type PiAuthProviderState = "configured" | "none";

export type PiAuthKeySource = "literal" | "command" | "envRef";

export interface PiAuthProviderSnapshot {
  id: string;
  envVar: string | null;
  state: PiAuthProviderState;
  maskedKey?: string;
  keySource?: PiAuthKeySource;
  oauthSubscribed: boolean;
}

export interface PiAuthListResult {
  authFile: { path: string; exists: boolean };
  providers: PiAuthProviderSnapshot[];
}

export async function piAuthListProviders(): Promise<PiAuthListResult> {
  return invoke<PiAuthListResult>("pi_auth_list_providers");
}

export async function piAuthSetApiKey(
  providerId: string,
  key: string,
): Promise<void> {
  return invoke<void>("pi_auth_set_api_key", { providerId, key });
}

export async function piAuthDeleteCredential(
  providerId: string,
): Promise<void> {
  return invoke<void>("pi_auth_delete_credential", { providerId });
}
