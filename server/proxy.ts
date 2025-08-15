import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

const INTERNAL_TEST_CONFIG = {
  model: "claude-3-haiku-20240307",
  maxTokens: 100, // Минимум для быстрого теста
  temperature: 0.3, // Стабильная для тестирования
} as const;

/* ====================== Типы для запроса/ответа ====================== */
// Сообщения (допускаем строку или структурированный контент)
interface ClaudeMessage {
  role: "user" | "assistant" | "system";
  // Anthropic допускает строку или массив объектов контента.
  // В проекте часто отправляется строка, поэтому оставляем any.
  content: any;
}

// Описание инструмента (Anthropic tools)
interface ClaudeTool {
  name: string;
  description?: string;
  // Схема ввода как JSON Schema (Anthropic ожидает объект со свойством type: "object" и т.д.)
  input_schema: Record<string, unknown>;
}

// Выбор инструмента (tool_choice)
type ClaudeToolChoice =
  | "auto"
  | "any"
  | { type: "auto" | "any" }
  | { type: "tool"; name: string }
  // запасной вариант на будущее (если понадобится строго указать tool_use)
  | { type: "tool_use"; name: string };

interface ClaudeRequestBody {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string | Array<{ type: "text"; text: string }>;
  messages: ClaudeMessage[];
  tools?: ClaudeTool[];
  tool_choice?: ClaudeToolChoice;
  // Допускаем будущие поля без жёсткой типизации
  [key: string]: unknown;
}

interface ClaudeContentItem {
  type: string; // "text" | "tool_use" | ...
  // Для type="text"
  text?: string;
  // Для type="tool_use" и пр.
  [key: string]: any;
}

interface ClaudeResponse {
  content: ClaudeContentItem[];
  model?: string;
  role?: string;
  stop_reason?: string;
  stop_sequence?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ErrorResponse {
  error: string;
  details?: unknown;
  type?: string;
  timestamp: string;
}

/* ====================== ENV/инициализация ====================== */

// Загружаем переменные окружения из server/.env
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

// Логирование сервера в файл (сохраняем текущую логику)
const logsDir = path.join(__dirname, "../client/cypress/logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const serverLogPath = path.join(
  logsDir,
  `server_log_${new Date().toISOString().replace(/[:.]/g, "_")}.txt`
);
const serverLogStream = fs.createWriteStream(serverLogPath, { flags: "a" });
const originalConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  originalConsoleLog(...args);
  serverLogStream.write(args.map(String).join(" ") + "\n");
};

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"], // Vite и React dev servers
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" })); // Увеличенный лимит для больших промптов

// Получаем API ключ из переменных окружения (оставляем имя переменной как в проекте)
const API_KEY = process.env.CLAUDE_API_KEY;

if (!API_KEY) {
  console.error("❌ ОШИБКА: CLAUDE_API_KEY не найден в .env файле!");
  console.error("📋 Убедитесь что файл server/.env содержит:");
  console.error("   CLAUDE_API_KEY=sk-ant-api03-ваш-ключ");
  process.exit(1);
}

console.log("✅ Claude API ключ загружен из .env");
console.log("🔑 API ключ начинается с:", API_KEY.substring(0, 20) + "...");

/* ====================== Утилиты ====================== */

// Пробрасываем rate-limit/Retry-After заголовки из Anthropic к клиенту
function forwardRateLimitHeaders(from: Headers, to: Response) {
  const keys = [
    "anthropic-ratelimit-requests-limit",
    "anthropic-ratelimit-requests-remaining",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-limit",
    "anthropic-ratelimit-tokens-remaining",
    "anthropic-ratelimit-tokens-reset",
    "retry-after",
  ];
  for (const k of keys) {
    const v = from.get(k);
    if (v !== null) to.setHeader(k, v);
  }
}

// Унифицированная отправка ошибок клиенту
function sendError(
  res: Response,
  status: number,
  message: string,
  details?: unknown,
  type?: string
) {
  res.status(status).json({
    error: message,
    details,
    type: type || "proxy_error",
    timestamp: new Date().toISOString(),
  } as ErrorResponse);
}

