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
import { callClaudeBatch, fetchBatchResults } from "../claude-batch";

// ИСПОЛЬЗУЕМ СУЩЕСТВУЮЩУЮ КОНФИГУРАЦИЮ ПРОЕКТА
import { defaultConfig } from "../config";

import { ErrorType } from "../utils/error-handler";

interface ApiCardContext {
  latvian?: string;
  russian?: string;
  word_in_context?: string;
}

interface ApiCard {
  id?: string;
  base_form?: string;
  front?: string;
  base_translation?: string;
  translations?: string[];
  text_forms?: string[];
  word_form_translation?: string;
  word_form_translations?: string[];
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
        chunkInfo: chunkInfo?.description || "unknown-chunk",
      });

      // Если сеть недоступна или прокси выключен — сразу кладем в очередь,
      // чтобы статус-бар отобразился до завершения автоматических повторов
      if (
        errorInfo.type === ErrorType.NETWORK_ERROR ||
        errorInfo.type === ErrorType.PROXY_UNAVAILABLE
      ) {
        retryQueue.enqueue(
          chunkInfo?.originalChunk || "",
          errorInfo,
          chunkInfo?.description || `chunk-${Date.now()}`
        );
      } else if (!willRetry && errorInfo.retryable && chunkInfo?.originalChunk) {
        console.log("➕ Добавляем в retry queue из-за исчерпания автоматических попыток");
        retryQueue.enqueue(
          chunkInfo.originalChunk,
          errorInfo,
          chunkInfo.description || `chunk-${Date.now()}`
        );
      }
    };

    const handleRateLimit = (errorInfo: ErrorInfo) => {
      console.warn("⚠️ Rate limit обнаружен:", errorInfo.userMessage);
      // Можно добавить toast уведомление в будущем
    };

    const handleApiOverload = (errorInfo: ErrorInfo) => {
      console.warn("⚠️ API перегружен:", errorInfo.userMessage);
      // Можно добавить специальное предупреждение в будущем
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

  // ОБНОВЛЕННАЯ функция обработки одного чанка с интеграцией новой архитектуры ошибок
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

      // 🚨 ИСПРАВЛЕНИЕ: Проверяем contextChunks на undefined для безопасности
      const safeContextChunks = contextChunks || [];

      // Формируем контекстную информацию для лучшего понимания
      let contextText = "";
      if (safeContextChunks.length > 1) {
        const prevChunk = chunkIndex > 0 ? safeContextChunks[chunkIndex - 1] : "";
        const nextChunk =
          chunkIndex < safeContextChunks.length - 1 ? safeContextChunks[chunkIndex + 1] : "";

        if (prevChunk || nextChunk) {
          contextText = `\n\nДополнительный контекст:\nПредыдущий фрагмент: ${prevChunk}\nСледующий фрагмент: ${nextChunk}`;
        }
      }

      // ОРИГИНАЛЬНЫЙ ПРОМПТ - восстановлен без изменений
      // Используем существующую конфигурацию проекта
      const config = defaultConfig.processing;

      const prompt = config.enablePhraseExtraction
        ? // НОВЫЙ УЛУЧШЕННЫЙ ПРОМПТ: строгий подход к полноте
          `Analyze these Latvian sentences systematically for Russian learners: "${chunk}"\n\n` +
          `STEP 1: Extract EVERY INDIVIDUAL WORD (mandatory):\n` +
          `- Include absolutely ALL words from the text, no exceptions\n` +
          `- Even small words like "ir", "ar", "šodien", "ļoti", "agri"\n` +
          `- Different forms of same word (grib AND negrib as separate entries)\n` +
          `- Pronouns, prepositions, adverbs - everything\n\n` +
          `STEP 2: Add meaningful phrases (bonus):\n` +
          `- Common collocations (iebiezinātais piens = сгущенное молоко)\n` +
          `- Compound expressions (dzimšanas diena = день рождения)\n` +
          `- Prepositional phrases (pie cepšanas = за выпечкой)\n\n` +
          `CRITICAL REQUIREMENTS:\n` +
          `1. Count words in original text and ensure SAME number of individual words in output\n` +
          `2. Every single word must appear as individual entry\n` +
          `3. Then add phrases as additional entries\n` +
          `4. Mark each entry with item_type: "word" or "phrase"\n\n` +
          `For each item create:\n` +
          `- front: exact form from text\n` +
          `- back: Russian translation of this specific form\n` +
          `- base_form: dictionary form of the word\n` +
          `- base_translation: Russian translation of that dictionary form\n` +
          `- word_form_translation: Russian translation of the exact form from the text\n` +
          `- original_phrase: the sentence containing it\n` +
          `- phrase_translation: Russian translation of the sentence\n` +
          `- text_forms: [form from text]\n` +
          `- item_type: "word" or "phrase"\n\n` +
          `EXAMPLES:\n` +
          `Word: {"front": "agri", "back": "рано", "item_type": "word"}\n` +
          `Word: {"front": "šodien", "back": "сегодня", "item_type": "word"}\n` +
          `Word: {"front": "grib", "back": "хочет", "item_type": "word"}\n` +
          `Phrase: {"front": "dzimšanas diena", "back": "день рождения", "item_type": "phrase"}\n\n` +
          `VERIFICATION: Text has approximately ${chunk.split(/\s+/).filter(w => w.length > 0).length} words.\n` +
          `Your response must include AT LEAST ${Math.floor(chunk.split(/\s+/).filter(w => w.length > 0).length * 0.9)} individual word entries.\n\n` +
          `Context: ${contextText}\n\n` +
          `Return valid JSON array of objects. Each object must include: front, back, base_form, base_translation, word_form_translation, original_phrase, phrase_translation, text_forms, item_type.\n` +
          `CRITICAL: Return ONLY a valid JSON array. No explanations, no text before or after.\n` +
          `Your response must start with [ and end with ]\n` +
          `DO NOT include any text like "Here is the analysis" or explanations.\n` +
          `RESPOND WITH PURE JSON ONLY!`
        : // СТАРЫЙ ПРОМПТ: только слова (тоже улучшенный)
          `Extract EVERY individual word from these Latvian sentences: "${chunk}"\n\n` +
          `CRITICAL: Include absolutely ALL words - no exceptions!\n` +
          `- Small words: ir, ar, uz, pie, šodien, agri, ļoti\n` +
          `- All verb forms: grib, negrib, pamostas, dodas\n` +
          `- All pronouns: viņa, viņas, sev\n` +
          `- Everything without exception\n\n` +
          `Target: approximately ${chunk.split(/\s+/).filter(w => w.length > 0).length} word entries.\n\n` +
          `Create vocabulary cards for Russian learners:\n` +
          `- front: exact word form from text\n` +
          `- back: Russian translation of this exact form\n` +
          `- base_form: dictionary form of the word\n` +
          `- base_translation: Russian translation of that dictionary form\n` +
          `- word_form_translation: Russian translation of the exact form from the text\n` +
          `- original_phrase: the sentence containing the word\n` +
          `- phrase_translation: Russian translation of the sentence\n` +
          `- text_forms: array with the word form\n` +
          `- item_type: "word"\n\n` +
          `CRITICAL: word_form_translation must match the specific form.\n` +
          `Example: "mammai" → "маме" (not "мама")\n\n` +
          `Context: ${contextText}\n\n` +
          `Return valid JSON array of objects. Each object must include: front, back, base_form, base_translation, word_form_translation, original_phrase, phrase_translation, text_forms, item_type.\n` +
          `Your response must start with [ and end with ]\n` +
          `DO NOT include any text like "Here is the analysis" or explanations.\n` +
          `RESPOND WITH PURE JSON ONLY!`;

      try {
        // НОВОЕ: Используем ApiClient с дополнительной информацией о чанке
        const raw = await apiClient.request(prompt, {
          chunkInfo: {
            description: `chunk-${chunkIndex + 1}-of-${totalChunks}`,
            originalChunk: chunk,
            index: chunkIndex,
            total: totalChunks,
          },
        });

        // Проверяем на структурированные ошибки (для обратной совместимости со старым кодом)
        if (raw.startsWith("[ERROR:")) {
          const errorData = JSON.parse(raw.slice(7, -1));
          const errorInfo = analyzeError(errorData);

          console.log("📦 Структурированная ошибка получена:", errorInfo.userMessage);

          // Создаем error карточку для немедленного отображения пользователю
          const errorCard: FlashcardNew = {
            id: `error_${Date.now()}_${Math.random()}`,
            base_form: `error_${errorInfo.type}_${Date.now()}`,
            word_type: "other",
            translations: [errorInfo.userMessage],
            contexts: [
              {
                latvian: chunk.substring(0, 100) + (chunk.length > 100 ? "..." : ""),
                russian: errorInfo.recommendation,
                word_in_context: errorInfo.type,
              },
            ],
            visible: true,
            needsReprocessing: true, // Флаг для APIStatusBar
          };

          return [errorCard];
        }

        // 🔧 ИСПРАВЛЕНИЕ: Добавляем проверку на ошибки прокси с маленькой буквы
        if (raw.startsWith("[Error:") || raw.includes("Error: Pro")) {
          console.log("🔴 Обнаружена ошибка прокси сервера:", raw.substring(0, 100));
          throw new Error("🔴 Ошибка сети - прокси сервер недоступен");
        }

        // Обычная обработка успешного ответа от Claude
        const cleanedText = raw
          .replace(/```json\s*/g, "")
          .replace(/```\s*$/g, "")
          .trim();

        // 🔧 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА на ошибки прокси
        if (cleanedText.startsWith("[Error:") || cleanedText.includes("Error:")) {
          throw new Error(`🔴 Ошибка сервера: ${cleanedText.substring(0, 100)}`);
        }

        const parsed = JSON.parse(cleanedText);
        const cardsArray = Array.isArray(parsed) ? parsed : [parsed];

        const oldCards = cardsArray.flatMap((card: ApiCard) => {
          const baseForm = card.base_form || card.front || "";
          const baseTrans = card.base_translation || card.translations?.[0] || "";
          const textForms = Array.isArray(card.text_forms)
            ? card.text_forms
            : card.front
              ? [card.front]
              : [];
          const formTrans =
            card.word_form_translation ||
            (Array.isArray(card.word_form_translations)
              ? card.word_form_translations[0]
              : undefined) ||
            card.translations?.[0] ||
            "";

          if (!Array.isArray(card.contexts) || card.contexts.length === 0) {
            return [
              {
                front: card.front || baseForm,
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

          return card.contexts.map(ctx => ({
            front: card.front || baseForm,
            back: formTrans,
            word_form_translation: formTrans,
            base_form: baseForm,
            base_translation: baseTrans,
            original_phrase: ctx.latvian || "",
            phrase_translation: ctx.russian || "",
            text_forms: textForms,
            visible: true,
          })) as FlashcardOld[];
        });

        const normalizedCards = normalizeCards(oldCards, chunk);
        const processedCards = mergeCardsByBaseForm(normalizedCards);

        console.log(
          `✅ Чанк ${chunkIndex + 1} успешно обработан: ${processedCards.length} карточек`
        );

        // Сохраняем переводы форм слов в глобальном состоянии
        saveForms(normalizedCards);

        return processedCards;
      } catch (error) {
        // НОВОЕ: Используем error-handler для анализа и классификации ошибки
        const errorInfo = analyzeError(error);

        console.error(`❌ Ошибка при обработке чанка ${chunkIndex + 1}:`, errorInfo.userMessage);

        // Создаем error карточку для отображения пользователю
        const errorCard: FlashcardNew = {
          id: `error_${Date.now()}_${Math.random()}`,
          base_form: errorInfo.userMessage,
          base_translation: errorInfo.recommendation,
          word_type: "other",
          translations: [errorInfo.userMessage],
          contexts: [
            {
              latvian: chunk.substring(0, 100) + (chunk.length > 100 ? "..." : ""),
              russian: errorInfo.recommendation,
              word_in_context: errorInfo.type,
            },
          ],
          visible: true,
          needsReprocessing: true, // Флаг для APIStatusBar
        };

        // Если ошибка retryable, она уже добавлена в retry queue через события ApiClient
        // Здесь просто возвращаем error карточку для немедленного отображения
        return [errorCard];
      }
    },
    [saveForms]
  );

  const generateTranslation = React.useCallback((cards: FlashcardNew[]) => {
    const translations = new Set<string>();
    cards.forEach(card => {
      card.contexts.forEach(ctx => {
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
          results.cards.forEach(card => (card.visible = true));
          const cleanedPrev = flashcards.filter(
            c => !(c as { needsReprocessing?: boolean }).needsReprocessing
          );
          const merged = mergeCardsByBaseForm([...cleanedPrev, ...results.cards]);
          setFlashcards(merged);
          generateTranslation(merged);
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
    setFlashcards([]);
    setTranslationText("");
    setFormTranslations(new Map());
    setBatchId(null);
    setBatchError(null);

    try {
      // Разбиваем текст на предложения
      const sentences = splitIntoSentences(inputText);
      console.log(`📝 Текст разбит на ${sentences.length} предложений`);

      // Группируем предложения в чанки по 3
      const chunks = [];
      for (let i = 0; i < sentences.length; i += 3) {
        const chunk = sentences
          .slice(i, i + 3)
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
          resultCards.forEach(card => (card.visible = true));

          const mergedCards = mergeCardsByBaseForm(resultCards);
          setFlashcards(mergedCards);
          generateTranslation(mergedCards);
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
            allCards.push(...chunkCards);
          }

          // Задержка между запросами для соблюдения rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Объединяем карточки с одинаковыми base_form
      const mergedCards = mergeCardsByBaseForm(allCards);

      console.log(
        `🎉 Обработка завершена: ${mergedCards.length} уникальных карточек из ${allCards.length} общих`
      );

      // Устанавливаем финальные данные
      setFlashcards(mergedCards);
      generateTranslation(mergedCards);
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
      const copy = [...prev];
      if (copy[index]) {
        (copy[index] as unknown as Record<string, unknown>)[field] = value;
      }
      return copy;
    });
  }, []);

  // Функция переключения видимости карточки
  const toggleCardVisibility = React.useCallback((index: number) => {
    setFlashcards(prev => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = { ...copy[index], visible: !copy[index].visible };
      }
      return copy;
    });
  }, []);

  // Функция удаления карточки
  const deleteCard = React.useCallback((index: number) => {
    setFlashcards(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Функция добавления новой карточки
  const addNewCard = React.useCallback(() => {
    const newCard: FlashcardNew = {
      base_form: "",
      base_translation: "",
      contexts: [],
      visible: true,
    } as FlashcardNew;
    setFlashcards(prev => [newCard, ...prev]);
  }, []);

  // Функция полной очистки всех данных
  const clearAll = React.useCallback(() => {
    console.log("🧹 Полная очистка всех данных");

    setFlashcards([]);
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
