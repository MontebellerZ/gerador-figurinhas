import type {
  StickerCanvasSize,
  StickerFrameRect,
  StickerFrameStyle,
  StickerOrientation,
  StickerTransform,
} from "../types";

export const PORTRAIT_CANVAS_WIDTH = 606;
export const PORTRAIT_CANVAS_HEIGHT = 870;

const BORDER_COLOR = "#ffffff";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.22)";

interface StickerGeometry {
  canvasSize: StickerCanvasSize;
  frameStyle: StickerFrameStyle;
  frameRect: StickerFrameRect;
}

interface StickerImageMetrics {
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  effectiveScale: number;
}

interface StickerCropSelection {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  destX: number;
  destY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getPreviewCanvasSize(orientation: StickerOrientation): StickerCanvasSize {
  if (orientation === "landscape") {
    return {
      width: PORTRAIT_CANVAS_HEIGHT,
      height: PORTRAIT_CANVAS_WIDTH,
    };
  }

  return {
    width: PORTRAIT_CANVAS_WIDTH,
    height: PORTRAIT_CANVAS_HEIGHT,
  };
}

function createAdaptiveFrameStyle(width: number, height: number): StickerFrameStyle {
  const shortSide = Math.min(width, height);
  const inset = clamp(Math.round(shortSide * 0.046), 18, 240);
  const borderWidth = clamp(Math.round(shortSide * 0.033), 10, 170);
  const cornerRadius = clamp(Math.round(shortSide * 0.056), 16, 280);

  return {
    insetX: inset,
    insetY: inset,
    borderWidth,
    cornerRadius,
    borderColor: BORDER_COLOR,
    shadowColor: SHADOW_COLOR,
    shadowBlur: clamp(Math.round(shortSide * 0.033), 10, 160),
    shadowOffsetY: clamp(Math.round(shortSide * 0.013), 4, 70),
  };
}

function drawRoundedRectPath(ctx: CanvasRenderingContext2D, rect: StickerFrameRect): void {
  const { x, y, width, height, cornerRadius } = rect;
  const maxRadius = Math.min(cornerRadius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + maxRadius, y);
  ctx.lineTo(x + width - maxRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + maxRadius);
  ctx.lineTo(x + width, y + height - maxRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - maxRadius, y + height);
  ctx.lineTo(x + maxRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - maxRadius);
  ctx.lineTo(x, y + maxRadius);
  ctx.quadraticCurveTo(x, y, x + maxRadius, y);
  ctx.closePath();
}

function createRoundedRectPath2D(rect: StickerFrameRect): Path2D {
  const { x, y, width, height, cornerRadius } = rect;
  const maxRadius = Math.min(cornerRadius, width / 2, height / 2);
  const path = new Path2D();

  path.moveTo(x + maxRadius, y);
  path.lineTo(x + width - maxRadius, y);
  path.quadraticCurveTo(x + width, y, x + width, y + maxRadius);
  path.lineTo(x + width, y + height - maxRadius);
  path.quadraticCurveTo(x + width, y + height, x + width - maxRadius, y + height);
  path.lineTo(x + maxRadius, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - maxRadius);
  path.lineTo(x, y + maxRadius);
  path.quadraticCurveTo(x, y, x + maxRadius, y);
  path.closePath();

  return path;
}

export function getStickerFrameRect(
  canvasWidth: number,
  canvasHeight: number,
  frameStyle: StickerFrameStyle,
): StickerFrameRect {
  const width = canvasWidth - frameStyle.insetX * 2;
  const height = canvasHeight - frameStyle.insetY * 2;

  return {
    x: frameStyle.insetX,
    y: frameStyle.insetY,
    width,
    height,
    cornerRadius: frameStyle.cornerRadius,
  };
}

function getPreviewGeometry(orientation: StickerOrientation): StickerGeometry {
  const canvasSize = getPreviewCanvasSize(orientation);
  const frameStyle = createAdaptiveFrameStyle(canvasSize.width, canvasSize.height);

  return {
    canvasSize,
    frameStyle,
    frameRect: getStickerFrameRect(canvasSize.width, canvasSize.height, frameStyle),
  };
}

function getImageMetrics(
  image: HTMLImageElement,
  frameRect: StickerFrameRect,
  transform: StickerTransform,
): StickerImageMetrics {
  const baseScale = Math.max(frameRect.width / image.naturalWidth, frameRect.height / image.naturalHeight);
  const effectiveScale = baseScale * transform.zoom;
  const drawWidth = image.naturalWidth * effectiveScale;
  const drawHeight = image.naturalHeight * effectiveScale;
  const centerX = frameRect.x + frameRect.width / 2 + transform.offsetX;
  const centerY = frameRect.y + frameRect.height / 2 + transform.offsetY;

  return {
    drawX: centerX - drawWidth / 2,
    drawY: centerY - drawHeight / 2,
    drawWidth,
    drawHeight,
    effectiveScale,
  };
}

function getCropSelectionFromPreview(
  image: HTMLImageElement,
  transform: StickerTransform,
  orientation: StickerOrientation,
): StickerCropSelection {
  const previewGeometry = getPreviewGeometry(orientation);
  const metrics = getImageMetrics(image, previewGeometry.frameRect, transform);
  const cropX = (previewGeometry.frameRect.x - metrics.drawX) / metrics.effectiveScale;
  const cropY = (previewGeometry.frameRect.y - metrics.drawY) / metrics.effectiveScale;
  const cropWidth = previewGeometry.frameRect.width / metrics.effectiveScale;
  const cropHeight = previewGeometry.frameRect.height / metrics.effectiveScale;

  const sourceX = clamp(cropX, 0, image.naturalWidth);
  const sourceY = clamp(cropY, 0, image.naturalHeight);
  const sourceMaxX = clamp(cropX + cropWidth, 0, image.naturalWidth);
  const sourceMaxY = clamp(cropY + cropHeight, 0, image.naturalHeight);
  const sourceWidth = Math.max(0, sourceMaxX - sourceX);
  const sourceHeight = Math.max(0, sourceMaxY - sourceY);

  return {
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destX: Math.max(0, -cropX),
    destY: Math.max(0, -cropY),
  };
}

function getExportGeometryFromCrop(cropSelection: StickerCropSelection): StickerGeometry {
  const frameWidth = Math.max(1, Math.round(cropSelection.cropWidth));
  const frameHeight = Math.max(1, Math.round(cropSelection.cropHeight));
  const baseStyle = createAdaptiveFrameStyle(frameWidth, frameHeight);
  const frameStyle: StickerFrameStyle = {
    ...baseStyle,
    insetX: 0,
    insetY: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    shadowOffsetY: 0,
  };

  return {
    canvasSize: {
      width: frameWidth,
      height: frameHeight,
    },
    frameStyle,
    frameRect: {
      x: 0,
      y: 0,
      width: frameWidth,
      height: frameHeight,
      cornerRadius: frameStyle.cornerRadius,
    },
  };
}

function drawBorder(ctx: CanvasRenderingContext2D, frameRect: StickerFrameRect, frameStyle: StickerFrameStyle): void {
  ctx.save();
  ctx.lineWidth = frameStyle.borderWidth;
  ctx.strokeStyle = frameStyle.borderColor;
  ctx.shadowColor = frameStyle.shadowColor;
  ctx.shadowBlur = frameStyle.shadowBlur;
  ctx.shadowOffsetY = frameStyle.shadowOffsetY;
  drawRoundedRectPath(ctx, frameRect);
  ctx.stroke();
  ctx.restore();
}

function drawInsetBorder(ctx: CanvasRenderingContext2D, frameRect: StickerFrameRect, frameStyle: StickerFrameStyle): void {
  const inset = Math.min(frameStyle.borderWidth, frameRect.width / 2, frameRect.height / 2);

  if (inset <= 0) {
    return;
  }

  const outerPath = createRoundedRectPath2D(frameRect);
  const innerWidth = frameRect.width - inset * 2;
  const innerHeight = frameRect.height - inset * 2;

  ctx.save();
  ctx.fillStyle = frameStyle.borderColor;

  if (innerWidth <= 0 || innerHeight <= 0) {
    ctx.fill(outerPath);
    ctx.restore();
    return;
  }

  const innerRect: StickerFrameRect = {
    x: frameRect.x + inset,
    y: frameRect.y + inset,
    width: innerWidth,
    height: innerHeight,
    cornerRadius: Math.max(0, frameRect.cornerRadius - inset),
  };

  const ringPath = new Path2D();
  ringPath.addPath(outerPath);
  ringPath.addPath(createRoundedRectPath2D(innerRect));
  ctx.fill(ringPath, "evenodd");
  ctx.restore();
}

function renderEdgeToEdgeSticker(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  cropSelection: StickerCropSelection,
  geometry: StickerGeometry,
): void {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas 2D nao disponivel.");
  }

