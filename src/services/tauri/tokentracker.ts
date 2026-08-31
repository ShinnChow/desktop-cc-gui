import { invoke } from "@tauri-apps/api/core";
import type { TtCliStatus, TtInstallResult, TtServerStatus } from "../../types";

export async function ttDetectCli(): Promise<TtCliStatus> {
  return invoke("tt_detect_cli");
}



export async function ttInstallCli(): Promise<TtInstallResult> {
  return invoke("tt_install_cli");
}

export async function ttEnsureServer(): Promise<TtServerStatus> {
  return invoke("tt_ensure_server");
}