/* ====================== Маршруты ====================== */

// Маршрут для проверки работоспособности
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    hasApiKey: !!API_KEY,
    internalTestConfig: INTERNAL_TEST_CONFIG,
    note: "Configuration is managed by client (client/src/config/index.ts). Server acts as proxy without defaults.",
  });
});

// Основной маршрут для Claude API (single messages)
app.post("/api/claude", async (req: Request, res: Response) => {
  const startTime = Date.now();

  console.log("\n🔥 ===== НОВЫЙ ЗАПРОС К CLAUDE API =====");
  console.log("🕐 Время:", new Date().toISOString());
  console.log("📝 Request body keys:", Object.keys(req.body || {}));

  // Валидация запроса
  if (!req.body || typeof req.body !== "object") {
    console.error("❌ Пустое или некорректное тело запроса");
    return sendError(res, 400, "Empty or invalid request body");
  }

  const requestBody = req.body as ClaudeRequestBody;

  if (!requestBody.messages || !Array.isArray(requestBody.messages)) {
    console.error("❌ Отсутствует или некорректное поле messages");
    return sendError(res, 400, "Missing or invalid messages array");
  }

  // Логирование параметров запроса
  console.log("📊 Параметры запроса:");
  console.log("   Model:", requestBody.model || "не указан");
  console.log("   Max tokens:", requestBody.max_tokens ?? "не указан");
  console.log("   Temperature:", requestBody.temperature ?? "не указан");
  console.log("   Messages count:", requestBody.messages.length);
  console.log(
    "   Tools:",
    Array.isArray(requestBody.tools) ? `count=${requestBody.tools.length}` : "none"
  );
  console.log(
    "   Tool choice:",
    requestBody.tool_choice ? JSON.stringify(requestBody.tool_choice) : "none"
  );
  console.log("   System:", requestBody.system ? "[provided]" : "none");

  // Логирование содержимого сообщений (безопасно)
  requestBody.messages.forEach((msg: ClaudeMessage, index: number) => {
    const contentStr =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
    console.log(`   Message ${index + 1}: role=${msg.role}; content length=${contentStr.length}`);
    if (contentStr.length > 0) {
      console.log(
        `     First 200 chars: "${contentStr.substring(0, 200)}${contentStr.length > 200 ? "..." : ""}"`
      );
    }
  });

  // Валидация обязательных параметров от клиента
  if (!requestBody.model || !requestBody.max_tokens || requestBody.temperature === undefined) {
    console.error("❌ Клиент не передал обязательные параметры");
    console.error("   Model:", requestBody.model);
    console.error("   Max tokens:", requestBody.max_tokens);
    console.error("   Temperature:", requestBody.temperature);

    return sendError(
      res,
      400,
      "Missing required parameters: model, max_tokens, temperature must be provided by client"
    );
  }

  try {
    console.log("\n🚀 Отправляем запрос к Claude API...");

    // Подготавливаем тело запроса для Claude — ВАЖНО: добавлены tools и tool_choice
    const claudeRequestBody: Record<string, unknown> = {
      model: requestBody.model!,
      max_tokens: requestBody.max_tokens!,
      temperature: requestBody.temperature!,
      messages: requestBody.messages,
      ...(requestBody.system ? { system: requestBody.system } : {}),
      ...(Array.isArray(requestBody.tools) ? { tools: requestBody.tools } : {}),
      ...(requestBody.tool_choice ? { tool_choice: requestBody.tool_choice } : {}),
    };

    console.log("📦 Финальное тело запроса к Claude:", JSON.stringify(claudeRequestBody, null, 2));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(claudeRequestBody),
    });

    const responseTime = Date.now() - startTime;
    console.log(`\n📡 Ответ от Claude API получен за ${responseTime}ms`);
    console.log("📊 Response status:", response.status);
    console.log("📊 Response ok:", (response as any).ok);
    console.log("📊 Response headers:", Object.fromEntries(response.headers.entries()));

    // Пробрасываем rate-limit заголовки клиенту
    forwardRateLimitHeaders(response.headers as unknown as Headers, res);

    // Получаем текст ответа (для логирования и вероятной диагностики)
    const responseText = await response.text();
    console.log("📄 Raw response length:", responseText.length);
    console.log("📄 Raw response (first 500 chars):", responseText.substring(0, 500));

    // Специальная обработка перегрузки/лимитов
    if (response.status === 429 || response.status === 529) {
      console.warn(`⚠️ Upstream returned ${response.status}. Пробрасываем как есть.`);
      // Важно: пробрасываем ТЕКСТ и статус (клиент умеет читать заголовки/статус)
      res.status(response.status).send(responseText);
      return;
    }

    if (!(response as any).ok) {
      console.error("❌ Claude API вернул ошибку:");
      console.error("   Status:", response.status);
      console.error("   Response:", responseText);

      // Пытаемся распарсить для деталей
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        parsed = { message: responseText };
      }

      return sendError(
        res,
        response.status,
        "Claude API Error",
        parsed,
        (parsed as any)?.error?.type || "upstream_error"
      );
    }

    // Успешный ответ — парсим и логируем неопасно
    let data: ClaudeResponse;
    try {
      data = JSON.parse(responseText) as ClaudeResponse;
      console.log("✅ JSON успешно распарсен");
      console.log("📦 Response data keys:", Object.keys(data));
      if (Array.isArray(data.content)) {
        console.log("📝 Content items count:", data.content.length);
        data.content.forEach((item: ClaudeContentItem, index: number) => {
          const kind = item?.type || "unknown";
          if (kind === "text") {
            const len = (item.text || "").length;
            console.log(`   Content ${index + 1}: type=${kind}; text length=${len}`);
            if (item.text) {
              console.log(
                `     First 200 chars: "${item.text.substring(0, 200)}${item.text.length > 200 ? "..." : ""}"`
              );
            }
          } else {
            // tool_use или другой структурный элемент — не печатаем объёмные данные
            console.log(`   Content ${index + 1}: type=${kind}; keys=${Object.keys(item)}`);
          }
        });
      } else {
        console.warn("⚠️ Неожиданная структура content:", typeof data.content);
      }
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON ответа от Claude:", parseError);
      console.error("📄 Проблемный текст:", responseText);

      const errorMessage = parseError instanceof Error ? parseError.message : "Unknown parse error";
      return sendError(
        res,
        500,
        "Failed to parse Claude API response",
        errorMessage,
        "parse_error"
      );
    }

    console.log("✅ Отправляем ответ клиенту");
    console.log("🔥 ===== ЗАПРОС ЗАВЕРШЕН =====\n");

    // Возвращаем уже распарсенный объект (как и раньше)
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.status(200).send(responseText);
  } catch (err) {
    const responseTime = Date.now() - startTime;
    console.error(`\n❌ Критическая ошибка прокси сервера (${responseTime}ms):`);

    const error = err as Error;
    console.error("Error type:", error.constructor?.name || "Unknown");
    console.error("Error message:", error.message || "No message");
    console.error("Error stack:", error.stack || "No stack");

    return sendError(
      res,
      500,
      "Proxy server error",
      error.message || "Unknown error",
      error.constructor?.name || "Unknown"
    );
  }
});

