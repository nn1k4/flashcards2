// Централизованная система анализа и классификации ошибок API
export enum ErrorType {
  PROXY_UNAVAILABLE = "proxy_unavailable", // прокси недоступен
  NETWORK_ERROR = "network_error", // проблемы с интернетом
  API_OVERLOADED = "api_overloaded", // API перегружен (529)
  RATE_LIMITED = "rate_limited", // превышен лимит (429)
  AUTHENTICATION = "authentication", // проблемы с API ключом (401, 403)
  INSUFFICIENT_QUOTA = "insufficient_quota", // недостаточно средств (402)
  UNKNOWN = "unknown", // прочие ошибки
}

export interface ErrorInfo {
  type: ErrorType;
  code?: number;
  message: string;
  originalError?: any;
  retryable: boolean;
  userMessage: string; // Понятное сообщение для пользователя
  recommendation: string; // Что делать пользователю
  retryAfter?: number; // Время до следующей попытки (мс)
  severity: "low" | "medium" | "high" | "critical";
}

/**
 * Анализирует ошибку и возвращает структурированную информацию
 */
export function analyzeError(error: any): ErrorInfo {
  console.log("🔍 Анализ ошибки:", error);

  // Проверка HTTP статус кода
  if (error?.response?.status || error?.status) {
    const status = error.response?.status || error.status;
    return analyzeHttpError(status, error);
  }

  // Проверка network ошибок
  if (error?.code || error?.message) {
    return analyzeNetworkError(error);
  }

  // Fallback для неизвестных ошибок
  return {
    type: ErrorType.UNKNOWN,
    message: error?.message || "Неизвестная ошибка",
    originalError: error,
    retryable: true,
    userMessage: "🔴 Произошла неизвестная ошибка",
    recommendation: "Попробуйте повторить запрос через несколько минут",
    severity: "medium",
  };
}

function analyzeHttpError(status: number, error: any): ErrorInfo {
  switch (status) {
    case 429:
      return {
        type: ErrorType.RATE_LIMITED,
        code: 429,
        message: "Rate limit exceeded",
        originalError: error,
        retryable: true,
        userMessage: "🟡 Превышен лимит запросов Claude API",
        recommendation: "Подождите несколько минут перед повторной попыткой",
        retryAfter: extractRetryAfter(error),
        severity: "medium",
      };

    case 529:
      return {
        type: ErrorType.API_OVERLOADED,
        code: 529,
        message: "Service temporarily overloaded",
        originalError: error,
        retryable: true,
        userMessage: "🔴 Claude API временно перегружен",
        recommendation: "Обычно перегрузка длится 10-30 минут. Попробуйте позже",
        severity: "high",
      };

    case 401:
    case 403:
      return {
        type: ErrorType.AUTHENTICATION,
        code: status,
        message: "Authentication failed",
        originalError: error,
        retryable: false,
        userMessage: "🔑 Ошибка аутентификации API",
        recommendation: "Проверьте API ключ в настройках сервера",
        severity: "critical",
      };

    case 402:
      return {
        type: ErrorType.INSUFFICIENT_QUOTA,
        code: 402,
        message: "Insufficient quota",
        originalError: error,
        retryable: false,
        userMessage: "💳 Недостаточно средств на API аккаунте",
        recommendation: "Пополните баланс в личном кабинете Anthropic",
        severity: "critical",
      };

    case 500:
    case 502:
    case 503:
    case 504:
      return {
        type: ErrorType.API_OVERLOADED,
        code: status,
        message: "Server error",
        originalError: error,
        retryable: true,
        userMessage: "🔴 Временная ошибка сервера Claude API",
        recommendation: "Повторите попытку через несколько минут",
        severity: "high",
      };

    default:
      return {
        type: ErrorType.UNKNOWN,
        code: status,
        message: `HTTP ${status}`,
        originalError: error,
        retryable: status >= 500,
        userMessage: `🔴 Ошибка HTTP ${status}`,
        recommendation: "Попробуйте повторить запрос",
        severity: "medium",
      };
  }
}

function analyzeNetworkError(error: any): ErrorInfo {
  const errorCode = error.code?.toUpperCase() || "";
  const errorMessage = error.message?.toLowerCase() || "";

  // Прокси сервер недоступен
  if (errorCode === "ECONNREFUSED" || errorMessage.includes("econnrefused")) {
    return {
      type: ErrorType.PROXY_UNAVAILABLE,
      message: "Connection refused to proxy",
      originalError: error,
      retryable: true,
      userMessage: "🟠 Прокси сервер недоступен",
      recommendation: 'Запустите сервер командой "npm start" в папке server',
      severity: "high",
    };
  }

  // Проблемы с интернетом
  if (
    errorCode.includes("ENOTFOUND") ||
    errorCode.includes("ECONNRESET") ||
    errorMessage.includes("network error") ||
    errorMessage.includes("timeout")
  ) {
    return {
      type: ErrorType.NETWORK_ERROR,
      message: "Network connectivity issues",
      originalError: error,
      retryable: true,
      userMessage: "🌐 Проблемы с интернет-соединением",
      recommendation: "Проверьте подключение к интернету и попробуйте еще раз",
      severity: "medium",
    };
  }

  // Fallback для network ошибок
  return {
    type: ErrorType.NETWORK_ERROR,
    message: error.message || "Network error",
    originalError: error,
    retryable: true,
    userMessage: "🔴 Ошибка сети",
    recommendation: "Проверьте интернет-соединение и повторите попытку",
    severity: "medium",
  };
}

function extractRetryAfter(error: any): number | undefined {
  const retryAfter = error?.response?.headers?.["retry-after"];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000; // конвертируем в миллисекунды
    }
  }
  return undefined;
}

/**
 * Определяет задержку для retry на основе типа ошибки
 */
export function getRetryDelay(errorType: ErrorType, attempt: number, retryAfter?: number): number {
  // Если сервер указал Retry-After, используем его
  if (retryAfter) {
    return retryAfter;
  }

  // Конфигурация задержек по типам ошибок
  const configs = {
    [ErrorType.API_OVERLOADED]: { base: 10000, multiplier: 1.5 }, // начинаем с 10 сек
    [ErrorType.RATE_LIMITED]: { base: 5000, multiplier: 2 }, // начинаем с 5 сек
    [ErrorType.PROXY_UNAVAILABLE]: { base: 2000, multiplier: 1.8 }, // прокси
    [ErrorType.NETWORK_ERROR]: { base: 1000, multiplier: 2 }, // интернет
    [ErrorType.UNKNOWN]: { base: 1000, multiplier: 2 }, // остальные
  };

  const config = configs[errorType] || configs[ErrorType.UNKNOWN];
  const delay = config.base * Math.pow(config.multiplier, attempt - 1);

  // Максимальная задержка - 60 секунд
  return Math.min(delay, 60000);
}

/**
 * Проверяет, можно ли повторить запрос для данного типа ошибки
 */
export function isRetryable(errorType: ErrorType): boolean {
  const nonRetryableTypes = [ErrorType.AUTHENTICATION, ErrorType.INSUFFICIENT_QUOTA];

  return !nonRetryableTypes.includes(errorType);
}
