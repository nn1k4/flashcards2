// Модульная обертка над callClaude с поддержкой событий и персистентного retry
import { callClaude } from "../claude";
import {
  analyzeError,
  ErrorInfo,
  getRetryDelay,
  isRetryable,
  ErrorType,
} from "../utils/error-handler";

// Простая браузерная реализация EventEmitter для избежания зависимости от Node.js
class SimpleEventEmitter {
  private events: Map<string, Function[]> = new Map();

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);
  }

  off(event: string, listener: Function): void {
    const listeners = this.events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}

export interface ApiClientOptions {
  maxRetries?: number;
  debug?: boolean;
  enableEvents?: boolean;
}

export interface ApiClientStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriesPerformed: number;
  lastRequestTime: number;
  errorsByType: Record<string, number>;
}

export class ApiClient extends SimpleEventEmitter {
  private options: Required<ApiClientOptions>;
  private stats: ApiClientStats;

  constructor(options: ApiClientOptions = {}) {
    super();

    this.options = {
      maxRetries: 5,
      debug: false,
      enableEvents: true,
      ...options,
    };

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriesPerformed: 0,
      lastRequestTime: 0,
      errorsByType: {},
    };

    if (this.options.debug) {
      console.log("🚀 ApiClient инициализирован с настройками:", this.options);
    }
  }

  /**
   * Основной метод для отправки запроса с автоматическим retry
   */
  async request(prompt: string, options: { chunkInfo?: string } = {}): Promise<string> {
    this.stats.totalRequests++;
    this.stats.lastRequestTime = Date.now();

    if (this.options.debug) {
      console.log(`📤 ApiClient: Отправка запроса (попытка 1/${this.options.maxRetries})`);
    }

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        // Отправляем событие о начале запроса
        if (this.options.enableEvents) {
          this.emit("requestStart", {
            attempt,
            maxRetries: this.options.maxRetries,
            chunkInfo: options.chunkInfo,
          });
        }

        const result = await callClaude(prompt);

        // Проверяем на структурированные ошибки в ответе
        if (result.startsWith("[ERROR:")) {
          const errorData = JSON.parse(result.slice(7, -1));
          throw errorData;
        }

        // Успешный результат
        this.stats.successfulRequests++;

        if (this.options.enableEvents) {
          this.emit("requestSuccess", {
            attempt,
            result: result.substring(0, 100) + "...",
            chunkInfo: options.chunkInfo,
          });
        }

        if (this.options.debug) {
          console.log(`✅ ApiClient: Успешный запрос за ${attempt} попыток`);
        }

        return result;
      } catch (error) {
        const errorInfo = analyzeError(error);

        // Обновляем статистику
        this.stats.errorsByType[errorInfo.type] =
          (this.stats.errorsByType[errorInfo.type] || 0) + 1;

        if (this.options.debug) {
          console.log(`❌ ApiClient: Ошибка на попытке ${attempt}:`, errorInfo.userMessage);
        }

        // Отправляем событие об ошибке
        if (this.options.enableEvents) {
          this.emit("requestError", {
            attempt,
            maxRetries: this.options.maxRetries,
            errorInfo,
            chunkInfo: options.chunkInfo,
            willRetry: attempt < this.options.maxRetries && isRetryable(errorInfo.type),
          });

          // Специальные события для разных типов ошибок
          if (errorInfo.type === ErrorType.RATE_LIMITED) {
            this.emit("rateLimited", errorInfo);
          } else if (errorInfo.type === ErrorType.API_OVERLOADED) {
            this.emit("apiOverloaded", errorInfo);
          }
        }

        // Проверяем, можно ли повторить запрос
        if (attempt >= this.options.maxRetries || !isRetryable(errorInfo.type)) {
          this.stats.failedRequests++;

          if (this.options.enableEvents) {
            this.emit("requestFailed", {
              finalAttempt: attempt,
              errorInfo,
              chunkInfo: options.chunkInfo,
            });
          }

          throw errorInfo;
        }

        // Рассчитываем задержку и ждем
        const delay = getRetryDelay(errorInfo.type, attempt, errorInfo.retryAfter);

        if (this.options.debug) {
          console.log(`⏳ ApiClient: Ожидание ${delay}ms перед попыткой ${attempt + 1}`);
        }

        if (this.options.enableEvents) {
          this.emit("retryDelay", {
            attempt: attempt + 1,
            delay,
            errorType: errorInfo.type,
            chunkInfo: options.chunkInfo,
          });
        }

        this.stats.retriesPerformed++;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Этот код не должен выполняться
    throw new Error("Unexpected end of retry loop");
  }

  /**
   * Получение статистики работы клиента
   */
  getStats(): ApiClientStats {
    return { ...this.stats };
  }

  /**
   * Сброс статистики
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriesPerformed: 0,
      lastRequestTime: 0,
      errorsByType: {},
    };

    if (this.options.debug) {
      console.log("📊 ApiClient: Статистика сброшена");
    }
  }

  /**
   * Проверка работоспособности API
   */
  async healthCheck(): Promise<{ status: "ok" | "error"; message: string }> {
    try {
      await this.request("Test connection", { chunkInfo: "health-check" });
      return { status: "ok", message: "API доступен" };
    } catch (error) {
      const errorInfo = error as ErrorInfo;
      return {
        status: "error",
        message: errorInfo.userMessage,
      };
    }
  }
}

// Глобальный экземпляр клиента для использования в приложении
export const apiClient = new ApiClient({
  debug: process.env.NODE_ENV === "development",
  enableEvents: true,
});
