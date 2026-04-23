import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from "react";
import "./App.scss";
import type { StickerItem, StickerTransform } from "./types";
import { downloadAllAsZip, downloadBlob } from "./utils/downloads";
import {
  composeStickerBlob,
  createDefaultTransform,
  loadImageFromUrl,
  renderStickerOnCanvas,
  STICKER_CANVAS_HEIGHT,
  STICKER_CANVAS_WIDTH,
  toPngFileName,
} from "./utils/stickerRenderer";

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

function createStickerItem(file: File): StickerItem {
  return {
    id: createItemId(),
    file,
    sourceUrl: URL.createObjectURL(file),
    originalName: file.name,
    status: "pending",
    transform: createDefaultTransform(),
    createdAt: Date.now(),
  };
}

function formatZoom(value: number): string {
  return `${value.toFixed(2)}x`;
}

function StickerCard({
  item,
  onEdit,
  onDownload,
  isDownloading,
}: {
  item: StickerItem;
  onEdit: (id: string) => void;
  onDownload: (id: string) => void;
  isDownloading: boolean;
}) {
  return (
    <li className="sticker-card">
      <div className="sticker-card__preview">
        <img src={item.sourceUrl} alt={item.originalName} loading="lazy" />
        <span className={`status-tag status-tag--${item.status}`}>
          {item.status === "pending" ? "Pendente" : "Concluida"}
        </span>
      </div>

      <div className="sticker-card__meta">
        <p className="sticker-card__name" title={item.originalName}>
          {item.originalName}
        </p>
        <p className="sticker-card__transform">
          Zoom: {formatZoom(item.transform.zoom)} | X: {Math.round(item.transform.offsetX)} | Y: {Math.round(item.transform.offsetY)}
        </p>
      </div>

      <div className="sticker-card__actions">
        <button type="button" className="button button--soft" onClick={() => onEdit(item.id)}>
          {item.status === "pending" ? "Editar" : "Reeditar"}
        </button>

        {item.status === "completed" ? (
          <button
            type="button"
            className="button button--success"
            onClick={() => onDownload(item.id)}
            disabled={isDownloading}
          >
            {isDownloading ? "Gerando..." : "Baixar PNG"}
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
  const [editorImage, setEditorImage] = useState<HTMLImageElement | null>(null);
  const [isLoadingEditorImage, setIsLoadingEditorImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

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

  useEffect(() => {
    latestUrlsRef.current = items.map((item) => item.sourceUrl);
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
  }, [draftTransform, editingItem, editorImage]);

  useEffect(() => {
    if (!editingItem) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dragStateRef.current = null;
        imageLoadTokenRef.current += 1;
        setIsLoadingEditorImage(false);
        setEditorImage(null);
        setEditorItemId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editingItem]);

  function appendUploadedFiles(fileList: FileList | File[]): void {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));

    if (files.length === 0) {
      setErrorMessage("Selecione pelo menos uma imagem valida.");
      return;
    }

    const newItems = files.map(createStickerItem);

    setItems((current) => [...current, ...newItems]);
  }

  function handleUploadInputChange(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) {
      appendUploadedFiles(event.target.files);
    }

    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setIsDragOver(false);

    if (event.dataTransfer.files.length > 0) {
      appendUploadedFiles(event.dataTransfer.files);
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
    setEditorImage(null);
    setIsLoadingEditorImage(true);

    try {
      const image = await loadImageFromUrl(item.sourceUrl);

      if (imageLoadTokenRef.current !== loadToken) {
        return;
      }

      setEditorImage(image);
    } catch {
      if (imageLoadTokenRef.current !== loadToken) {
        return;
      }

      setErrorMessage("Nao foi possivel carregar a imagem selecionada.");
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
  }

  function updateEditedItem(status: "pending" | "completed"): void {
    if (!editingItem) {
      return;
    }

    setItems((current) =>
      current.map((item) => {
        if (item.id !== editingItem.id) {
          return item;
        }

        return {
          ...item,
          transform: draftTransform,
          status,
        };
      }),
    );

    closeEditor();
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

    const scaleX = STICKER_CANVAS_WIDTH / event.currentTarget.clientWidth;
    const scaleY = STICKER_CANVAS_HEIGHT / event.currentTarget.clientHeight;
    const deltaX = (event.clientX - dragState.startX) * scaleX;
    const deltaY = (event.clientY - dragState.startY) * scaleY;

    setDraftTransform((current) => ({
      ...current,
      offsetX: dragState.initialOffsetX + deltaX,
      offsetY: dragState.initialOffsetY + deltaY,
    }));
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

  async function handleDownloadSingle(itemId: string): Promise<void> {
    const item = items.find((candidate) => candidate.id === itemId);

    if (!item || item.status !== "completed") {
      return;
    }

    setDownloadingItemId(itemId);

    try {
      const blob = await composeStickerBlob(item.sourceUrl, item.transform);
      downloadBlob(blob, toPngFileName(item.originalName));
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

      for (const item of completedItems) {
        const blob = await composeStickerBlob(item.sourceUrl, item.transform);

        entries.push({
          fileName: toPngFileName(item.originalName),
          blob,
        });
      }

      await downloadAllAsZip(entries);
    } catch {
      setErrorMessage("Falha ao gerar o arquivo ZIP das concluidas.");
    } finally {
      setIsDownloadingAll(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="hero__eyebrow">Editor de Figurinhas</p>
        <h1>Upload em lote com borda automatica</h1>
        <p>
          Envie varias imagens, ajuste cada uma com zoom e arraste, conclua quando estiver pronta e baixe as figurinhas
          individualmente ou em um unico arquivo ZIP.
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
            <small>Concluidas</small>
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
          <p>Arraste seus arquivos para esta area ou use o seletor para upload multiplo.</p>
        </div>

        <label htmlFor="image-upload" className="button button--primary">
          Selecionar imagens
        </label>
        <input id="image-upload" type="file" accept="image/*" multiple onChange={handleUploadInputChange} />
      </section>

      {errorMessage ? <p className="app-error">{errorMessage}</p> : null}

      <main className="boards">
        <section className="board">
          <header className="board__header">
            <h2>Pendentes</h2>
            <span>{pendingItems.length}</span>
          </header>

          {pendingItems.length === 0 ? (
            <p className="board__empty">Nenhuma figurinha pendente por aqui.</p>
          ) : (
            <ul className="sticker-grid">
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
              <h2>Concluidas</h2>
              <span>{completedItems.length}</span>
            </div>

            <button
              type="button"
              className="button button--success"
              onClick={() => {
                void handleDownloadAll();
              }}
              disabled={completedItems.length === 0 || isDownloadingAll}
            >
              {isDownloadingAll ? "Gerando ZIP..." : "Baixar todas (.zip)"}
            </button>
          </header>

          {completedItems.length === 0 ? (
            <p className="board__empty">Finalize alguma edicao para habilitar os downloads.</p>
          ) : (
            <ul className="sticker-grid">
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
                <p>Arraste a imagem para posicionar e use zoom para ajustar o enquadramento.</p>
              </div>
              <span className={`status-tag status-tag--${editingItem.status}`}>
                {editingItem.status === "pending" ? "Pendente" : "Concluida"}
              </span>
            </header>

            <div className="editor-modal__content">
              <div className="editor-canvas-wrap">
                {isLoadingEditorImage ? <p className="editor-canvas-wrap__loading">Carregando imagem...</p> : null}
                <canvas
                  ref={editorCanvasRef}
                  width={STICKER_CANVAS_WIDTH}
                  height={STICKER_CANVAS_HEIGHT}
                  className="editor-canvas"
                  onPointerDown={handleEditorPointerDown}
                  onPointerMove={handleEditorPointerMove}
                  onPointerUp={handleEditorPointerRelease}
                  onPointerCancel={handleEditorPointerRelease}
                  onPointerLeave={handleEditorPointerRelease}
                />
              </div>

              <aside className="editor-controls">
                <div className="editor-control">
                  <label htmlFor="zoom-range">Zoom ({formatZoom(draftTransform.zoom)})</label>
                  <input
                    id="zoom-range"
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={draftTransform.zoom}
                    onChange={(event) => {
                      const zoom = Number(event.target.value);
                      setDraftTransform((current) => ({ ...current, zoom }));
                    }}
                  />
                </div>

                <div className="editor-control">
                  <p>Posicao atual</p>
                  <small>
                    X: {Math.round(draftTransform.offsetX)} | Y: {Math.round(draftTransform.offsetY)}
                  </small>
                </div>

                <button
                  type="button"
                  className="button button--soft"
                  onClick={() => {
                    setDraftTransform(createDefaultTransform());
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
                      updateEditedItem("pending");
                    }}
                  >
                    Salvar edicao
                  </button>
                  <button
                    type="button"
                    className="button button--success"
                    onClick={() => {
                      updateEditedItem("completed");
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
                    updateEditedItem("completed");
                  }}
                >
                  Salvar alteracoes
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
