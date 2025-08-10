import { getClaudeConfig } from "./config";
import type { ClaudeTool, ClaudeToolChoice } from "./types";

// Расширенный тип Error с дополнительными полями для HTTP ошибок
interface ExtendedError extends Error {
  status?: number;
  retryAfter?: string | null;
}

// Интерфейсы для типизации ответов Claude API
interface ClaudeContent {
  type: string;
  text: string;
}

interface ClaudeResponse {
  content: ClaudeContent[];
  model?: string;
  role?: string;
  stop_reason?: string;
  stop_sequence?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ClaudeErrorResponse {
  error: string;
  details?: string;
  type?: string;
  timestamp?: string;
}

// Функция для безопасного логирования промпта (обрезает длинные тексты)
function logPromptSafely(prompt: string): void {
  const maxLogLength = 300;
  if (prompt.length <= maxLogLength) {
    console.log("📝 Full prompt:", prompt);
  } else {
    console.log("📝 Prompt (first 300 chars):", prompt.substring(0, maxLogLength) + "...");
    console.log("📝 Total prompt length:", prompt.length, "characters");
  }
}

// Функция для форматирования времени выполнения
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// функция для вызова Claude API с retry логикой
export async function callClaude(
  prompt: string,
  tools?: ClaudeTool[],
  tool_choice?: ClaudeToolChoice
): Promise<string> {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 8);
  const maxRetries = 3;
  let lastError: Error | null = null; // Типизируем как Error или null

  console.log(`\n🤖 ===== CLAUDE API CALL [${requestId}] =====`);
  console.log("🕐 Start time:", new Date().toISOString());

  // Валидация входных данных
  if (!prompt || typeof prompt !== "string") {
    console.error("❌ Invalid prompt provided:", typeof prompt, prompt);
    return "[Error: Invalid prompt]";
  }

  if (prompt.trim().length === 0) {
    console.error("❌ Empty prompt provided");
    return "[Error: Empty prompt]";
  }

  logPromptSafely(prompt);

  // Функция для расчета задержки с exponential backoff
  const calculateBackoffDelay = (attempt: number, retryAfter?: string): number => {
    if (retryAfter) {
      const retryAfterMs = parseInt(retryAfter) * 1000;
      console.log(`🕐 Using Retry-After header: ${retryAfterMs}ms`);
      return retryAfterMs;
    }

    // Exponential backoff: 1s, 2s, 4s (max 30s)
    const exponentialDelay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
    console.log(`🕐 Exponential backoff delay: ${exponentialDelay}ms for attempt ${attempt}`);
    return exponentialDelay;
  };

  // Функция мониторинга rate limit headers
  const monitorRateLimits = (response: Response) => {
    const requestsRemaining = response.headers.get("anthropic-ratelimit-requests-remaining");
    const requestsReset = response.headers.get("anthropic-ratelimit-requests-reset");
    const tokensRemaining = response.headers.get("anthropic-ratelimit-tokens-remaining");

    if (requestsRemaining) {
      console.log(`📊 Rate Limit - Requests remaining: ${requestsRemaining}`);

      // Предупреждение при низком остатке запросов
      const remaining = parseInt(requestsRemaining);
      if (remaining < 5) {
        console.warn(`⚠️ WARNING: Only ${remaining} requests remaining until reset`);
      }
    }

    if (tokensRemaining) {
      console.log(`📊 Rate Limit - Tokens remaining: ${tokensRemaining}`);
    }

    if (requestsReset) {
      console.log(`📊 Rate Limit - Reset time: ${requestsReset}`);
    }
  };

