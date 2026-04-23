export type StickerStatus = "pending" | "completed";
export type StickerOrientation = "portrait" | "landscape";

export interface StickerTransform {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface StickerItem {
  id: string;
  file: File;
  sourceUrl: string;
  originalName: string;
  status: StickerStatus;
  orientation: StickerOrientation;
  transform: StickerTransform;
  createdAt: number;
}

export interface StickerFrameStyle {
  insetX: number;
  insetY: number;
  borderWidth: number;
  cornerRadius: number;
  borderColor: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
}

export interface StickerFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
}

export interface StickerCanvasSize {
  width: number;
  height: number;
}
