// client/src/hooks/useProcessing.ts
import React from "react";
import type { FlashcardNew, FlashcardOld, AppMode, AppState, ProcessingProgress } from "../types";
import {
  normalizeCards,
  mergeCardsByBaseForm,
  saveFormTranslations,
  splitIntoSentences,
} from "../utils/cardUtils";

// НОВЫЕ ИМПОРТЫ - интеграция с модульной архитектурой
import { useRetryQueue } from "./useRetryQueue";
import { analyzeError, type ErrorInfo } from "../utils/error-handler";
import { apiClient } from "../services/ApiClient";
import {
  callClaudeBatch,
  fetchBatchResults,
  buildFlashcardPrompt,
  FLASHCARD_TOOL,
} from "../claude-batch"; // 🚀 берем промпт и инструмент из batch-модуля

// ИСПОЛЬЗУЕМ СУЩЕСТВУЮЩУЮ КОНФИГУРАЦИЮ ПРОЕКТА
import { defaultConfig } from "../config";

import { ErrorType } from "../utils/error-handler";

// --- ВСПОМОГАТЕЛЬНЫЕ ТИПЫ ДЛЯ ПАРСИНГА ОТВЕТА ---
interface ApiCardContext {
  latvian?: string;
  russian?: string;
  // НОВОЕ: поддержка новой структуры контекста из Card
  forms?: { form: string; translation: string }[];
  word_in_context?: string; // историческое поле, оставляем для совместимости
}

interface ApiCard {
  id?: string;
  unit?: "word" | "phrase";
  base_form?: string;
  front?: string;
  base_translation?: string;
  translations?: string[];
  text_forms?: string[];
  word_form_translation?: string;
  word_form_translations?: string[];
  original_phrase?: string;
  phrase_translation?: string;
  contexts?: ApiCardContext[];
}

