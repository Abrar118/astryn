export type ImageSourceKind = "direct" | "proxy" | "blocked";

const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i;

export function classifyImageSource(value: string): ImageSourceKind {
  if (RASTER_DATA_URL.test(value)) return "direct";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "uploads.linear.app" && !url.port && !url.username && !url.password
      ? "proxy"
      : "blocked";
  } catch {
    return "blocked";
  }
}