  // Retry цикл с exponential backoff
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`\n🚀 Attempt ${attempt}/${maxRetries}`);

      // Подготовка тела запроса
      const claudeConfig = getClaudeConfig("textProcessing");

      const requestBody = {
        model: claudeConfig.model,
        max_tokens: claudeConfig.maxTokens,
        temperature: claudeConfig.temperature,
        messages: [{ role: "user", content: prompt.trim() }],
      };

      // Добавляем tools если они переданы (новые параметры функции)
      if (tools) {
        requestBody.tools = tools;
      }
      if (tool_choice) {
        requestBody.tool_choice = tool_choice;
      }

      console.log("📦 Request configuration:");
      console.log("   Model:", requestBody.model);
      console.log("   Max tokens:", requestBody.max_tokens);
      console.log("   Temperature:", requestBody.temperature);

      const attemptStartTime = Date.now();
      console.log("🚀 Sending HTTP request to proxy server...");

      // Отправляем запрос к proxy серверу
      const response = await fetch("http://localhost:3001/api/claude", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const requestTime = Date.now() - attemptStartTime;
      console.log(`📡 HTTP response received in ${formatDuration(requestTime)}`);
      console.log("📊 Response status:", response.status);

      // Мониторинг rate limits
      monitorRateLimits(response);

      // Обработка rate limit ошибок (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        console.warn(`⚠️ Rate limit exceeded (429). Retry-After: ${retryAfter || "not provided"}`);

        if (attempt < maxRetries) {
          const delay = calculateBackoffDelay(attempt, retryAfter || undefined);
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Повторить попытку
        } else {
          return "[Error: Rate limit exceeded - please wait before trying again]";
        }
      }

      // Обработка server overload ошибок (529)
      if (response.status === 529) {
        const retryAfter = response.headers.get("retry-after");
        console.warn(`⚠️ Server overloaded (529). Retry-After: ${retryAfter || "not provided"}`);

        if (attempt < maxRetries) {
          // Для 529 ошибок используем более агрессивную задержку
          const baseDelay = calculateBackoffDelay(attempt, retryAfter || undefined);
          const overloadDelay = Math.max(baseDelay, 10000); // Минимум 10 секунд для 529
          console.log(`⏳ Server overloaded, waiting ${overloadDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, overloadDelay));
          continue; // Повторить попытку
        } else {
          return "[Error: Claude API temporarily overloaded - please try again later]";
        }
      }

      // Обработка других HTTP ошибок
      if (!response.ok) {
        console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);

        let errorText: string;
        try {
          errorText = await response.text();
        } catch (readError) {
          console.error("❌ Failed to read error response:", readError);
          errorText = `HTTP ${response.status} - Unable to read response body`;
        }

        const error = new Error(`HTTP Error ${response.status}: ${errorText}`);
        (error as ExtendedError).status = response.status;
        (error as ExtendedError).retryAfter = response.headers.get("retry-after");

        lastError = error;

        // Для некоторых ошибок не повторяем
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          console.error("❌ Non-retryable error, throwing immediately");
          return `[Error: HTTP ${response.status}: ${errorText}]`;
        }

        if (attempt < maxRetries) {
          console.log(`🔄 Retryable error, will retry (attempt ${attempt}/${maxRetries})`);
          const delay = calculateBackoffDelay(attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return `[Error: HTTP ${response.status}: ${errorText}]`;
      }

      // Успешный ответ - обрабатываем как обычно
      console.log("✅ Response OK, parsing...");

      let responseText: string;
      try {
        responseText = await response.text();
        console.log("✅ Response body read successfully");
        console.log("📊 Response body length:", responseText.length, "characters");

        if (responseText.length > 0) {
          console.log("📄 Response body (first 500 chars):", responseText.substring(0, 500));
        } else {
          console.warn("⚠️ Empty response body received");
          return "[Error: Empty response from server]";
        }
      } catch (readError) {
        console.error("❌ Failed to read response body:", readError);
        return "[Error: Failed to read server response]";
      }

      // Парсим JSON
      console.log("\n🔍 Parsing JSON response...");
      let result: ClaudeResponse | ClaudeErrorResponse;
      try {
        result = JSON.parse(responseText);
        console.log("✅ JSON parsed successfully");
        console.log("📦 Response object keys:", Object.keys(result));
      } catch (parseError) {
        console.error("❌ JSON parsing failed:", parseError);
        console.error("📄 Problematic text (first 200 chars):", responseText.substring(0, 200));
        return `[Error: Invalid JSON response - ${parseError instanceof Error ? parseError.message : "Unknown parse error"}]`;
      }

      // Проверяем, есть ли ошибка в ответе
      if ("error" in result) {
        console.error("❌ Claude API returned error:");
        console.error("   Error:", result.error);
        console.error("   Details:", result.details || "No details provided");
        console.error("   Type:", result.type || "Unknown");
        return `[Claude API Error: ${result.error}]`;
      }

      // Проверяем структуру успешного ответа
      const claudeResponse = result as ClaudeResponse;

      if (!claudeResponse.content) {
        console.error("❌ Missing content field in response");
        console.error("📦 Available fields:", Object.keys(claudeResponse));
        return "[Error: Invalid response structure - missing content]";
      }

      if (!Array.isArray(claudeResponse.content)) {
        console.error("❌ Content field is not an array:", typeof claudeResponse.content);
        return "[Error: Invalid response structure - content is not array]";
      }

      if (claudeResponse.content.length === 0) {
        console.error("❌ Empty content array");
        return "[Error: Empty response content]";
      }

      // Извлекаем текст из первого элемента content
      const firstContent = claudeResponse.content[0];
      console.log("📝 Processing content item:");
      console.log("   Type:", firstContent.type);
      console.log("   Has text:", !!firstContent.text);

      if (!firstContent.text) {
        console.error("❌ No text field in content item");
        console.error("📦 Content item keys:", Object.keys(firstContent));
        return "[Error: No text in response content]";
      }

      const output = firstContent.text.trim();
      const totalTime = Date.now() - startTime;

      console.log("✅ Text extracted successfully:");
      console.log("📊 Output length:", output.length, "characters");
      console.log(
        "📝 Output (first 200 chars):",
        output.substring(0, 200) + (output.length > 200 ? "..." : "")
      );

      // Логируем статистику использования токенов если доступна
      if (claudeResponse.usage) {
        console.log("📊 Token usage:");
        console.log("   Input tokens:", claudeResponse.usage.input_tokens);
        console.log("   Output tokens:", claudeResponse.usage.output_tokens);
        console.log(
          "   Total tokens:",
          claudeResponse.usage.input_tokens + claudeResponse.usage.output_tokens
        );
      }

      console.log(
        `🏁 Request completed successfully in ${formatDuration(totalTime)} (attempt ${attempt})`
      );
      console.log(`===== END CLAUDE API CALL [${requestId}] =====\n`);

      return output;
    } catch (error) {
      lastError = error;
      const err = error as Error;

      console.error(`💥 Error in attempt ${attempt}:`, err.message);

      if (attempt === maxRetries) {
        console.error(`❌ All ${maxRetries} attempts failed`);
        break;
      }

      // Ждем перед следующей попыткой
      const delay = calculateBackoffDelay(attempt);
      console.log(`⏳ Waiting ${delay}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Все попытки исчерпаны
  const totalTime = Date.now() - startTime;
  console.error(`\n💥 All retry attempts failed after ${formatDuration(totalTime)}:`);

  const err = lastError as Error;
  console.error("Final error type:", err.constructor?.name || "Unknown");
  console.error("Final error message:", err.message || "No message");

  // Возвращаем специфичные ошибки для разных случаев
  if (err.message?.includes("fetch") || err.name === "TypeError") {
    console.error("🌐 Вероятная проблема: Прокси сервер не запущен или недоступен");
    console.error("   Проверьте что сервер запущен на http://localhost:3001");
    return "[Error: Proxy server unavailable - check if server is running]";
  }

  if ((err as ExtendedError).status === 529) {
    return "[Error: Claude API temporarily overloaded - please try again later]";
  }

  if ((err as ExtendedError).status === 429) {
    return "[Error: Rate limit exceeded - please wait before trying again]";
  }

  console.error(`===== ERROR END [${requestId}] =====\n`);
  return `[Error: ${err.message || "Unknown API error"}]`;
}
