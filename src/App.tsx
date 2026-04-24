import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { TbCameraPlus, TbDownload, TbFileZip, TbFolderPlus, TbPencil, TbTrash } from "react-icons/tb";
import "./App.scss";
import type { StickerItem, StickerOrientation, StickerTransform } from "./types";
import { downloadAllAsZip, downloadBlob } from "./utils/downloads";
import {
  clampStickerTransform,
  composeStickerBlobWithOrientation,
  composeStickerPreviewBlob,
  createDefaultTransform,
  getPreviewCanvasSize,
  loadImageFromUrl,
  renderStickerOnCanvas,
  resolveExportMimeType,
  toOutputFileName,
} from "./utils/stickerRenderer";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const WHEEL_ZOOM_STEP = 0.002;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  initialOffsetX: number;
  initialOffsetY: number;
}

function createItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStickerItem(file: File, orientation: StickerOrientation, sourceFolder: string | null): StickerItem {
  return {
    id: createItemId(),
    file,
    sourceUrl: URL.createObjectURL(file),
    previewUrl: null,
    sourceFolder,
    originalName: file.name,
    status: "pending",
    orientation,
    transform: createDefaultTransform(),
    createdAt: Date.now(),
  };
}

function extractFolderNameFromFile(file: File): string | null {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;

  if (!relativePath || !relativePath.includes("/")) {
    return null;
  }

  const [folderName] = relativePath.split("/");

  return folderName?.trim() ? folderName : null;
}

function normalizeZipBaseName(name: string): string {
  const trimmed = name.trim();
  const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();

  return sanitized.length > 0 ? sanitized : "figurinhas-concluidas";
}