export function useProcessing(
  inputText: string,
  setMode: (mode: AppMode) => void,
  setInputText?: (text: string) => void,
  setCurrentIndex?: (index: number) => void,
  setFlipped?: (flipped: boolean) => void
) {
  // Основные состояния приложения
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

  // НОВОЕ: Интеграция retry queue для персистентной обработки ошибок
  const retryQueue = useRetryQueue();

  // НОВОЕ: Подписка на события ApiClient для автоматического мониторинга ошибок
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

      // Если сеть недоступна или прокси выключен — сразу кладем в очередь,
      // чтобы статус-бар отобразился до завершения автоматических повторов
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

    // Подписываемся на события ApiClient
    apiClient.on("requestError", handleRequestError);
    apiClient.on("rateLimited", handleRateLimit);
    apiClient.on("apiOverloaded", handleApiOverload);

    return () => {
      // Отписываемся при размонтировании компонента
      apiClient.off("requestError", handleRequestError);
      apiClient.off("rateLimited", handleRateLimit);
      apiClient.off("apiOverloaded", handleApiOverload);
    };
  }, [retryQueue.enqueue]);

  // Функция сохранения переводов форм слов в глобальном состоянии
  const saveForms = React.useCallback((cards: FlashcardOld[]) => {
    setFormTranslations(prev => saveFormTranslations(cards, prev));
  }, []);

  // ОБНОВЛЕННАЯ функция обработки одного чанка с интеграцией инструмента (tool_use)
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

      // 🚨 Безопасная обработка контекстов
      const safeContextChunks = contextChunks || [];
      const prevChunk = chunkIndex > 0 ? safeContextChunks[chunkIndex - 1] : "";
      const nextChunk =
        chunkIndex < safeContextChunks.length - 1 ? safeContextChunks[chunkIndex + 1] : "";

      try {
        // 🧠 НОВОЕ: используем промпт из Этапа 2
        const config = defaultConfig.processing;
        const prompt = buildFlashcardPrompt({
          chunkText: chunk,
          chunkIndex,
          totalChunks,
          enablePhraseExtraction: !!config.enablePhraseExtraction,
          prevText: prevChunk || undefined,
          nextText: nextChunk || undefined,
        });

        // 🚀 НОВОЕ: sequential вызов с tools/tool_choice через ApiClient
        const raw = await apiClient.request(prompt, {
          enableEvents: true, // ✅ события нужны для UI-баров
          chunkInfo: {
            description: `chunk-${chunkIndex + 1}-of-${totalChunks}`,
            originalChunk: chunk,
            index: chunkIndex,
            total: totalChunks,
          },
          // КРИТИЧЕСКОЕ: передаём инструменты к запросу
          tools: [FLASHCARD_TOOL],
          tool_choice: { type: "tool", name: "create_flashcards" },
        });

        // Поддержка структурированных ошибок (обратная совместимость)
        if (raw.startsWith("[ERROR:")) {
          const errorData = JSON.parse(raw.slice(7, -1));
          const errorInfo = analyzeError(errorData);

          console.log("📦 Структурированная ошибка получена:", errorInfo.userMessage);

          const errorCard: FlashcardNew = {
            // @ts-expect-error: временная совместимость со старым интерфейсом
            id: `error_${Date.now()}_${Math.random()}`,
            base_form: `error_${errorInfo.type}_${Date.now()}`,
            // @ts-expect-error: историческое поле
            word_type: "other",
            // @ts-expect-error: историческое поле
            translations: [errorInfo.userMessage],
            contexts: [
              {
                // @ts-expect-error: историческое поле
                latvian: chunk.substring(0, 100) + (chunk.length > 100 ? "..." : ""),
                // @ts-expect-error: историческое поле
                russian: errorInfo.recommendation,
                // @ts-expect-error: историческое поле
                word_in_context: errorInfo.type,
              } as any,
            ] as any,
            visible: true,
            // @ts-expect-error: историческое поле
            needsReprocessing: true,
          } as any;

          return [errorCard];
        }

        // 🔧 Проверка на ошибки прокси
        if (raw.startsWith("[Error:") || raw.includes("Error: Pro")) {
          console.log("🔴 Обнаружена ошибка прокси сервера:", raw.substring(0, 100));
          throw new Error("🔴 Ошибка сети - прокси сервер недоступен");
        }

        // 🧹 Чистим Markdown-обёртки, если вдруг модель вернула text вместо tool_use
        const cleanedText = raw
          .replace(/```json\s*/g, "")
          .replace(/```\s*$/g, "")
          .trim();

        if (cleanedText.startsWith("[Error:") || cleanedText.includes("Error:")) {
          throw new Error(`🔴 Ошибка сервера: ${cleanedText.substring(0, 100)}`);
        }

        // 📦 Парсим ответ: поддерживаем { flashcards } и массив
        let parsed: any;
        try {
          parsed = JSON.parse(cleanedText);
        } catch (e) {
          // Если sequential не вернул JSON — это ошибка контракта (инструмент не сработал)
          throw new Error("Invalid JSON from Claude in sequential mode");
        }

        const arrayLike = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.flashcards)
            ? parsed.flashcards
            : [parsed];

        // 🔁 Преобразуем в совместимый со старым кодом формат FlashcardOld
        const oldCards: FlashcardOld[] = arrayLike.flatMap((card: ApiCard) => {
          const baseForm = card.base_form || card.front || "";
          const baseTrans =
            card.base_translation ||
            (Array.isArray(card.translations) ? card.translations[0] : "") ||
            "";

          // Если есть contexts — разворачиваем по ним; иначе используем чанк как fallback контекст
          if (!Array.isArray(card.contexts) || card.contexts.length === 0) {
            // Попробуем вытащить формы из верхнего уровня (старый формат) или fallback в front
            const textForms: string[] = Array.isArray(card.text_forms)
              ? card.text_forms
              : card.front
                ? [card.front]
                : [];

            const formTrans =
              card.word_form_translation ||
              (Array.isArray(card.word_form_translations)
                ? card.word_form_translations[0]
                : undefined) ||
              (Array.isArray(card.translations) ? card.translations[0] : "") ||
              "";

            return [
              {
                front: card.front || textForms[0] || baseForm,
                back: formTrans,
                word_form_translation: formTrans,
                base_form: baseForm,
                base_translation: baseTrans,
                original_phrase: card.original_phrase || chunk,
                phrase_translation: card.phrase_translation || "",
                text_forms: textForms,
                visible: true,
              } as FlashcardOld,
            ];
          }

          // Разворачиваем по каждому контексту новой схемы
          return card.contexts.map(ctx => {
            const ctxTextForms = Array.isArray(ctx.forms)
              ? ctx.forms.map(f => f.form).filter(Boolean)
              : Array.isArray(card.text_forms)
                ? card.text_forms
                : card.front
                  ? [card.front]
                  : [];

            const ctxFormTrans =
              (Array.isArray(ctx.forms) && ctx.forms[0]?.translation) ||
              card.word_form_translation ||
              (Array.isArray(card.word_form_translations)
                ? card.word_form_translations[0]
                : undefined) ||
              (Array.isArray(card.translations) ? card.translations[0] : "") ||
              "";

            const original_phrase = ctx.latvian || card.original_phrase || chunk;
            const phrase_translation = ctx.russian || card.phrase_translation || "";

            return {
              front: ctxTextForms[0] || card.front || baseForm,
              back: ctxFormTrans,
              word_form_translation: ctxFormTrans,
              base_form: baseForm,
              base_translation: baseTrans,
              original_phrase,
              phrase_translation,
              text_forms: ctxTextForms,
              visible: true,
            } as FlashcardOld;
          });
        });

        const normalizedCards = normalizeCards(oldCards, chunk);
        const processedCards = mergeCardsByBaseForm(normalizedCards);

        console.log(
          `✅ Чанк ${chunkIndex + 1} успешно обработан: ${processedCards.length} карточек`
        );

        // Сохраняем переводы форм слов в глобальном состоянии
        saveForms(normalizedCards);

        return processedCards as unknown as FlashcardNew[];
      } catch (error) {
        // 🛠️ Подробное логирование
        console.error(`❌ Ошибка при обработке чанка ${chunkIndex + 1}:`, error);
        if (error instanceof Error && error.stack) {
          console.error(error.stack);
        }

        // Анализ и классификация ошибки
        const errorInfo = analyzeError(error);

        console.error(`❌ Ошибка при обработке чанка ${chunkIndex + 1}:`, errorInfo.userMessage);

        // Error-карточка для UI
        const errorCard: FlashcardNew = {
          // @ts-expect-error: временная совместимость со старым интерфейсом
          id: `error_${Date.now()}_${Math.random()}`,
          base_form: errorInfo.userMessage,
          base_translation: errorInfo.recommendation,
          // @ts-expect-error
          word_type: "other",
          // @ts-expect-error
          translations: [errorInfo.userMessage],
          contexts: [
            {
              // @ts-expect-error
              latvian: chunk.substring(0, 100) + (chunk.length > 100 ? "..." : ""),
              // @ts-expect-error
              russian: errorInfo.recommendation,
              // @ts-expect-error
              word_in_context: errorInfo.type,
            } as any,
          ] as any,
          visible: true,
          // @ts-expect-error
          needsReprocessing: true,
        } as any;

        return [errorCard];
      }
    },
    [saveForms]
  );

  const generateTranslation = React.useCallback((cards: FlashcardNew[]) => {
    const translations = new Set<string>();
    cards.forEach(card => {
      (card as any).contexts.forEach((ctx: any) => {
        const text = ctx.phrase_translation?.trim();
        if (text) translations.add(text);
      });
    });
    setTranslationText(Array.from(translations).join(" "));
  }, []);

  // НОВОЕ: Функция обработки retry queue с прогрессом
  const processRetryQueue = React.useCallback(
    async (onProgress?: (current: number, total: number) => void) => {
      console.log("🚀 Начинаем обработку retry queue");

      // Устанавливаем состояние обработки
      setState("loading");

      // Создаем callback для обновления прогресса
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
          const merged = mergeCardsByBaseForm([...cleanedPrev, ...(results.cards as any[])]);
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
        // Очищаем прогресс после завершения
        setProcessingProgress({ current: 0, total: 0, step: "" });
      }
    },
    [retryQueue.processQueue, flashcards, setFlashcards, setState, setMode, generateTranslation]
  );

  // Основная функция обработки текста (чанк-за-чанком)
  const processText = React.useCallback(async () => {
    if (!inputText.trim()) {
      console.warn("⚠️ Пустой текст для обработки");
      return;
    }

    console.log("🚀 Начинаем обработку текста:", inputText.substring(0, 100) + "...");

    // Переводим в состояние загрузки и очищаем предыдущие данные
    setState("loading");
    setFlashcards([] as any);
    setTranslationText("");
    setFormTranslations(new Map());
    setBatchId(null);
    setBatchError(null);

    try {
      // Разбиваем текст на предложения
      const sentences = splitIntoSentences(inputText);
      console.log(`📝 Текст разбит на ${sentences.length} предложений`);

      // Группируем предложения в чанки по 1
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

      const allCards: FlashcardNew[] = [];

      if (isBatchEnabled) {
        setProcessingProgress({ current: 0, total: chunks.length, step: "Создание batch..." });
        try {
          const { batchId: createdBatchId } = await callClaudeBatch(chunks);
          setBatchId(createdBatchId);

          const history = JSON.parse(localStorage.getItem("batchHistory") || "[]");
          history.unshift(createdBatchId);
          localStorage.setItem("batchHistory", JSON.stringify(history.slice(0, 20)));

          const resultCards = await fetchBatchResults(createdBatchId);
          (resultCards as any[]).forEach((card: any) => (card.visible = true));

          const mergedCards = normalizeCards(resultCards as any, inputText); // 💡 Здесь уже есть merge внутри
          setFlashcards(mergedCards as any);
          generateTranslation(mergedCards as any);
        } catch (e) {
          console.error("❌ Batch processing failed:", e);
          setBatchError(e as Error);
          setState("input");
          return;
        }
      } else {
        // Обрабатываем каждый чанк последовательно
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

          // Задержка между запросами для соблюдения rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Объединяем карточки с одинаковыми base_form
      const mergedCards = mergeCardsByBaseForm(allCards as any);

      console.log(
        `🎉 Обработка завершена: ${mergedCards.length} уникальных карточек из ${allCards.length} общих`
      );

      // Устанавливаем финальные данные
      setFlashcards(mergedCards as any);
      generateTranslation(mergedCards as any);
      setMode("flashcards");
      setCurrentIndex?.(0);
      setFlipped?.(false);
      setState("ready");
    } catch (error) {
      console.error("💥 Критическая ошибка обработки:", error);
      setState("input");
      setProcessingProgress({
        current: 0,
        total: 0,
        step: "Ошибка обработки",
      });
    }
  }, [inputText, processChunkWithContext, setMode, generateTranslation, isBatchEnabled, saveForms]);

  // Функция обновления отдельной карточки
  const updateCard = React.useCallback((index: number, field: string, value: unknown) => {
    setFlashcards(prev => {
      const copy = [...(prev as any[])];
      if (copy[index]) {
        (copy[index] as unknown as Record<string, unknown>)[field] = value;
      }
      return copy as any;
    });
  }, []);

  // Функция переключения видимости карточки
  const toggleCardVisibility = React.useCallback((index: number) => {
    setFlashcards(prev => {
      const copy = [...(prev as any[])];
      if (copy[index]) {
        copy[index] = { ...(copy[index] as any), visible: !(copy[index] as any).visible };
      }
      return copy as any;
    });
  }, []);

  // Функция удаления карточки
  const deleteCard = React.useCallback((index: number) => {
    setFlashcards(prev => (prev as any[]).filter((_, i) => i !== index) as any);
  }, []);

  // Функция добавления новой карточки
  const addNewCard = React.useCallback(() => {
    const newCard: FlashcardNew = {
      base_form: "",
      base_translation: "",
      contexts: [] as any,
      visible: true,
    } as any;
    setFlashcards(prev => [newCard, ...(prev as any[])] as any);
  }, []);

  // Функция полной очистки всех данных
  const clearAll = React.useCallback(() => {
    console.log("🧹 Полная очистка всех данных");

    setFlashcards([] as any);
    setTranslationText("");
    setFormTranslations(new Map());
    setState("input");
    setProcessingProgress({ current: 0, total: 0, step: "" });

    if (setInputText) {
      setInputText("");
    }

    // НОВОЕ: Очищаем retry queue при полной очистке
    retryQueue.clearQueue();
  }, [retryQueue.clearQueue, setInputText]);

  // Возвращаем все состояния и функции для использования в компонентах
  return {
    // Основные состояния
    state,
    flashcards,
    translationText,
    processingProgress,
    formTranslations,

    // Основные функции обработки и управления
    processText,
    updateCard,
    toggleCardVisibility,
    deleteCard,
    addNewCard,
    clearAll,

    // Сеттеры для прямого управления состоянием (для импорта/экспорта)
    setFlashcards,
    setTranslationText,
    setState,
    setFormTranslations,

    // Batch режим
    isBatchEnabled,
    setBatchEnabled,
    batchId,
    batchError,

    // НОВОЕ: Retry функциональность для обработки ошибок
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