/* ====================== Batch endpoints для пакетной обработки ====================== */

app.post("/api/claude/batch", async (req: Request, res: Response) => {
  console.log("🛰️ POST /api/claude/batch", JSON.stringify(req.body, null, 2));
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages/batches", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      // ВАЖНО: тело передаём как есть — клиент сам формирует items (в т.ч. tools/tool_choice если нужны)
      body: JSON.stringify(req.body),
    });

    // Пробрасываем rate-limit заголовки (на случай, если Anthropic их вернёт для batch)
    forwardRateLimitHeaders(anthropicRes.headers as unknown as Headers, res);

    const text = await anthropicRes.text();
    res.status(anthropicRes.status).send(text);
  } catch (error) {
    console.error("Batch creation error:", error);
    res.status(500).json({ error: "Batch request failed", timestamp: new Date().toISOString() });
  }
});

app.get("/api/claude/batch/:id", async (req: Request, res: Response) => {
  console.log(`🔍 GET /api/claude/batch/${req.params.id}`);
  try {
    const anthropicRes = await fetch(
      `https://api.anthropic.com/v1/messages/batches/${req.params.id}`,
      {
        method: "GET",
        headers: {
          "x-api-key": API_KEY!,
          "anthropic-version": "2023-06-01",
        },
      }
    );

    forwardRateLimitHeaders(anthropicRes.headers as unknown as Headers, res);

    const text = await anthropicRes.text();
    res.status(anthropicRes.status).send(text);
  } catch (error) {
    console.error("Batch status error:", error);
    res.status(500).json({ error: "Batch status failed", timestamp: new Date().toISOString() });
  }
});

