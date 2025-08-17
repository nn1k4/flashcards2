// client/src/hooks/useProcessing.ts
import React from "react";
import type { FlashcardNew, FlashcardOld, AppMode, AppState, ProcessingProgress } from "../types";
import { mergeCardsByBaseForm, saveFormTranslations, splitIntoSentences } from "../utils/cardUtils";

// Retry-очередь и обработка ошибок
import { useRetryQueue } from "./useRetryQueue";
import { analyzeError, type ErrorInfo, ErrorType } from "../utils/error-handler";

// Клиент событий/ретраев
import { apiClient } from "../services/ApiClient";

// Batch + последовательный tool-calling
import {
  callClaudeBatch,
  fetchBatchResults,
  processChunkWithTools,
  type BatchProgress,
} from "../claude-batch";

/* =============================================================================
 * Н О Р М А Л И З А Ц И Я  /  Я К О Р Я  /  С Б О Р К А   П Е Р Е В О Д А
 * ============================================================================= */

/** Склей переносы, убери «шум» (скобки/кавычки/тире), нормализуй пробелы */
const norm = (s: string) =>
  (s ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[«»“”"(){}\[\]—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Ключ сравнения: нижний регистр и без финальной пунктуации */
const normKey = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/[.?!…:;]+$/u, "")
    .trim();

/** Гарантировать точку в конце предложения (если нет) */
const ensureSentenceEnding = (s: string) => (/[.?!…]$/.test(s) ? s : s + ".");

/** Достаём RU-перевод из контекста (поддержка старых полей) */
const ctxRussian = (ctx: any): string =>
  norm(
    (ctx?.russian ??
      ctx?.phrase_translation ??
      ctx?.sentence_translation ??
      ctx?.translation ??
      "") as string
  );

/** Проставляем sid в contexts там, где его нет (по точному LV-совпадению) */
function attachSidIfMissing(cards: FlashcardNew[], sentencesNorm: string[]): FlashcardNew[] {
  const sentenceKeys = sentencesNorm.map(normKey);
  return (cards || []).map(card => {
    const ctxs = Array.isArray(card?.contexts) ? card.contexts : [];
    const newCtxs = ctxs.map((ctx: any) => {
      // если sid валиден — оставляем, иначе пытаемся определить по LV
      if (Number.isFinite(ctx?.sid)) {
        const sid = Number(ctx.sid);
        return sid >= 0 && sid < sentencesNorm.length ? ctx : { ...ctx, sid: undefined };
      }
      const lvK = normKey(ctx?.latvian || "");
      if (!lvK) return { ...ctx };
      const idx = sentenceKeys.indexOf(lvK);
      return idx >= 0 ? { ...ctx, sid: idx } : { ...ctx };
    });
    return { ...(card as any), contexts: newCtxs } as FlashcardNew;
  });
}

/** Выбор канонического RU-перевода из множества вариантов */
function pickCanonicalTranslation(rus: string[]): string | undefined {
  const freq = new Map<string, { count: number; original: string }>();
  for (const r of rus) {
    const k = normKey(r);
    if (!k) continue;
    const entry = freq.get(k);
    if (entry) {
      entry.count++;
      if (r.length > entry.original.length) entry.original = r;
    } else {
      freq.set(k, { count: 1, original: r });
    }
  }
  if (freq.size === 0) return undefined;

  let best: { count: number; original: string } | null = null;
  for (const [, v] of freq) {
    if (
      !best ||
      v.count > best.count ||
      (v.count === best.count && v.original.length > best.original.length)
    ) {
      best = { count: v.count, original: v.original };
    }
  }
  return best ? ensureSentenceEnding(best.original) : undefined;
}

/** Фолбэк: если по якорям собрать нечего — уникальные RU из всех контекстов (порядок не гарантирован) */
function fallbackUniqueRussian(cards: FlashcardNew[]): string {
  return Array.from(
    new Set(
      (cards as any[]).flatMap(c => ((c?.contexts as any[]) || []).map(ctxRussian)).filter(Boolean)
    )
  ).join(" ");
}

/* =============================================================================
 * Е Д И Н Ы Й   И С Т О Ч Н И К   И С Т И Н Ы   Д Л Я   П О Р Я Д К А
 * ============================================================================= */

/** Строка предложений (сидируемый порядок + текущий перевод) */
type SentenceRow = {
  index: number;
  original: string; // как показывать
  normalized: string; // как сопоставлять
  translation: string; // RU для данного индекса
};

/** Собираем карту sid -> варианты RU из карточек */
function collectRuBySid(cards: FlashcardNew[], totalSentences: number): Map<number, string[]> {
  const ruBySid = new Map<number, string[]>();
  for (const c of cards || []) {
    for (const ctx of (c.contexts as any[]) || []) {
      const sid = Number(ctx?.sid);
      if (!Number.isFinite(sid) || sid < 0 || sid >= totalSentences) continue;
      const ru = ctxRussian(ctx);
      if (!ru) continue;
      const arr = ruBySid.get(sid) || [];
      arr.push(ru);
      ruBySid.set(sid, arr);
    }
  }
  return ruBySid;
}

/** Заполняем переводы предложений на основании ruBySid (детерминированно) */
function fillSentenceTranslations(
  sentences: SentenceRow[],
  ruBySid: Map<number, string[]>
): SentenceRow[] {
  return sentences.map(row => {
    const options = ruBySid.get(row.index) || [];
    const chosen = pickCanonicalTranslation(options) || row.translation || "";
    return { ...row, translation: chosen };
  });
}

/** Склеиваем полный перевод в исходном порядке предложений */
function joinFullTranslation(sentences: SentenceRow[]): string {
  return sentences
    .map(s => (s.translation || "").trim())
    .filter(s => s.length > 0)
    .join(" ");
}

/* =============================================================================
 *   О С Н О В Н О Й   Х У К
 * ============================================================================= */

export function useProcessing(
  inputText: string,
  setMode: (mode: AppMode) => void,
  setInputText?: (text: string) => void,
  setCurrentIndex?: (index: number) => void,
  setFlipped?: (flipped: boolean) => void
) {
  // UI-состояния
  const [state, setState] = React.useState<AppState>("input");
  const [flashcards, setFlashcards] = React.useState<FlashcardNew[]>([]);
  const [translationText, setTranslationText] = React.useState("");

  const [processingProgress, setProcessingProgress] = React.useState<ProcessingProgress>({
    current: 0,
    total: 0,
    step: "",
  });

  const [formTranslations, setFormTranslations] = React.useState<Map<string, string>>(new Map());
  const [isBatchEnabled, setBatchEnabled] = React.useState(false);
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [batchError, setBatchError] = React.useState<Error | null>(null);

  // Единый источник истины по порядку и переводам
  const [sentences, setSentences] = React.useState<SentenceRow[]>([]);

  // Токен запуска — защита от гонок
  const runTokenRef = React.useRef(0);
  const nextRunToken = () => ++runTokenRef.current;

  // Персистентная retry-очередь
  const retryQueue = useRetryQueue();

  /* ---------------------------- Подписки ApiClient ---------------------------- */
  React.useEffect(() => {
    const handleRequestError = (eventData: {
      errorInfo: ErrorInfo;
      chunkInfo?: { description?: string; originalChunk?: string } | string;
      willRetry: boolean;
    }) => {
      const { errorInfo, chunkInfo, willRetry } = eventData;
      console.log("🔍 ApiClient error event:", {
        errorType: errorInfo.type,
        willRetry,
        chunk: (chunkInfo as any)?.description || "unknown",
      });

      if (
        errorInfo.type === ErrorType.NETWORK_ERROR ||
        errorInfo.type === ErrorType.PROXY_UNAVAILABLE
      ) {
        retryQueue.enqueue(
          (chunkInfo as any)?.originalChunk || "",
          errorInfo,
          (chunkInfo as any)?.description || `chunk-${Date.now()}`
        );
      } else if (!willRetry && errorInfo.retryable && (chunkInfo as any)?.originalChunk) {
        retryQueue.enqueue(
          (chunkInfo as any).originalChunk,
          errorInfo,
          (chunkInfo as any).description || `chunk-${Date.now()}`
        );
      }
    };

    const handleRateLimit = (errorInfo: ErrorInfo) =>
      console.warn("⚠️ Rate limit:", errorInfo.userMessage);
    const handleApiOverload = (errorInfo: ErrorInfo) =>
      console.warn("⚠️ API overloaded:", errorInfo.userMessage);

    apiClient.on("requestError", handleRequestError);
    apiClient.on("rateLimited", handleRateLimit);
    apiClient.on("apiOverloaded", handleApiOverload);

    return () => {
      apiClient.off("requestError", handleRequestError);
      apiClient.off("rateLimited", handleRateLimit);
      apiClient.off("apiOverloaded", handleApiOverload);
    };
  }, [retryQueue.enqueue]);

  /* --------------------- Сохранение переводов словоформ ---------------------- */
  const saveForms = React.useCallback((cards: FlashcardNew[] | FlashcardOld[]) => {
    setFormTranslations(prev => saveFormTranslations(cards as any, prev));
  }, []);

  /* -------------------- Обработка одного чанка (последовательно) -------------------- */
  const processChunkWithContextCb = React.useCallback(
    async (
      chunk: string,
      chunkIndex: number,
      totalChunks: number,
      contextChunks?: string[]
    ): Promise<FlashcardNew[]> => {
      const head = `🔄 Чанк ${chunkIndex + 1}/${totalChunks}`;
      console.log(`${head}: "${chunk.substring(0, 80)}${chunk.length > 80 ? "..." : ""}"`);

      try {
        const cards = await processChunkWithTools(
          chunk,
          chunkIndex,
          totalChunks,
          contextChunks || []
        );

        // merge по чанку + сохраним словоформы
        const mergedPerChunk = mergeCardsByBaseForm(cards as any) as FlashcardNew[];
        saveForms(mergedPerChunk);

        console.log(`✅ ${head} обработан: ${mergedPerChunk.length} карточек`);
        return mergedPerChunk;
      } catch (error) {
        console.error(`❌ Ошибка при обработке ${head}:`, error);
        const errorInfo = analyzeError(error);

        const errorCard: FlashcardNew = {
          base_form: errorInfo.userMessage,
          base_translation: errorInfo.recommendation,
          contexts: [
            {
              latvian: chunk.substring(0, 120) + (chunk.length > 120 ? "..." : ""),
              russian: errorInfo.recommendation,
              // подсветим тип ошибки
              word_in_context: errorInfo.type,
              sid: chunkIndex, // привяжем к месту
            } as any,
          ],
          visible: true,
          // @ts-expect-error вспомогательный флаг для замены при retry
          needsReprocessing: true,
        } as any;

        return [errorCard];
      }
    },
    [saveForms]
  );

  /* ---------------------- Текст прогресса batch-процесса ---------------------- */
  const batchStepText = React.useCallback((p: BatchProgress, total: number) => {
    const { processing, succeeded, errored, canceled, expired } = p.request_counts;
    const done = succeeded + errored + canceled + expired;
    return `Batch ${p.processing_status}: ${done}/${total} (ok ${succeeded}, err ${errored}, canceled ${canceled}, expired ${expired}, processing ${processing})`;
  }, []);

  /* =============================================================================
   *                    О С Н О В Н А Я   О Б Р А Б О Т К А
   * ============================================================================= */
  const processText = React.useCallback(async () => {
    const text = inputText?.trim();
    if (!text) {
      console.warn("⚠️ Пустой текст для обработки");
      return;
    }

    const runId = nextRunToken();

    console.log(
      "🚀 Начинаем обработку текста:",
      text.substring(0, 100) + (text.length > 100 ? "…" : "")
    );
    setState("loading");

    // Полная очистка на старте
    setFlashcards([]);
    setTranslationText("");
    setFormTranslations(new Map());
    setBatchId(null);
    setBatchError(null);

    try {
      // 1) Разбить текст на предложения и подготовить единый список (единый источник истины порядка)
      const sentencesRaw = splitIntoSentences(text);
      const initialSentences: SentenceRow[] = sentencesRaw
        .map(s => s || "")
        .map((s, idx) => ({
          index: idx,
          original: s.trim(),
          normalized: norm(s),
          translation: "",
        }))
        .filter(r => r.normalized.length > 0);

      if (runTokenRef.current !== runId) return;
      setSentences(initialSentences);

      console.log(`📝 Разбито на предложения: ${initialSentences.length}`);

      // Чанки 1:1 с предложениями (используем нормализованные)
      const chunks: string[] = initialSentences.map(r => r.normalized);
      if (runTokenRef.current !== runId) return;
      console.log(`📦 Чанков к обработке: ${chunks.length}`);

      if (isBatchEnabled && chunks.length > 1000) {
        alert("❗️Слишком много предложений для пакетной обработки. Сократите текст.");
        setState("input");
        return;
      }

      setProcessingProgress({ current: 0, total: chunks.length, step: "Подготовка…" });

      /* ----------------------------- Пакетная обработка ----------------------------- */
      if (isBatchEnabled) {
        setProcessingProgress({ current: 0, total: chunks.length, step: "Создание batch…" });

        try {
          const { batchId: createdBatchId } = await callClaudeBatch(chunks);
          if (runTokenRef.current !== runId) return;

          setBatchId(createdBatchId);

          // история batch
          const history = JSON.parse(localStorage.getItem("batchHistory") || "[]");
          history.unshift(createdBatchId);
          localStorage.setItem("batchHistory", JSON.stringify(history.slice(0, 20)));

          // ВАЖНО: получаем и «сырые», и объединённые карточки
          const { rawCards, mergedCards } = await fetchBatchResults(
            createdBatchId,
            { pollIntervalMs: 3000, maxWaitMs: 10 * 60 * 1000, initialDelayMs: 1200 },
            (p: BatchProgress) => {
              if (runTokenRef.current !== runId) return;
              const { succeeded, errored, canceled, expired } = p.request_counts;
              const current = succeeded + errored + canceled + expired;
              setProcessingProgress({
                current,
                total: chunks.length,
                step: batchStepText(p, chunks.length),
              });
            }
          );
          if (runTokenRef.current !== runId) return;

          // 1) Перевод собираем ТОЛЬКО по «сырым» карточкам (чтобы ничего не потерять)
          const anchoredRaw = attachSidIfMissing(
            rawCards as any,
            initialSentences.map(s => s.normalized)
          );
          const ruBySidRaw = collectRuBySid(anchoredRaw as any, initialSentences.length);
          const filledFromRaw = fillSentenceTranslations(initialSentences, ruBySidRaw);
          const fullTranslation = joinFullTranslation(filledFromRaw);

          // 2) Для UI используем объединённые карточки
          const cardsForUi = attachSidIfMissing(
            mergedCards as any,
            initialSentences.map(s => s.normalized)
          );
          (cardsForUi as any[]).forEach((c: any) => (c.visible = true));
          saveForms(cardsForUi as any);

          // Обновляем состояния
          setSentences(filledFromRaw);
          setTranslationText(fullTranslation);
          setFlashcards(cardsForUi as any);

          console.log("🈯 [useProcessing] (batch) translation length:", fullTranslation.length);

          setMode("flashcards");
          setCurrentIndex?.(0);
          setFlipped?.(false);
          setState("ready");
          setProcessingProgress({ current: chunks.length, total: chunks.length, step: "Готово" });
        } catch (e) {
          if (runTokenRef.current !== runId) return;
          console.error("❌ Batch processing failed:", e);
          setBatchError(e as Error);
          setState("input");
          setProcessingProgress({ current: 0, total: 0, step: "Ошибка batch" });
          return;
        }

        return;
      }

      /* --------------------------- Последовательная обработка --------------------------- */
      const allCards: FlashcardNew[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (runTokenRef.current !== runId) return;

        setProcessingProgress({
          current: i + 1,
          total: chunks.length,
          step: `Обработка чанка ${i + 1} из ${chunks.length}`,
        });

        // Получаем карточки по текущему предложению
        const chunkCards = await processChunkWithContextCb(chunks[i], i, chunks.length, chunks);
        if (runTokenRef.current !== runId) return;

        if (chunkCards && chunkCards.length > 0) {
          allCards.push(...(chunkCards as any));
        }

        // лёгкий троттлинг лимитов
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      if (runTokenRef.current !== runId) return;

      // Объединяем карточки для UI
      const mergedCards = mergeCardsByBaseForm(allCards as any);

      // Видимость + словоформы
      (mergedCards as any[]).forEach((c: any) => (c.visible = true));
      saveForms(mergedCards as any);

      // Проставим sid и соберём карту RU по индексам
      const anchored = attachSidIfMissing(
        mergedCards as any,
        initialSentences.map(s => s.normalized)
      );
      const ruBySid = collectRuBySid(anchored as any, initialSentences.length);

      // Заполняем переводы в нашем едином массиве предложений (индекс → перевод)
      const filled = fillSentenceTranslations(initialSentences, ruBySid);
      const fullTranslation = joinFullTranslation(filled);

      setSentences(filled);
      setTranslationText(fullTranslation);
      setFlashcards(anchored as any);

      console.log(
        `🎉 Готово: ${anchored.length} карточек (после merge). Перевод длиной ${fullTranslation.length}`
      );

      setMode("flashcards");
      setCurrentIndex?.(0);
      setFlipped?.(false);
      setState("ready");
      setProcessingProgress({ current: chunks.length, total: chunks.length, step: "Готово" });
    } catch (error) {
      console.error("💥 Критическая ошибка обработки:", error);
      setState("input");
      setProcessingProgress({ current: 0, total: 0, step: "Ошибка обработки" });
    }
  }, [inputText, isBatchEnabled, processChunkWithContextCb, setMode, batchStepText, saveForms]);

  /* =============================================================================
   *       П О В Т О Р Н А Я   О Б Р А Б О Т К А   ( R E T R Y   Q U E U E )
   * ============================================================================= */
  const processRetryQueue = React.useCallback(
    async (onProgress?: (current: number, total: number) => void) => {
      console.log("🚀 Обработка retry queue…");
      setState("loading");
      const runId = nextRunToken();

      const progressCallback = (current: number, total: number) => {
        setProcessingProgress({
          current,
          total,
          step: `Повторная обработка ${current}/${total}`,
        });
        onProgress?.(current, total);
      };

      try {
        const results = await retryQueue.processQueue(progressCallback);
        console.log("🏁 Retry завершён:", results);
        if (runTokenRef.current !== runId) return results;

        if (results.cards && results.cards.length > 0) {
          (results.cards as any[]).forEach((c: any) => (c.visible = true));

          // Удаляем error-карточки, добавляем новые — и мержим
          const cleanedPrev = flashcards.filter(
            c => !(c as { needsReprocessing?: boolean }).needsReprocessing
          );
          const merged = mergeCardsByBaseForm([
            ...(cleanedPrev as any[]),
            ...(results.cards as any[]),
          ]) as FlashcardNew[];

          saveForms(merged as any);

          // Проставляем sid и пересобираем переводы предложений
          const currentSentences = sentences;
          const anchored = attachSidIfMissing(
            merged as any,
            currentSentences.map(s => s.normalized)
          );
          const ruBySid = collectRuBySid(anchored as any, currentSentences.length);
          const filled = fillSentenceTranslations(currentSentences, ruBySid);
          const fullTranslation = joinFullTranslation(filled);

          setSentences(filled);
          setTranslationText(fullTranslation);
          setFlashcards(anchored as any);

          setMode("flashcards");
          setCurrentIndex?.(0);
          setFlipped?.(false);
        }

        if (results.successful > 0) {
          setState("ready");
          setProcessingProgress({ current: 0, total: 0, step: "ready" });
        }

        return results;
      } catch (error) {
        console.error("❌ Ошибка retry queue:", error);
        throw error;
      } finally {
        if (runTokenRef.current === runId) {
          setProcessingProgress({ current: 0, total: 0, step: "" });
        }
      }
    },
    [retryQueue.processQueue, flashcards, sentences, setMode, saveForms]
  );

  /* =============================================================================
   *        А В Т О - Р Е П А И Р   (на случай редких пустых состояний)
   * ============================================================================= */
  React.useEffect(() => {
    if (
      state === "ready" &&
      flashcards.length > 0 &&
      sentences.length > 0 &&
      !translationText.trim()
    ) {
      const ruBySid = collectRuBySid(flashcards, sentences.length);
      const filled = fillSentenceTranslations(sentences, ruBySid);
      const fullTranslation = joinFullTranslation(filled);

      if (fullTranslation) {
        setSentences(filled);
        setTranslationText(fullTranslation);
        console.log("🛠 [useProcessing] auto-repair translation length:", fullTranslation.length);
      }
    }
  }, [state, flashcards, sentences, translationText]);

  /* =============================================================================
   *                        C R U D   /   Д Е Й С Т В И Я
   * ============================================================================= */

  const updateCard = React.useCallback((index: number, field: string, value: unknown) => {
    setFlashcards(prev => {
      const copy = [...(prev as any[])];
      if (copy[index]) {
        (copy[index] as any)[field] = value;
      }
      return copy as any;
    });
  }, []);

  const toggleCardVisibility = React.useCallback((index: number) => {
    setFlashcards(prev => {
      const copy = [...(prev as any[])];
      if (copy[index]) {
        copy[index] = { ...(copy[index] as any), visible: !(copy[index] as any).visible };
      }
      return copy as any;
    });
  }, []);

  const deleteCard = React.useCallback((index: number) => {
    setFlashcards(prev => (prev as any[]).filter((_, i) => i !== index) as any);
  }, []);

  const addNewCard = React.useCallback(() => {
    const newCard: FlashcardNew = {
      base_form: "",
      base_translation: "",
      contexts: [] as any,
      visible: true,
    } as any;
    setFlashcards(prev => [newCard, ...(prev as any[])] as any);
  }, []);

  const clearAll = React.useCallback(() => {
    console.log("🧹 Полная очистка всех данных");
    setFlashcards([] as any);
    setTranslationText("");
    setFormTranslations(new Map());
    setState("input");
    setProcessingProgress({ current: 0, total: 0, step: "" });
    setInputText?.("");
    setSentences([]);
    retryQueue.clearQueue();
  }, [retryQueue.clearQueue, setInputText]);

  /* =============================================================================
   *                            Э К С П О Р Т   A P I
   * ============================================================================= */

  return {
    // State
    state,
    flashcards,
    translationText,
    processingProgress,
    formTranslations,

    // Actions
    processText,
    updateCard,
    toggleCardVisibility,
    deleteCard,
    addNewCard,
    clearAll,

    // Direct set
    setFlashcards,
    setTranslationText,
    setState,
    setFormTranslations,

    // Batch
    isBatchEnabled,
    setBatchEnabled,
    batchId,
    batchError,

    // Retry
    processRetryQueue,
    retryQueue: {
      queue: retryQueue.queue,
      stats: retryQueue.stats,
      isProcessing: retryQueue.isProcessing,
      clearQueue: retryQueue.clearQueue,
      removeFromQueue: retryQueue.removeFromQueue,
    },
  };
}
