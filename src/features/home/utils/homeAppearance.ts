export const HOME_APPEARANCE_KEY = "home.wordmarkAppearance";
export const MAX_LOGO_BYTES = 512 * 1024;

export type HomeAppearance = {
  title: string;
  titleStyle: "system" | "serif" | "mono";
  logoDataUrl: string;
  particles: boolean;
  respectReducedMotion: boolean;
  colorMode: "theme" | "custom";
  color: string;
  spacing: number;
};

export const DEFAULT_HOME_APPEARANCE: HomeAppearance = {
  title: "",
  titleStyle: "system",
  logoDataUrl: "",
  particles: true,
  respectReducedMotion: true,
  colorMode: "theme",
  color: "#6c31e3",
  spacing: 2,
};

export function sanitizeHomeAppearance(value: unknown): HomeAppearance {
  const input = value && typeof value === "object"
    ? value as Record<string, unknown> : {};
  return {
    title: typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim().slice(0, 80) : "",
    titleStyle: input.titleStyle === "serif" || input.titleStyle === "mono" ? input.titleStyle : "system",
    logoDataUrl: typeof input.logoDataUrl === "string"
      && input.logoDataUrl.length <= Math.ceil(MAX_LOGO_BYTES * 4 / 3) + 64
      && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.logoDataUrl)
      ? input.logoDataUrl : "",
    particles: typeof input.particles === "boolean" ? input.particles : true,
    respectReducedMotion: input.respectReducedMotion !== false,
    colorMode: input.colorMode === "custom" ? "custom" : "theme",
    color: typeof input.color === "string" && /^#[0-9a-f]{6}$/i.test(input.color)
      ? input.color : DEFAULT_HOME_APPEARANCE.color,
    spacing: typeof input.spacing === "number" && Number.isFinite(input.spacing)
      ? Math.max(1, Math.min(3, Math.round(input.spacing))) : 2,
  };
}

export async function readHomeLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_LOGO_BYTES) {
    throw new Error("invalid-logo");
  }
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("unreadable-logo"));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = source;
  await image.decode();
  if (image.naturalWidth > 2048 || image.naturalHeight > 2048) {
    throw new Error("oversized-logo");
  }
  return source;
}