app.get("/api/claude/batch/:id/results", async (req, res) => {
  const id = req.params.id;
  const anthropicRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${id}/results`, {
    headers: {
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
    },
  });

  forwardRateLimitHeaders(anthropicRes.headers as unknown as Headers, res);

  if (!anthropicRes.ok) {
    return res.status(anthropicRes.status).send(await anthropicRes.text());
  }
  res.setHeader("Content-Type", "text/plain"); // .jsonl — plain text
  const stream = anthropicRes.body as unknown as NodeJS.ReadableStream;
  stream.pipe(res);
});

/* ====================== Маршрут для внутреннего теста ====================== */

app.post("/api/claude/test", async (_req: Request, res: Response) => {
  console.log("\n🧪 ===== INTERNAL API TEST =====");
  console.log("⚠️  Внимание: это internal тест с фиксированными параметрами");
  console.log("⚠️  Основная обработка использует параметры от клиента");

  try {
    const testMessage: ClaudeRequestBody = {
      model: INTERNAL_TEST_CONFIG.model,
      max_tokens: INTERNAL_TEST_CONFIG.maxTokens,
      temperature: INTERNAL_TEST_CONFIG.temperature,
      messages: [
        {
          role: "user",
          content: 'Say \'Hello, I am working!\' in JSON format: {"message": "your response"}',
        },
      ],
      // Можно быстро проверить, что прокси принимает tools/tool_choice:
      // tools: [{ name: "echo_tool", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }],
      // tool_choice: "auto",
    };

    console.log("📦 Internal test configuration:", JSON.stringify(testMessage, null, 2));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(testMessage),
    });

    forwardRateLimitHeaders(response.headers as unknown as Headers, res);

    const text = await response.text();

    if (response.ok) {
      console.log("✅ Тест успешен! Claude API работает");
      res.status(200).send(text);
    } else {
      console.error("❌ Тест провален:", text);
      res.status(500).json({
        success: false,
        error: "Claude API test failed",
        details: text,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    const error = err as Error;
    console.error("❌ Ошибка теста:", error);
    res.status(500).json({
      success: false,
      error: "Test connection failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/* ====================== 404 и глобальный обработчик ошибок ====================== */

app.use("*", (req: Request, res: Response) => {
  console.log(`❓ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: "Endpoint not found",
    available: ["/health", "/api/claude", "/api/claude/test", "/api/claude/batch"],
    timestamp: new Date().toISOString(),
  } as ErrorResponse);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("💥 Необработанная ошибка сервера:", err);
  res.status(500).json({
    error: "Internal server error",
    details: err.message,
    timestamp: new Date().toISOString(),
  } as ErrorResponse);
});

/* ====================== Запуск сервера ====================== */

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log("\n🚀 ===== ПРОКСИ СЕРВЕР ЗАПУЩЕН =====");
  console.log(`🌐 Слушает порт: ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test endpoint: http://localhost:${PORT}/api/claude/test`);
  console.log(`🤖 Claude API endpoint: http://localhost:${PORT}/api/claude`);
  console.log("=====================================\n");
});