async function getInitialOrientation(file: File): Promise<StickerOrientation> {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromUrl(sourceUrl);

    return image.naturalWidth > image.naturalHeight ? "landscape" : "portrait";
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getOrientationLabel(orientation: StickerOrientation): string {
  return orientation === "portrait" ? "Em pé" : "Deitada";
}

function formatZoom(value: number): string {
  return `${value.toFixed(2)}x`;
}

function resolveClampedTransform(
  image: HTMLImageElement | null,
  transform: StickerTransform,
  orientation: StickerOrientation,
): StickerTransform {
  if (!image) {
    return transform;
  }

  return clampStickerTransform(image, transform, orientation);
}

function StickerCard({
  item,
  onEdit,
  onDownload,
  isDownloading,
}: {
  item: StickerItem;
  onEdit: (id: string) => Promise<void> | void;
  onDownload: (id: string) => void;
  isDownloading: boolean;
}) {
  const isPending = item.status === "pending";
  const previewSource = item.previewUrl ?? item.sourceUrl;

  return (
    <li className={`sticker-card ${isPending ? "sticker-card--pending" : "sticker-card--completed"}`}>
      <div
        className={[
          "sticker-card__preview",
          isPending ? "sticker-card__preview--original" : "",
          !isPending && item.orientation === "landscape" ? "sticker-card__preview--landscape" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <img src={previewSource} alt={item.originalName} loading="lazy" />
        <span className={`status-tag status-tag--${item.status}`}>
          {item.status === "pending" ? "Pendente" : "Concluída"}
        </span>
      </div>

      <div className="sticker-card__meta">
        <p className="sticker-card__name" title={item.originalName}>
          {item.originalName}
        </p>
        <p className="sticker-card__transform">
          Zoom: {formatZoom(item.transform.zoom)} | X: {Math.round(item.transform.offsetX)} | Y: {Math.round(item.transform.offsetY)}
        </p>
        <p className="sticker-card__orientation">Orientação: {getOrientationLabel(item.orientation)}</p>
      </div>

      <div className="sticker-card__actions">
        <button
          type="button"
          className="button button--soft button--icon-only"
          onClick={() => {
            void onEdit(item.id);
          }}
          title={item.status === "pending" ? "Editar" : "Reeditar"}
          aria-label={item.status === "pending" ? "Editar" : "Reeditar"}
        >
          <TbPencil aria-hidden="true" />
        </button>

        {item.status === "completed" ? (
          <button
            type="button"
            className="button button--success button--icon-only"
            onClick={() => onDownload(item.id)}
            disabled={isDownloading}
            title={isDownloading ? "Gerando..." : "Baixar"}
            aria-label={isDownloading ? "Gerando..." : "Baixar"}
          >
            <TbDownload aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function App() {
  const [items, setItems] = useState<StickerItem[]>([]);
  const [editorItemId, setEditorItemId] = useState<string | null>(null);
  const [draftTransform, setDraftTransform] = useState<StickerTransform>(createDefaultTransform());
  const [draftOrientation, setDraftOrientation] = useState<StickerOrientation>("portrait");
  const [editorImage, setEditorImage] = useState<HTMLImageElement | null>(null);
  const [isLoadingEditorImage, setIsLoadingEditorImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [isClearCompletedModalOpen, setIsClearCompletedModalOpen] = useState(false);

  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const latestUrlsRef = useRef<string[]>([]);
  const imageLoadTokenRef = useRef(0);

  const pendingItems = useMemo(
    () => items.filter((item) => item.status === "pending").sort((a, b) => a.createdAt - b.createdAt),
    [items],
  );
  const completedItems = useMemo(
    () => items.filter((item) => item.status === "completed").sort((a, b) => a.createdAt - b.createdAt),
    [items],
  );
  const editingItem = useMemo(() => items.find((item) => item.id === editorItemId) ?? null, [editorItemId, items]);
  const previewCanvasSize = useMemo(() => getPreviewCanvasSize(draftOrientation), [draftOrientation]);

  useEffect(() => {
    latestUrlsRef.current = items.flatMap((item) => {
      const urls = [item.sourceUrl];

      if (item.previewUrl) {
        urls.push(item.previewUrl);
      }

      return urls;
    });
  }, [items]);

  useEffect(() => {
    return () => {
      for (const url of latestUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setErrorMessage(null);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [errorMessage]);

  useEffect(() => {
    if (!editingItem || !editorImage || !editorCanvasRef.current) {
      return;
    }

    renderStickerOnCanvas(editorCanvasRef.current, editorImage, draftTransform);
  }, [draftOrientation, draftTransform, editingItem, editorImage]);

  useEffect(() => {
    if (!editingItem && !isClearCompletedModalOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editingItem) {
          dragStateRef.current = null;
          imageLoadTokenRef.current += 1;
          setIsLoadingEditorImage(false);
          setEditorImage(null);
          setEditorItemId(null);
          setDraftOrientation("portrait");
        }

        if (isClearCompletedModalOpen) {
          setIsClearCompletedModalOpen(false);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editingItem, isClearCompletedModalOpen]);

  async function appendUploadedFiles(fileList: FileList | File[], preferredFolderName: string | null = null): Promise<void> {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));

    if (files.length === 0) {
      setErrorMessage("Selecione pelo menos uma imagem válida.");
      return;
    }

    const orientations = await Promise.all(files.map((file) => getInitialOrientation(file)));
    const newItems = files.map((file, index) => {
      const sourceFolder = extractFolderNameFromFile(file) ?? preferredFolderName;

      return createStickerItem(file, orientations[index], sourceFolder);
    });

    setItems((current) => [...current, ...newItems]);
  }

  function handleUploadInputChange(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) {
      void appendUploadedFiles(event.target.files);
    }

    event.target.value = "";
  }

  function handleFolderUploadInputChange(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files && event.target.files.length > 0) {
      const firstFolderName = extractFolderNameFromFile(event.target.files[0]);
      void appendUploadedFiles(event.target.files, firstFolderName);
    }

    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setIsDragOver(false);

    if (event.dataTransfer.files.length > 0) {
      void appendUploadedFiles(event.dataTransfer.files);
    }
  }

  async function openEditor(itemId: string): Promise<void> {
    const item = items.find((candidate) => candidate.id === itemId);

    if (!item) {
      return;
    }

    const loadToken = imageLoadTokenRef.current + 1;
    imageLoadTokenRef.current = loadToken;

    setEditorItemId(item.id);
    setDraftTransform(item.transform);
    setDraftOrientation(item.orientation);
    setEditorImage(null);
    setIsLoadingEditorImage(true);

    try {
      const image = await loadImageFromUrl(item.sourceUrl);

      if (imageLoadTokenRef.current !== loadToken) {
        return;
      }

      setDraftTransform(clampStickerTransform(image, item.transform, item.orientation));
      setEditorImage(image);
    } catch {
      if (imageLoadTokenRef.current !== loadToken) {
        return;
      }

      setErrorMessage("Não foi possível carregar a imagem selecionada.");
      setEditorItemId(null);
    } finally {
      if (imageLoadTokenRef.current === loadToken) {
        setIsLoadingEditorImage(false);
      }
    }
  }

  function closeEditor(): void {
    dragStateRef.current = null;
    imageLoadTokenRef.current += 1;
    setIsLoadingEditorImage(false);
    setEditorImage(null);
    setEditorItemId(null);
    setDraftOrientation("portrait");
  }

  async function updateEditedItem(status: "pending" | "completed"): Promise<void> {
    if (!editingItem || !editorImage) {
      return;
    }

    try {
      const clampedTransform = clampStickerTransform(editorImage, draftTransform, draftOrientation);
      const previewBlob = await composeStickerPreviewBlob(editorImage, clampedTransform, draftOrientation);
      const previewUrl = URL.createObjectURL(previewBlob);
      const previousPreviewUrl = editingItem.previewUrl;

      setItems((current) =>
        current.map((item) => {
          if (item.id !== editingItem.id) {
            return item;
          }

          return {
            ...item,
            transform: clampedTransform,
            orientation: draftOrientation,
            previewUrl,
            status,
          };
        }),
      );

      if (previousPreviewUrl) {
        URL.revokeObjectURL(previousPreviewUrl);
      }

      closeEditor();
    } catch {
      setErrorMessage("Não foi possível atualizar a pré-visualização da figurinha.");
    }
  }

  function handleEditorPointerDown(event: PointerEvent<HTMLCanvasElement>): void {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialOffsetX: draftTransform.offsetX,
      initialOffsetY: draftTransform.offsetY,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleEditorPointerMove(event: PointerEvent<HTMLCanvasElement>): void {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const scaleX = previewCanvasSize.width / event.currentTarget.clientWidth;
    const scaleY = previewCanvasSize.height / event.currentTarget.clientHeight;
    const deltaX = (event.clientX - dragState.startX) * scaleX;
    const deltaY = (event.clientY - dragState.startY) * scaleY;

    setDraftTransform((current) =>
      resolveClampedTransform(
        editorImage,
        {
          ...current,
          offsetX: dragState.initialOffsetX + deltaX,
          offsetY: dragState.initialOffsetY + deltaY,
        },
        draftOrientation,
      ),
    );
  }

  function handleEditorPointerRelease(event: PointerEvent<HTMLCanvasElement>): void {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleEditorWheel(event: WheelEvent<HTMLCanvasElement>): void {
    event.preventDefault();

    const zoomDelta = -event.deltaY * WHEEL_ZOOM_STEP;

    setDraftTransform((current) =>
      resolveClampedTransform(
        editorImage,
        {
          ...current,
          zoom: clamp(current.zoom + zoomDelta, MIN_ZOOM, MAX_ZOOM),
        },
        draftOrientation,
      ),
    );
  }

  function handleOrientationChange(orientation: StickerOrientation): void {
    if (orientation === draftOrientation) {
      return;
    }

    setDraftOrientation(orientation);
    setDraftTransform((current) =>
      resolveClampedTransform(
        editorImage,
        {
          ...current,
          offsetX: 0,
          offsetY: 0,
        },
        orientation,
      ),
    );
  }

  async function handleDownloadSingle(itemId: string): Promise<void> {
    const item = items.find((candidate) => candidate.id === itemId);

    if (!item || item.status !== "completed") {
      return;
    }

    setDownloadingItemId(itemId);

    try {
      const outputMimeType = resolveExportMimeType(item.file.type);
      const blob = await composeStickerBlobWithOrientation(item.sourceUrl, item.transform, item.orientation, outputMimeType);
      downloadBlob(blob, toOutputFileName(item.originalName, outputMimeType));
    } catch {
      setErrorMessage("Falha ao gerar o download desta figurinha.");
    } finally {
      setDownloadingItemId(null);
    }
  }

  async function handleDownloadAll(): Promise<void> {
    if (completedItems.length === 0) {
      return;
    }

    setIsDownloadingAll(true);

    try {
      const entries = [];
      const folderNames = new Set<string>();

      for (const item of completedItems) {
        const outputMimeType = resolveExportMimeType(item.file.type);
        const blob = await composeStickerBlobWithOrientation(item.sourceUrl, item.transform, item.orientation, outputMimeType);

        if (item.sourceFolder) {
          folderNames.add(item.sourceFolder);
        }

        entries.push({
          fileName: toOutputFileName(item.originalName, outputMimeType),
          blob,
        });
      }

      const zipFileName = folderNames.size === 1
        ? `${normalizeZipBaseName(Array.from(folderNames)[0])}.zip`
        : "figurinhas-concluidas.zip";

      await downloadAllAsZip(entries, zipFileName);
    } catch {
      setErrorMessage("Falha ao gerar o arquivo ZIP das concluídas.");
    } finally {
      setIsDownloadingAll(false);
    }
  }

  function handleClearCompleted(): void {
    if (completedItems.length === 0 || isDownloadingAll) {
      return;
    }

    setItems((current) => {
      const removedItems = current.filter((item) => item.status === "completed");

      for (const item of removedItems) {
        URL.revokeObjectURL(item.sourceUrl);

        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }

      return current.filter((item) => item.status !== "completed");
    });

    setDownloadingItemId((current) => {
      if (!current) {
        return null;
      }

      return completedItems.some((item) => item.id === current) ? null : current;
    });

    setIsClearCompletedModalOpen(false);
  }

  function openClearCompletedModal(): void {
    if (completedItems.length === 0 || isDownloadingAll) {
      return;
    }

    setIsClearCompletedModalOpen(true);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="hero__eyebrow">Editor de Figurinhas</p>
        <h1>Upload em lote com borda automática</h1>
        <p>
          Envie várias imagens, ajuste cada uma com zoom e arraste, conclua quando estiver pronta e baixe as figurinhas
          individualmente ou em um único arquivo ZIP.
        </p>

        <div className="hero__stats">
          <div>
            <span>{items.length}</span>
            <small>Total</small>
          </div>
          <div>
            <span>{pendingItems.length}</span>
            <small>Pendentes</small>
          </div>
          <div>
            <span>{completedItems.length}</span>
            <small>Concluídas</small>
          </div>
        </div>
      </header>

      <section
        className={`upload-panel ${isDragOver ? "upload-panel--drag-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => {
          setIsDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <div>
          <h2>Adicionar imagens</h2>
          <p>Arraste seus arquivos para esta área ou use o seletor para upload múltiplo.</p>
        </div>

        <div className="upload-panel__actions">
          <label
            htmlFor="image-upload"
            className="button button--primary button--icon-only"
            title="Selecionar imagens"
            aria-label="Selecionar imagens"
          >
            <TbCameraPlus aria-hidden="true" />
          </label>
          <label
            htmlFor="folder-upload"
            className="button button--soft button--icon-only"
            title="Selecionar pasta"
            aria-label="Selecionar pasta"
          >
            <TbFolderPlus aria-hidden="true" />
          </label>
        </div>
        <input id="image-upload" type="file" accept="image/*" multiple onChange={handleUploadInputChange} />
        <input
          id="folder-upload"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFolderUploadInputChange}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
      </section>

      {errorMessage ? <p className="app-error">{errorMessage}</p> : null}

      <main className="boards">
        <section className="board">
          <header className="board__header board__header--split">
            <div>
              <h2>Pendentes</h2>
              <span>{pendingItems.length}</span>
            </div>
          </header>

          {pendingItems.length === 0 ? (
            <p className="board__empty">Nenhuma figurinha pendente por aqui.</p>
          ) : (
            <ul className="sticker-grid sticker-grid--pending">
              {pendingItems.map((item) => (
                <StickerCard
                  key={item.id}
                  item={item}
                  onEdit={openEditor}
                  onDownload={handleDownloadSingle}
                  isDownloading={downloadingItemId === item.id}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="board board--completed">
          <header className="board__header board__header--split">
            <div>
              <h2>Concluídas</h2>
              <span>{completedItems.length}</span>
            </div>

            <div className="board__header-actions">
              <button
                type="button"
                className="button button--success button--icon-only"
                onClick={() => {
                  void handleDownloadAll();
                }}
                disabled={completedItems.length === 0 || isDownloadingAll}
                title={isDownloadingAll ? "Gerando ZIP..." : "Baixar todas (.zip)"}
                aria-label={isDownloadingAll ? "Gerando ZIP..." : "Baixar todas (.zip)"}
              >
                <TbFileZip aria-hidden="true" />
              </button>

              <button
                type="button"
                className="button button--danger button--icon-only"
                onClick={openClearCompletedModal}
                disabled={completedItems.length === 0 || isDownloadingAll}
                title="Limpar concluídas"
                aria-label="Limpar concluídas"
              >
                <TbTrash aria-hidden="true" />
              </button>
            </div>
          </header>

          {completedItems.length === 0 ? (
            <p className="board__empty">Finalize alguma edição para habilitar os downloads.</p>
          ) : (
            <ul className="sticker-grid sticker-grid--completed">
              {completedItems.map((item) => (
                <StickerCard
                  key={item.id}
                  item={item}
                  onEdit={openEditor}
                  onDownload={handleDownloadSingle}
                  isDownloading={downloadingItemId === item.id}
                />
              ))}
            </ul>
          )}
        </section>
      </main>

      {editingItem ? (
        <div className="editor-backdrop" role="presentation" onClick={closeEditor}>
          <section
            className="editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Editor de figurinha"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="editor-modal__header">
              <div>
                <h2>{editingItem.originalName}</h2>
                <p>Arraste para posicionar, use scroll do mouse para zoom e escolha a orientação final.</p>
              </div>
              <span className={`status-tag status-tag--${editingItem.status}`}>
                {editingItem.status === "pending" ? "Pendente" : "Concluída"}
              </span>
            </header>

            <div className="editor-modal__content">
              <div className="editor-canvas-wrap">
                {isLoadingEditorImage ? <p className="editor-canvas-wrap__loading">Carregando imagem...</p> : null}
                <canvas
                  ref={editorCanvasRef}
                  width={previewCanvasSize.width}
                  height={previewCanvasSize.height}
                  className="editor-canvas"
                  onPointerDown={handleEditorPointerDown}
                  onPointerMove={handleEditorPointerMove}
                  onPointerUp={handleEditorPointerRelease}
                  onPointerCancel={handleEditorPointerRelease}
                  onPointerLeave={handleEditorPointerRelease}
                  onWheel={handleEditorWheel}
                />
                <p className="editor-canvas-wrap__hint">Dica: use o scroll do mouse dentro da moldura para controlar o zoom.</p>
              </div>

              <aside className="editor-controls">
                <div className="editor-control">
                  <p>Orientação da figurinha</p>
                  <div className="orientation-picker">
                    <button
                      type="button"
                      className={`orientation-picker__option ${draftOrientation === "portrait" ? "orientation-picker__option--active" : ""}`}
                      onClick={() => {
                        handleOrientationChange("portrait");
                      }}
                    >
                      Em pé
                    </button>
                    <button
                      type="button"
                      className={`orientation-picker__option ${draftOrientation === "landscape" ? "orientation-picker__option--active" : ""}`}
                      onClick={() => {
                        handleOrientationChange("landscape");
                      }}
                    >
                      Deitada
                    </button>
                  </div>
                </div>

                <div className="editor-control">
                  <label htmlFor="zoom-range">Zoom ({formatZoom(draftTransform.zoom)})</label>
                  <input
                    id="zoom-range"
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.01}
                    value={draftTransform.zoom}
                    onChange={(event) => {
                      const zoom = Number(event.target.value);
                      setDraftTransform((current) =>
                        resolveClampedTransform(
                          editorImage,
                          { ...current, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) },
                          draftOrientation,
                        ),
                      );
                    }}
                  />
                </div>

                <div className="editor-control">
                  <p>Posição atual</p>
                  <small>
                    X: {Math.round(draftTransform.offsetX)} | Y: {Math.round(draftTransform.offsetY)}
                  </small>
                </div>

                <button
                  type="button"
                  className="button button--soft"
                  onClick={() => {
                    setDraftTransform(resolveClampedTransform(editorImage, createDefaultTransform(), draftOrientation));
                  }}
                >
                  Resetar enquadramento
                </button>
              </aside>
            </div>

            <footer className="editor-modal__footer">
              <button type="button" className="button button--ghost" onClick={closeEditor}>
                Fechar
              </button>

              {editingItem.status === "pending" ? (
                <>
                  <button
                    type="button"
                    className="button button--soft"
                    onClick={() => {
                      void updateEditedItem("pending");
                    }}
                  >
                    Salvar edição
                  </button>
                  <button
                    type="button"
                    className="button button--success"
                    onClick={() => {
                      void updateEditedItem("completed");
                    }}
                  >
                    Concluir
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button button--success"
                  onClick={() => {
                    void updateEditedItem("completed");
                  }}
                >
                  Salvar alterações
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}

      {isClearCompletedModalOpen ? (
        <div
          className="editor-backdrop"
          role="presentation"
          onClick={() => {
            setIsClearCompletedModalOpen(false);
          }}
        >
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar limpeza de concluídas"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2>Limpar concluídas?</h2>
            <p>Essa ação vai remover todas as figurinhas da seção de concluídas.</p>

            <div className="confirm-modal__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setIsClearCompletedModalOpen(false);
                }}
              >
                Cancelar
              </button>
              <button type="button" className="button button--danger" onClick={handleClearCompleted}>
                Sim, limpar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
