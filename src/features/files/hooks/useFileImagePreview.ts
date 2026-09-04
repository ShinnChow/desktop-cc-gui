import {
  useCallback,
  useEffect,
  useState,
  type SyntheticEvent,
} from "react";
import type { TFunction } from "i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readLocalImageDataUrl } from "../../../services/tauri";

export function useFileImagePreview({
  absolutePath,
  isImage,
  workspaceId,
  t,
}: {
  absolutePath: string;
  isImage: boolean;
  workspaceId: string;
  t: TFunction;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);

  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    sizeBytes: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageSrc(null);
    setImageInfo(null);
    setImageLoadError(null);
    if (!isImage) return;

    const fallbackToAssetUrl = () => {
      try {
        return convertFileSrc(absolutePath);
      } catch {
        return null;
      }
    };

    readLocalImageDataUrl(workspaceId, absolutePath)
      .then((dataUrl) => {
        if (cancelled) return;
        setImageSrc(dataUrl ?? fallbackToAssetUrl());
      })
      .catch(() => {
        if (cancelled) return;
        setImageSrc(fallbackToAssetUrl());
      });

    return () => {
      cancelled = true;
    };
  }, [absolutePath, isImage, workspaceId]);

  useEffect(() => {
    setImageInfo(null);
    if (!imageSrc) return;
    let cancelled = false;
    fetch(imageSrc)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to read image bytes: ${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (!cancelled) {
          setImageInfo((prev) =>
            prev
              ? { ...prev, sizeBytes: blob.size }
              : { width: 0, height: 0, sizeBytes: blob.size },
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImageInfo(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  const handleImageLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageLoadError(null);
    setImageInfo((prev) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
      sizeBytes: prev?.sizeBytes ?? null,
    }));
  }, []);
  const handleImageError = useCallback(() => {
    setImageInfo(null);
    setImageLoadError(t("files.imagePreviewLoadFailed"));
  }, [t]);

  return {
    imageSrc,
    imageLoadError,
    imageInfo,
    handleImageLoad,
    handleImageError,
  };
}
