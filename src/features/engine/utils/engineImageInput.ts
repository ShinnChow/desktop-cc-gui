import type { EngineType } from "../../../types";
import { formatByteSize } from "../../../utils/formatting";
import { isEngineCapabilityAvailable } from "../engineCapabilityMatrix";

/** Keep aligned with `GROK_MAX_IMAGE_BYTES` in `src-tauri/src/engine/grok.rs`. */
export const GROK_IMAGE_INPUT_MAX_BYTES = 2 * 1024 * 1024;
/** Keep aligned with `DSH_MAX_IMAGE_BYTES` in `src-tauri/src/engine/dsh/session.rs`. */
export const DSH_IMAGE_INPUT_MAX_BYTES = 5 * 1024 * 1024;

const ENGINE_IMAGE_INPUT_MAX_BYTES: Partial<Record<EngineType, number>> = {
  grok: GROK_IMAGE_INPUT_MAX_BYTES,
  dsh: DSH_IMAGE_INPUT_MAX_BYTES,
};

const ENGINE_IMAGE_LABEL: Record<EngineType, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  grok: "Grok CLI",
  kimi: "Kimi CLI",
  opencode: "OpenCode",
  pi: "PI CLI",
  omp: "OMP CLI",
  dsh: "DeepSeek Harness",
  qoder: "Qoder CLI",
};

/**
 * Spec matrix projection for `image.input`.
 * All current engines support image attachments (transport differs per CLI).
 */
export function engineSupportsImageInput(
  engine: EngineType | null | undefined,
): boolean {
  if (!engine) {
    // Unknown engine: do not block; backend will apply its own gate.
    return true;
  }
  return isEngineCapabilityAvailable(engine, "image.input");
}

export function getEngineImageInputLabel(engine: EngineType): string {
  return ENGINE_IMAGE_LABEL[engine] ?? engine;
}

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function formatEngineImageInputUnsupportedMessage(
  engine: EngineType,
  translate?: TranslateFn,
): string {
  const engineLabel = getEngineImageInputLabel(engine);
  const fallback = `${engineLabel} does not support image input in this release`;
  if (!translate) {
    return fallback;
  }
  return translate("messages.imageInputUnsupported", {
    engine: engineLabel,
    defaultValue: fallback,
  });
}

export function sanitizeImageAttachmentPaths(images: string[]): string[] {
  return Array.from(
    new Set(
      images
        .map((imagePath) => imagePath.trim())
        .filter((imagePath) => imagePath.length > 0),
    ),
  );
}

export function getEngineImageInputMaxBytes(
  engine: EngineType | null | undefined,
): number | null {
  if (!engine) {
    return null;
  }
  return ENGINE_IMAGE_INPUT_MAX_BYTES[engine] ?? null;
}

/** Decoded-byte estimate for data URLs. Filesystem paths return null. */
export function estimateImageAttachmentBytes(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("data:")) {
    return null;
  }
  const comma = trimmed.indexOf(",");
  if (comma < 0) {
    return 0;
  }
  const payload = trimmed.slice(comma + 1).replace(/\s+/g, "");
  if (!payload) {
    return 0;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function findOversizedImageAttachment(
  images: string[],
  engine: EngineType | null | undefined,
): { bytes: number; maxBytes: number } | null {
  const maxBytes = getEngineImageInputMaxBytes(engine);
  if (maxBytes == null) {
    return null;
  }
  let oversized: { bytes: number; maxBytes: number } | null = null;
  for (const image of images) {
    const bytes = estimateImageAttachmentBytes(image);
    if (bytes != null && bytes > maxBytes) {
      if (!oversized || bytes > oversized.bytes) {
        oversized = { bytes, maxBytes };
      }
    }
  }
  return oversized;
}

export function acceptImagesWithinEngineLimit(
  images: string[],
  engine: EngineType | null | undefined,
): {
  accepted: string[];
  rejected: { bytes: number; maxBytes: number } | null;
} {
  const rejected = findOversizedImageAttachment(images, engine);
  if (!rejected) {
    return { accepted: images, rejected: null };
  }
  const maxBytes = rejected.maxBytes;
  return {
    accepted: images.filter((image) => {
      const bytes = estimateImageAttachmentBytes(image);
      return bytes == null || bytes <= maxBytes;
    }),
    rejected,
  };
}

export function formatEngineImageTooLargeMessage(
  engine: EngineType,
  bytes: number,
  maxBytes: number,
  translate?: TranslateFn,
): string {
  const engineLabel = getEngineImageInputLabel(engine);
  const size = formatByteSize(bytes) ?? `${bytes} B`;
  const maxSize = formatByteSize(maxBytes) ?? `${maxBytes} B`;
  const fallback = `${engineLabel} accepts images up to ${maxSize}. This one is about ${size}. Compress or crop it and try again.`;
  if (!translate) {
    return fallback;
  }
  return translate("messages.imageInputTooLarge", {
    engine: engineLabel,
    size,
    maxSize,
    defaultValue: fallback,
  });
}
