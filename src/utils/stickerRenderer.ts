import type { StickerFrameRect, StickerFrameStyle, StickerTransform } from "../types";

export const STICKER_CANVAS_WIDTH = 606;
export const STICKER_CANVAS_HEIGHT = 870;

export const DEFAULT_STICKER_FRAME_STYLE: StickerFrameStyle = {
  insetX: 28,
  insetY: 28,
  borderWidth: 20,
  cornerRadius: 34,
  borderColor: "#ffffff",
  shadowColor: "rgba(0, 0, 0, 0.22)",
  shadowBlur: 20,
  shadowOffsetY: 8,
};

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

export function getStickerFrameRect(
  canvasWidth = STICKER_CANVAS_WIDTH,
  canvasHeight = STICKER_CANVAS_HEIGHT,
  frameStyle = DEFAULT_STICKER_FRAME_STYLE,
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
  frameStyle = DEFAULT_STICKER_FRAME_STYLE,
): void {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas 2D nao disponivel.");
  }

  const frameRect = getStickerFrameRect(canvas.width, canvas.height, frameStyle);
  const baseScale = Math.max(frameRect.width / image.naturalWidth, frameRect.height / image.naturalHeight);
  const effectiveScale = baseScale * transform.zoom;
  const drawWidth = image.naturalWidth * effectiveScale;
  const drawHeight = image.naturalHeight * effectiveScale;

  const centerX = frameRect.x + frameRect.width / 2 + transform.offsetX;
  const centerY = frameRect.y + frameRect.height / 2 + transform.offsetY;

  const drawX = centerX - drawWidth / 2;
  const drawY = centerY - drawHeight / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  drawRoundedRectPath(ctx, frameRect);
  ctx.clip();
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();

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
  const canvas = document.createElement("canvas");

  canvas.width = STICKER_CANVAS_WIDTH;
  canvas.height = STICKER_CANVAS_HEIGHT;

  renderStickerOnCanvas(canvas, image, transform);

  return canvasToBlob(canvas);
}

export function toPngFileName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

  return `${baseName}.png`;
}