  const scaleX = geometry.frameRect.width / cropSelection.cropWidth;
  const scaleY = geometry.frameRect.height / cropSelection.cropHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.clip(createRoundedRectPath2D(geometry.frameRect));

  if (cropSelection.sourceWidth > 0 && cropSelection.sourceHeight > 0) {
    ctx.drawImage(
      image,
      cropSelection.sourceX,
      cropSelection.sourceY,
      cropSelection.sourceWidth,
      cropSelection.sourceHeight,
      geometry.frameRect.x + cropSelection.destX * scaleX,
      geometry.frameRect.y + cropSelection.destY * scaleY,
      cropSelection.sourceWidth * scaleX,
      cropSelection.sourceHeight * scaleY,
    );
  }

  ctx.restore();
  drawInsetBorder(ctx, geometry.frameRect, geometry.frameStyle);
}

export function createDefaultTransform(): StickerTransform {
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem."));

    image.src = url;
  });
}

export function renderStickerOnCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  transform: StickerTransform,
  frameStyle = createAdaptiveFrameStyle(canvas.width, canvas.height),
): void {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas 2D nao disponivel.");
  }

  const frameRect = getStickerFrameRect(canvas.width, canvas.height, frameStyle);
  const metrics = getImageMetrics(image, frameRect, transform);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  drawRoundedRectPath(ctx, frameRect);
  ctx.clip();
  ctx.drawImage(image, metrics.drawX, metrics.drawY, metrics.drawWidth, metrics.drawHeight);
  ctx.restore();

  drawBorder(ctx, frameRect, frameStyle);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Nao foi possivel gerar o arquivo PNG."));
          return;
        }

        resolve(blob);
      },
      "image/png",
      1,
    );
  });
}

