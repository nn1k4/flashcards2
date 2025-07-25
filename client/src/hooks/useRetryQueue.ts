// Хук для управления персистентной очередью retry с событиями и localStorage
import { useState, useCallback, useEffect } from "react";
import { ErrorInfo } from "../utils/error-handler";
import { apiClient } from "../services/ApiClient";

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
    ): Promise<{ processed: number; successful: number; failed: number }> => {
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
      };

      const queueCopy = [...queue];
      const successfulIds: string[] = [];

      for (let i = 0; i < queueCopy.length; i++) {
        const item = queueCopy[i];

        try {
          // Обновляем прогресс
          onProgress?.(i + 1, queueCopy.length);

          setStats(prev => ({
            ...prev,
            processed: i + 1,
          }));

          console.log(`🔄 Обработка элемента ${i + 1}/${queueCopy.length}: ${item.id}`);

          // Обновляем количество попыток
          item.attempts++;
          item.lastAttemptTime = Date.now();

          // Отправляем запрос через ApiClient
          const result = await apiClient.request(item.chunk, {
            chunkInfo: item.chunkInfo || `retry-queue-item-${i + 1}`,
          });

          console.log(`✅ Успешно обработан: ${item.id}`);

          successfulIds.push(item.id);
          results.successful++;
        } catch (error) {
          console.log(`❌ Ошибка при обработке ${item.id}:`, error);
          results.failed++;

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
