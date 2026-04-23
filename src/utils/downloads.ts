import { saveAs } from "file-saver";
import JSZip from "jszip";

export interface ZipEntry {
  fileName: string;
  blob: Blob;
}

function normalizeFileName(fileName: string): string {
  const trimmed = fileName.trim();

  return trimmed.length > 0 ? trimmed : "figurinha.png";
}

function createUniqueName(fileName: string, usedNames: Map<string, number>): string {
  const safeName = normalizeFileName(fileName);
  const existingCount = usedNames.get(safeName) ?? 0;

  if (existingCount === 0) {
    usedNames.set(safeName, 1);

    return safeName;
  }

  const dotIndex = safeName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  const nextCount = existingCount + 1;

  usedNames.set(safeName, nextCount);

  return `${baseName} (${nextCount - 1})${extension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  saveAs(blob, normalizeFileName(fileName));
}

export async function downloadAllAsZip(entries: ZipEntry[], zipFileName = "figurinhas-concluidas.zip"): Promise<void> {
  if (entries.length === 0) {
    throw new Error("Nao ha figurinhas concluidas para download.");
  }

  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (const entry of entries) {
    const uniqueName = createUniqueName(entry.fileName, usedNames);
    zip.file(uniqueName, entry.blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  saveAs(zipBlob, zipFileName);
}
