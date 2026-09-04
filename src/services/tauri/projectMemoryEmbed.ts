import { invoke } from "@tauri-apps/api/core";

export type ProjectMemoryEmbedHealthDto = {
  status: "available" | "unavailable" | "error" | string;
  reason?: string | null;
  /** 模型文件缺失时可触发前端下载 */
  downloadable: boolean;
  providerId: string;
  modelId: string;
  embeddingVersion: string;
  dimensions: number;
  /** 已加载的 onnx 路径 */
  modelPath?: string | null;
  /** 标准存放目录 ~/.ccgui/models/embedding */
  modelDir?: string | null;
};

export type ProjectMemoryEmbedResultDto = {
  vector: number[];
  dimensions: number;
  embeddingVersion: string;
  modelId: string;
};

export type ProjectMemoryEmbedIndexRecordDto = {
  workspaceId: string;
  memoryId: string;
  providerId: string;
  modelId: string;
  embeddingVersion: string;
  dimensions: number;
  contentHash: string;
  vector: number[];
  memoryUpdatedAt: number;
  indexedAt: number;
};

export async function projectMemoryEmbedHealth(): Promise<ProjectMemoryEmbedHealthDto> {
  return invoke<ProjectMemoryEmbedHealthDto>("project_memory_embed_health");
}

export async function projectMemoryEmbedDownload(): Promise<ProjectMemoryEmbedHealthDto> {
  return invoke<ProjectMemoryEmbedHealthDto>("project_memory_embed_download");
}

/** 删除 ~/.ccgui/models/embedding 下的本地语义模型 */
export async function projectMemoryEmbedRemove(): Promise<ProjectMemoryEmbedHealthDto> {
  return invoke<ProjectMemoryEmbedHealthDto>("project_memory_embed_remove");
}

export async function projectMemoryEmbedText(
  text: string,
): Promise<ProjectMemoryEmbedResultDto> {
  return invoke<ProjectMemoryEmbedResultDto>("project_memory_embed_text", {
    text,
  });
}

export async function projectMemoryEmbedIndexList(
  workspaceId: string,
): Promise<ProjectMemoryEmbedIndexRecordDto[]> {
  return invoke<ProjectMemoryEmbedIndexRecordDto[]>(
    "project_memory_embed_index_list",
    { workspaceId },
  );
}

export async function projectMemoryEmbedIndexUpsert(
  workspaceId: string,
  records: ProjectMemoryEmbedIndexRecordDto[],
): Promise<void> {
  return invoke("project_memory_embed_index_upsert", {
    workspaceId,
    records,
  });
}

export async function projectMemoryEmbedIndexDelete(
  workspaceId: string,
  memoryIds: string[],
): Promise<void> {
  return invoke("project_memory_embed_index_delete", {
    workspaceId,
    memoryIds,
  });
}


