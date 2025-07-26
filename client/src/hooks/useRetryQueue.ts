// Хук для управления персистентной очередью retry с событиями и localStorage
import { useState, useCallback, useEffect } from "react";
import { ErrorInfo } from "../utils/error-handler";
import { apiClient } from "../services/ApiClient";
import { defaultConfig } from "../config";
import type { FlashcardNew } from "../types";

/**
 * Формирует полный промпт для Claude на основе исходного чанка текста.
 * Используется при повторной обработке, чтобы запрос был идентичен первичному.
 */
function buildPromptFromChunk(chunk: string): string {
  const config = defaultConfig.processing;
  const words = chunk.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const minEntries = Math.floor(wordCount * 0.9);

  if (config.enablePhraseExtraction) {
    return (
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
      `- base_form: dictionary form\n` +
      `- base_translation: Russian translation of dictionary form\n` +
      `- word_form_translation: translation of the specific form\n` +
      `- original_phrase: the sentence containing it\n` +
      `- phrase_translation: Russian translation of the sentence\n` +
      `- text_forms: [form from text]\n` +
      `- item_type: "word" or "phrase"\n\n` +
      `EXAMPLES:\n` +
      `Word: {"front": "agri", "back": "рано", "item_type": "word"}\n` +
      `Word: {"front": "šodien", "back": "сегодня", "item_type": "word"}\n` +
      `Word: {"front": "grib", "back": "хочет", "item_type": "word"}\n` +
      `Phrase: {"front": "dzimšanas diena", "back": "день рождения", "item_type": "phrase"}\n\n` +
      `VERIFICATION: Text has approximately ${wordCount} words.\n` +
      `Your response must include AT LEAST ${minEntries} individual word entries.\n\n` +
      `Context: \n\n` +
      `Return valid JSON array of objects.\n` +
      `CRITICAL: Return ONLY a valid JSON array. No explanations, no text before or after.\n` +
      `Your response must start with [ and end with ]\n` +
      `DO NOT include any text like "Here is the analysis" or explanations.\n` +
      `RESPOND WITH PURE JSON ONLY!`
    );
  }

  return (
    `Extract EVERY individual word from these Latvian sentences: "${chunk}"\n\n` +
    `CRITICAL: Include absolutely ALL words - no exceptions!\n` +
    `- Small words: ir, ar, uz, pie, šodien, agri, ļoti\n` +
    `- All verb forms: grib, negrib, pamostas, dodas\n` +
    `- All pronouns: viņa, viņas, sev\n` +
    `- Everything without exception\n\n` +
    `Target: approximately ${wordCount} word entries.\n\n` +
    `Create vocabulary cards for Russian learners:\n` +
    `- front: exact word form from text\n` +
    `- back: translation of this specific word form in Russian\n` +
    `- base_form: dictionary form\n` +
    `- base_translation: translation of dictionary form\n` +
    `- word_form_translation: translation of the specific form\n` +
    `- original_phrase: the sentence containing the word\n` +
    `- phrase_translation: Russian translation of the sentence\n` +
    `- text_forms: array with the word form\n\n` +
    `CRITICAL: word_form_translation must match the specific form.\n` +
    `Example: "mammai" → "маме" (not "мама")\n\n` +
    `Context: \n\n` +
    `Return valid JSON array of objects.\n` +
    `Your response must start with [ and end with ]\n` +
    `DO NOT include any text like "Here is the analysis" or explanations.\n` +
    `RESPOND WITH PURE JSON ONLY!`
  );
}

export interface QueueItem {
  id: string;
  chunk: string;
  errorInfo: ErrorInfo;
  attempts: number;
  timestamp: number;
  chunkInfo?: string;
  lastAttemptTime?: number;
}

export interface RetryQueueStats {
  totalItems: number;
  processing: boolean;
  processed: number;
  failed: number;
  lastProcessTime?: number;
}

export interface UseRetryQueueReturn {
  queue: QueueItem[];
  stats: RetryQueueStats;
  enqueue: (chunk: string, errorInfo: ErrorInfo, chunkInfo?: string) => void;
  processQueue: (onProgress?: (current: number, total: number) => void) => Promise<{
    processed: number;
    successful: number;
    failed: number;
    cards: FlashcardNew[];
  }>;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  isProcessing: boolean;
}

const STORAGE_KEY = "latvian-app-retry-queue";
const MAX_QUEUE_SIZE = 50; // Ограничиваем размер очереди

