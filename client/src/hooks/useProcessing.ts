// client/src/hooks/useProcessing.ts
import React from "react";
import type { FlashcardNew, FlashcardOld, AppMode, AppState, ProcessingProgress } from "../types";
import { mergeCardsByBaseForm, saveFormTranslations, splitIntoSentences } from "../utils/cardUtils";

// Retry-очередь и обработка ошибок
import { useRetryQueue } from "./useRetryQueue";
import { analyzeError, type ErrorInfo, ErrorType } from "../utils/error-handler";

// Клиент событий/ретраев (оставляем подписку на события)
import { apiClient } from "../services/ApiClient";

// Batch + последовательный tool-calling
import { callClaudeBatch, fetchBatchResults, processChunkWithTools } from "../claude-batch";

// Конфиг (для флагов интерфейса и т.п.)
import { defaultConfig } from "../config";

/** Хук верхнего уровня для обработки текста в карточки */
export function useProcessing(
  inputText: string,
  setMode: (mode: AppMode) => void,
  setInputText?: (text: string) => void,
  setCurrentIndex?: (index: number) => void,
  setFlipped?: (flipped: boolean) => void
) {
  // Основные состояния
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

  // Персистентная retry-очередь
  const retryQueue = useRetryQueue();

  // Подписка на события ApiClient (для глобального статуса/очереди)
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
        chunkInfo: (chunkInfo as any)?.description || "unknown-chunk",
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
        console.log("➕ Добавляем в retry queue из-за исчерпания автоматических попыток");
        retryQueue.enqueue(
          (chunkInfo as any).originalChunk,
          errorInfo,
          (chunkInfo as any).description || `chunk-${Date.now()}`
        );
      }
    };

    const handleRateLimit = (errorInfo: ErrorInfo) => {
      console.warn("⚠️ Rate limit обнаружен:", errorInfo.userMessage);
    };

    const handleApiOverload = (errorInfo: ErrorInfo) => {
      console.warn("⚠️ API перегружен:", errorInfo.userMessage);
    };

    apiClient.on("requestError", handleRequestError);
    apiClient.on("rateLimited", handleRateLimit);
    apiClient.on("apiOverloaded", handleApiOverload);

    return () => {
      apiClient.off("requestError", handleRequestError);
      apiClient.off("rateLimited", handleRateLimit);
      apiClient.off("apiOverloaded", handleApiOverload);
    };
  }, [retryQueue.enqueue]);

  // Сохраняем переводы форм слов в глобальном состоянии (новая схема карточек поддерживается)
  const saveForms = React.useCallback((cards: FlashcardNew[] | FlashcardOld[]) => {
    setFormTranslations(prev => saveFormTranslations(cards as any, prev));
  }, []);

  // Последовательная обработка одного чанка (используем стабильный tool-calling слой)
  const processChunkWithContext = React.useCallback(
    async (
      chunk: string,
      chunkIndex: number,
      totalChunks: number,
      contextChunks?: string[]
    ): Promise<FlashcardNew[]> => {
      console.log(
        `🔄 Обработка чанка ${chunkIndex + 1}/${totalChunks}: "${chunk.substring(0, 50)}..."`
      );

      try {
        // Возвращает уже нормализованные Card[] (новая схема)
        const cards = await processChunkWithTools(
          chunk,
          chunkIndex,
          totalChunks,
          contextChunks || []
        );

        // На всякий случай сольём повторяющиеся base_form в чанкe (idempotent)
        const merged = mergeCardsByBaseForm(cards as any) as FlashcardNew[];

        // Сохраняем формы для глобальной таблицы переводов форм
        saveForms(merged);

        console.log(`✅ Чанк ${chunkIndex + 1} успешно обработан: ${merged.length} карточек`);
        return merged;
      } catch (error) {
        console.error(`❌ Ошибка при обработке чанка ${chunkIndex + 1}:`, error);
        const errorInfo = analyzeError(error);

        // Карточка-ошибка для UI (видима и помечена к повторной обработке)
        const errorCard: FlashcardNew = {
          // @ts-expect-error: временная совместимость со старым интерфейсом
          id: `error_${Date.now()}_${Math.random()}`,
          base_form: errorInfo.userMessage,
          base_translation: errorInfo.recommendation,
          contexts: [
            {
              // поля в терминах новой схемы
              // @ts-expect-error: допускаем старые поля для обратной совместимости UI
              latvian: chunk.substring(0, 100) + (chunk.length > 100 ? "..." : ""),
              // @ts-expect-error
              russian: errorInfo.recommendation,
              // @ts-expect-error
              word_in_context: errorInfo.type,
              // новая схема допускает forms, но тут можно опустить
            } as any,
          ],
          visible: true,
          // @ts-expect-error
          needsReprocessing: true,
        } as any;

        return [errorCard];
      }
    },
    [saveForms]
  );

  // Собираем общий перевод по контекстам карточек
  const generateTranslation = React.useCallback((cards: FlashcardNew[]) => {
    const translations = new Set<string>();
    cards.forEach(card => {
      (card as any).contexts?.forEach((ctx: any) => {
        // поддерживаем и новую (`russian`), и старую (`phrase_translation`) схемы
        const t = (ctx?.russian || ctx?.phrase_translation || "").trim();
        if (t) translations.add(t);
      });
    });
    setTranslationText(Array.from(translations).join(" "));
  }, []);

  // Обработка retry-очереди
  const processRetryQueue = React.useCallback(
    async (onProgress?: (current: number, total: number) => void) => {
      console.log("🚀 Начинаем обработку retry queue");
      setState("loading");

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
        console.log("🏁 Retry queue обработан:", results);

        if (results.cards && results.cards.length > 0) {
          (results.cards as any[]).forEach((card: any) => (card.visible = true));

          const cleanedPrev = flashcards.filter(
            c => !(c as { needsReprocessing?: boolean }).needsReprocessing
          );
          const merged = mergeCardsByBaseForm([
            ...(cleanedPrev as any[]),
            ...(results.cards as any[]),
          ]);

          setFlashcards(merged as any);
          generateTranslation(merged as any);
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
        console.error("❌ Ошибка при обработке retry queue:", error);
        throw error;
      } finally {
        setProcessingProgress({ current: 0, total: 0, step: "" });
      }
    },
    [retryQueue.processQueue, flashcards, setFlashcards, setState, setMode, generateTranslation]
  );

  // Основная функция обработки текста
  const processText = React.useCallback(async () => {
    if (!inputText.trim()) {
      console.warn("⚠️ Пустой текст для обработки");
      return;
    }

    console.log("🚀 Начинаем обработку текста:", inputText.substring(0, 100) + "...");
    setState("loading");
    setFlashcards([] as any);
    setTranslationText("");
    setFormTranslations(new Map());
    setBatchId(null);
    setBatchError(null);

    try {
      // Разбиваем на предложения
      const sentences = splitIntoSentences(inputText);
      console.log(`📝 Текст разбит на ${sentences.length} предложений`);

      // Формируем чанки (по одному предложению)
      const chunkSize = 1;
      const chunks: string[] = [];
      for (let i = 0; i < sentences.length; i += chunkSize) {
        const chunk = sentences
          .slice(i, i + chunkSize)
          .join(" ")
          .trim();
        if (chunk) chunks.push(chunk);
      }
      console.log(`📦 Создано ${chunks.length} чанков для обработки`);

      if (isBatchEnabled && chunks.length > 1000) {
        alert("❗️Слишком много предложений для пакетной обработки. Пожалуйста, сократите текст.");
        setState("input");
        return;
      }

      setProcessingProgress({
        current: 0,
        total: chunks.length,
        step: "Подготовка к обработке...",
      });

      if (isBatchEnabled) {
        // Пакетная обработка
        setProcessingProgress({ current: 0, total: chunks.length, step: "Создание batch..." });
        try {
          const { batchId: createdBatchId } = await callClaudeBatch(chunks);
          setBatchId(createdBatchId);

          // сохраним историю
          const history = JSON.parse(localStorage.getItem("batchHistory") || "[]");
          history.unshift(createdBatchId);
          localStorage.setItem("batchHistory", JSON.stringify(history.slice(0, 20)));

          const resultCards = await fetchBatchResults(createdBatchId); // уже слиты по base_form
          (resultCards as any[]).forEach((c: any) => (c.visible = true));

          // финальная сборка
          const mergedCards = mergeCardsByBaseForm(resultCards as any);
          setFlashcards(mergedCards as any);
          generateTranslation(mergedCards as any);
        } catch (e) {
          console.error("❌ Batch processing failed:", e);
          setBatchError(e as Error);
          setState("input");
          return;
        }
      } else {
        // Последовательная обработка
        const allCards: FlashcardNew[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setProcessingProgress({
            current: i + 1,
            total: chunks.length,
            step: `Обработка чанка ${i + 1} из ${chunks.length}`,
          });

          console.log(`📦 Обрабатываем чанк ${i + 1}/${chunks.length}`);
          const chunkCards = await processChunkWithContext(chunks[i], i, chunks.length, chunks);

          if (chunkCards && chunkCards.length > 0) {
            allCards.push(...(chunkCards as any));
          }

          // Небольшая пауза для спокойного лимита
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const mergedCards = mergeCardsByBaseForm(allCards as any);
        console.log(
          `🎉 Обработка завершена: ${mergedCards.length} уникальных карточек из ${allCards.length} общих`
        );

        setFlashcards(mergedCards as any);
        generateTranslation(mergedCards as any);
      }

      setMode("flashcards");
      setCurrentIndex?.(0);
      setFlipped?.(false);
      setState("ready");
    } catch (error) {
      console.error("💥 Критическая ошибка обработки:", error);
      setState("input");
      setProcessingProgress({ current: 0, total: 0, step: "Ошибка обработки" });
    }
  }, [inputText, isBatchEnabled, processChunkWithContext, setMode, generateTranslation]);

  // CRUD по карточкам
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

    // очистка очереди ошибок
    retryQueue.clearQueue();
  }, [retryQueue.clearQueue, setInputText]);

  // Экспортируем API хука
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