export async function composeStickerBlob(sourceUrl: string, transform: StickerTransform): Promise<Blob> {
  const image = await loadImageFromUrl(sourceUrl);
  const orientation: StickerOrientation = image.naturalHeight >= image.naturalWidth ? "portrait" : "landscape";
  return composeStickerBlobWithOrientation(sourceUrl, transform, orientation);
}

export async function composeStickerBlobWithOrientation(
  sourceUrl: string,
  transform: StickerTransform,
  orientation: StickerOrientation,
): Promise<Blob> {
  const image = await loadImageFromUrl(sourceUrl);
  const cropSelection = getCropSelectionFromPreview(image, transform, orientation);
  const exportGeometry = getExportGeometryFromCrop(cropSelection);
  const canvas = document.createElement("canvas");

  canvas.width = exportGeometry.canvasSize.width;
  canvas.height = exportGeometry.canvasSize.height;

  renderEdgeToEdgeSticker(canvas, image, cropSelection, exportGeometry);

  return canvasToBlob(canvas);
}

export function composeStickerPreviewBlob(
  image: HTMLImageElement,
  transform: StickerTransform,
  orientation: StickerOrientation,
): Promise<Blob> {
  const cropSelection = getCropSelectionFromPreview(image, transform, orientation);
  const canvasSize = getPreviewCanvasSize(orientation);
  const previewStyle = createAdaptiveFrameStyle(canvasSize.width, canvasSize.height);
  const canvas = document.createElement("canvas");

  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;

  renderEdgeToEdgeSticker(canvas, image, cropSelection, {
    canvasSize,
    frameStyle: {
      ...previewStyle,
      insetX: 0,
      insetY: 0,
      shadowColor: "rgba(0, 0, 0, 0)",
      shadowBlur: 0,
      shadowOffsetY: 0,
    },
    frameRect: {
      x: 0,
      y: 0,
      width: canvasSize.width,
      height: canvasSize.height,
      cornerRadius: previewStyle.cornerRadius,
    },
  });

  return canvasToBlob(canvas);
}

export function toPngFileName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

  return `${baseName}.png`;
}