export function useRetryQueue(): UseRetryQueueReturn {
  const [queue, setQueue] = useState<QueueItem[]>(() => {
    // Восстанавливаем очередь из localStorage при инициализации
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log(`🔄 Восстановлена очередь retry: ${parsed.length} элементов`);
        return parsed;
      }
    } catch (error) {
      console.warn("⚠️ Ошибка при восстановлении очереди из localStorage:", error);
    }
    return [];
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<RetryQueueStats>({
    totalItems: 0,
    processing: false,
    processed: 0,
    failed: 0,
  });

  // Сохраняем очередь в localStorage при изменении
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));

      // Обновляем статистику
      setStats(prev => ({
        ...prev,
        totalItems: queue.length,
      }));

      console.log(`💾 Очередь сохранена: ${queue.length} элементов`);
    } catch (error) {
      console.warn("⚠️ Ошибка при сохранении очереди в localStorage:", error);
    }
  }, [queue]);

  /**
   * Добавление элемента в очередь
   */
  const enqueue = useCallback((chunk: string, errorInfo: ErrorInfo, chunkInfo?: string) => {
    const item: QueueItem = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      chunk,
      errorInfo,
      attempts: 0,
      timestamp: Date.now(),
      chunkInfo,
    };

    setQueue(prevQueue => {
      // Проверяем, нет ли уже такого чанка в очереди (избегаем дубликатов)
      const existingIndex = prevQueue.findIndex(existingItem => existingItem.chunk === chunk);

      if (existingIndex !== -1) {
        // Обновляем существующий элемент
        const updatedQueue = [...prevQueue];
        updatedQueue[existingIndex] = {
          ...updatedQueue[existingIndex],
          errorInfo,
          timestamp: Date.now(),
          chunkInfo,
        };
        console.log(`🔄 Обновлен элемент очереди: ${item.id}`);
        return updatedQueue;
      }

      // Добавляем новый элемент
      const newQueue = [...prevQueue, item];

      // Ограничиваем размер очереди
      if (newQueue.length > MAX_QUEUE_SIZE) {
        console.warn(`⚠️ Очередь превысила максимальный размер. Удаляются старые элементы.`);
        return newQueue.slice(-MAX_QUEUE_SIZE);
      }

      console.log(`➕ Добавлен в очередь retry: ${item.id} (${errorInfo.userMessage})`);
      return newQueue;
    });
  }, []);

  /**
   * Обработка всей очереди
   */
  const processQueue = useCallback(
    async (
      onProgress?: (current: number, total: number) => void
    ): Promise<{
      processed: number;
      successful: number;
      failed: number;
      cards: FlashcardNew[];
    }> => {
      if (isProcessing) {
        console.warn("⚠️ Обработка очереди уже выполняется");
        return { processed: 0, successful: 0, failed: 0 };
      }

      if (queue.length === 0) {
        console.log("ℹ️ Очередь retry пуста");
        return { processed: 0, successful: 0, failed: 0 };
      }

      setIsProcessing(true);
      setStats(prev => ({ ...prev, processing: true, processed: 0, failed: 0 }));

      console.log(`🚀 Начинаем обработку очереди: ${queue.length} элементов`);

      const results = {
        processed: 0,
        successful: 0,
        failed: 0,
        cards: [] as FlashcardNew[],
      };

      const queueCopy = [...queue];
      const successfulIds: string[] = [];

      for (let i = 0; i < queueCopy.length; i++) {
        const item = queueCopy[i];

        try {
          // Обновляем прогресс
          onProgress?.(i + 1, queueCopy.length);

          // Счетчики будут обновлены после попытки

          console.log(`🔄 Обработка элемента ${i + 1}/${queueCopy.length}: ${item.id}`);

          // Обновляем количество попыток
          item.attempts++;
          item.lastAttemptTime = Date.now();

          // Строим полный промпт и отправляем запрос через ApiClient
          const prompt = buildPromptFromChunk(item.chunk);
          const raw = await apiClient.request(prompt, {
            chunkInfo: item.chunkInfo || `retry-queue-item-${i + 1}`,
          });

          const cleaned = raw
            .replace(/```json\s*/g, "")
            .replace(/```\s*$/g, "")
            .trim();

          const parsed = JSON.parse(cleaned);
          const cardsArray = Array.isArray(parsed) ? parsed : [parsed];
          const processedCards = cardsArray.map(card => ({
            ...card,
            id: card.id || `${Date.now()}_${Math.random()}`,
            visible: true,
            needsReprocessing: false,
          }));

          if (processedCards.length > 0) {
            successfulIds.push(item.id);
            results.successful++;
            results.cards.push(...processedCards);
            setStats(prev => ({
              ...prev,
              processed: i + 1,
              failed: prev.failed,
            }));
            console.log(`✅ Успешно обработан: ${item.id}`);
          } else {
            results.failed++;
            setStats(prev => ({
              ...prev,
              processed: i + 1,
              failed: prev.failed + 1,
            }));
            console.log(`❌ Пустой результат для ${item.id}`);
          }
        } catch (error) {
          console.log(`❌ Ошибка при обработке ${item.id}:`, error);
          results.failed++;

          setStats(prev => ({
            ...prev,
            processed: i + 1,
            failed: prev.failed + 1,
          }));

          // Обновляем информацию об ошибке в элементе очереди
          if (error && typeof error === "object") {
            item.errorInfo = error as ErrorInfo;
          }
        }

        results.processed++;
      }

      // Удаляем успешно обработанные элементы из очереди
      if (successfulIds.length > 0) {
        setQueue(prevQueue => prevQueue.filter(item => !successfulIds.includes(item.id)));
        console.log(`🧹 Удалено из очереди ${successfulIds.length} успешно обработанных элементов`);
      }

      setIsProcessing(false);
      setStats(prev => ({
        ...prev,
        processing: false,
        lastProcessTime: Date.now(),
      }));

      console.log(`🏁 Обработка очереди завершена:`, results);
      return results;
    },
    [queue, isProcessing]
  );

  /**
   * Удаление элемента из очереди
   */
  const removeFromQueue = useCallback((id: string) => {
    setQueue(prevQueue => {
      const filtered = prevQueue.filter(item => item.id !== id);
      console.log(`🗑️ Удален из очереди: ${id}`);
      return filtered;
    });
  }, []);

  /**
   * Очистка всей очереди
   */
  const clearQueue = useCallback(() => {
    setQueue([]);
    setStats(prev => ({
      ...prev,
      totalItems: 0,
      processed: 0,
      failed: 0,
    }));
    console.log("🧹 Очередь retry очищена");
  }, []);

  return {
    queue,
    stats,
    enqueue,
    processQueue,
    removeFromQueue,
    clearQueue,
    isProcessing,
  };
}
