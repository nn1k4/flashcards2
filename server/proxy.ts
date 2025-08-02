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

// Интерфейсы для типизации
interface ClaudeMessage {
  role: string;
  content: string;
}

interface ClaudeRequestBody {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  messages: ClaudeMessage[];
}

interface ClaudeContent {
  type: string;
  text: string;
}

interface ClaudeResponse {
  content: ClaudeContent[];
  model?: string;
  role?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ErrorResponse {
  error: string;
  details?: string;
  type?: string;
  timestamp: string;
}

// Загружаем переменные окружения из .env
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

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

// Получаем API ключ из переменных окружения
const API_KEY = process.env.CLAUDE_API_KEY;

if (!API_KEY) {
  console.error("❌ ОШИБКА: CLAUDE_API_KEY не найден в .env файле!");
  console.error("📋 Убедитесь что файл server/.env содержит:");
  console.error("   CLAUDE_API_KEY=sk-ant-api03-ваш-ключ");
  process.exit(1);
}

console.log("✅ Claude API ключ загружен из .env");
console.log("🔑 API ключ начинается с:", API_KEY.substring(0, 20) + "...");

// Маршрут для проверки работоспособности
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    hasApiKey: !!API_KEY,
    internalTestConfig: INTERNAL_TEST_CONFIG,
    note: "Configuration is managed by client (client/src/config/index.ts). Server acts as proxy without defaults.",
  });
});

// Основной маршрут для Claude API
app.post("/api/claude", async (req: Request, res: Response) => {
  const startTime = Date.now();

  console.log("\n🔥 ===== НОВЫЙ ЗАПРОС К CLAUDE API =====");
  console.log("🕐 Время:", new Date().toISOString());
  console.log("📝 Request body keys:", Object.keys(req.body));

  // Валидация запроса
  if (!req.body) {
    console.error("❌ Пустое тело запроса");
    return res.status(400).json({
      error: "Empty request body",
      timestamp: new Date().toISOString(),
    } as ErrorResponse);
  }

  const requestBody = req.body as ClaudeRequestBody;

  if (!requestBody.messages || !Array.isArray(requestBody.messages)) {
    console.error("❌ Отсутствует или некорректно поле messages");
    return res.status(400).json({
      error: "Missing or invalid messages array",
      timestamp: new Date().toISOString(),
    } as ErrorResponse);
  }

  // Логирование параметров запроса
  console.log("📊 Параметры запроса:");
  console.log("   Model:", requestBody.model || "не указан");
  console.log("   Max tokens:", requestBody.max_tokens || "не указан");
  console.log("   Temperature:", requestBody.temperature || "не указан");
  console.log("   Messages count:", requestBody.messages.length);

  // Логирование содержимого сообщений с типизацией
  requestBody.messages.forEach((msg: ClaudeMessage, index: number) => {
    console.log(`   Message ${index + 1}:`);
    console.log(`     Role: ${msg.role}`);
    console.log(`     Content length: ${msg.content?.length || 0} символов`);
    if (msg.content && msg.content.length > 0) {
      console.log(
        `     First 200 chars: "${msg.content.substring(0, 200)}${msg.content.length > 200 ? "..." : ""}"`
      );
    }
  });

  // Валидация обязательных параметров от клиента
  if (!requestBody.model || !requestBody.max_tokens || requestBody.temperature === undefined) {
    console.error("❌ Клиент не передал обязательные параметры");
    console.error("   Model:", requestBody.model);
    console.error("   Max tokens:", requestBody.max_tokens);
    console.error("   Temperature:", requestBody.temperature);

    return res.status(400).json({
      error:
        "Missing required parameters: model, max_tokens, temperature must be provided by client",
      timestamp: new Date().toISOString(),
    } as ErrorResponse);
  }

  try {
    console.log("\n🚀 Отправляем запрос к Claude API...");

    // Подготавливаем тело запроса для Claude
    const claudeRequestBody: ClaudeRequestBody = {
      model: requestBody.model!, // Клиент ВСЕГДА отправляет
      max_tokens: requestBody.max_tokens!, // Клиент ВСЕГДА отправляет
      temperature: requestBody.temperature!, // Клиент ВСЕГДА отправляет
      messages: requestBody.messages,
    };

    console.log("📦 Финальная конфигурация запроса:");
    console.log("   Model:", claudeRequestBody.model);
    console.log("   Max tokens:", claudeRequestBody.max_tokens);
    console.log("   Temperature:", claudeRequestBody.temperature);
    console.log("   Messages count:", claudeRequestBody.messages.length);

    // Проверяем соответствие ожидаемым значениям
    console.log("✅ Используются параметры от клиента");
    console.log("   Источник конфигурации: client/src/config/index.ts");
    console.log("   Сервер работает как прокси без дефолтных значений");

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
    console.log("📊 Response ok:", response.ok);
    console.log("📊 Response headers:", Object.fromEntries(response.headers.entries()));

    // Получаем текст ответа
    const responseText = await response.text();
    console.log("📄 Raw response length:", responseText.length);
    console.log("📄 Raw response (first 500 chars):", responseText.substring(0, 500));

    if (!response.ok) {
      console.error("❌ Claude API вернул ошибку:");
      console.error("   Status:", response.status);
      console.error("   Response:", responseText);

      return res.status(response.status).json({
        error: `Claude API Error (${response.status})`,
        details: responseText,
        timestamp: new Date().toISOString(),
      } as ErrorResponse);
    }

    // Парсим JSON ответ
    let data: ClaudeResponse;
    try {
      data = JSON.parse(responseText) as ClaudeResponse;
      console.log("✅ JSON успешно распарсен");
      console.log("📦 Response data keys:", Object.keys(data));
      console.log("📦 Full response structure:", JSON.stringify(data, null, 2));
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON ответа от Claude:", parseError);
      console.error("📄 Проблемный текст:", responseText);

      const errorMessage = parseError instanceof Error ? parseError.message : "Unknown parse error";

      return res.status(500).json({
        error: "Failed to parse Claude API response",
        details: errorMessage,
        rawResponse: responseText,
        timestamp: new Date().toISOString(),
      } as ErrorResponse);
    }

    // Проверяем структуру ответа
    if (data.content && Array.isArray(data.content) && data.content.length > 0) {
      console.log("✅ Валидная структура ответа от Claude");
      console.log("📝 Content items count:", data.content.length);
      data.content.forEach((item: ClaudeContent, index: number) => {
        console.log(`   Content ${index + 1}:`);
        console.log(`     Type: ${item.type}`);
        console.log(`     Text length: ${item.text?.length || 0}`);
        if (item.text) {
          console.log(
            `     First 200 chars: "${item.text.substring(0, 200)}${item.text.length > 200 ? "..." : ""}"`
          );
        }
      });
    } else {
      console.warn("⚠️ Неожиданная структура ответа от Claude");
      console.warn('Expected: { content: [{ type: "text", text: "..." }] }');
      console.warn("Received:", data);
    }

    console.log("✅ Отправляем ответ клиенту");
    console.log("🔥 ===== ЗАПРОС ЗАВЕРШЕН =====\n");

    res.json(data);
  } catch (err) {
    const responseTime = Date.now() - startTime;
    console.error(`\n❌ Критическая ошибка прокси сервера (${responseTime}ms):`);

    // Правильная обработка unknown error типа
    const error = err as Error;
    console.error("Error type:", error.constructor?.name || "Unknown");
    console.error("Error message:", error.message || "No message");
    console.error("Error stack:", error.stack || "No stack");

    res.status(500).json({
      error: "Proxy server error",
      details: error.message || "Unknown error",
      type: error.constructor?.name || "Unknown",
      timestamp: new Date().toISOString(),
    } as ErrorResponse);
  }
});

// Batch endpoints для пакетной обработки
app.post("/api/claude/batch", async (req: Request, res: Response) => {
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages/batches", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(req.body),
    });
    const json = await anthropicRes.json();
    res.status(anthropicRes.status).json(json);
  } catch (error) {
    console.error("Batch creation error:", error);
    res.status(500).json({ error: "Batch request failed" });
  }
});

app.get("/api/claude/batch/:id", async (req: Request, res: Response) => {
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
    const json = await anthropicRes.json();
    res.status(anthropicRes.status).json(json);
  } catch (error) {
    console.error("Batch status error:", error);
    res.status(500).json({ error: "Batch status failed" });
  }
});

// Маршрут для тестирования подключения к Claude API
app.post("/api/claude/test", async (req: Request, res: Response) => {
  console.log("\n🧪 ===== INTERNAL API TEST =====");
  console.log("⚠️  Внимание: это internal тест с фиксированными параметрами");
  console.log("⚠️  Основная обработка использует параметры от клиента");

  try {
    // ЗАМЕНИТЬ testMessage на:
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
    };

    console.log("📦 Internal test configuration:");
    console.log("   Model:", testMessage.model);
    console.log("   Max tokens:", testMessage.max_tokens);
    console.log("   Temperature:", testMessage.temperature);
    console.log("   Purpose: API connectivity test only");

    console.log("🚀 Отправляем тестовый запрос...");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(testMessage),
    });

    const data = (await response.json()) as ClaudeResponse;

    if (response.ok) {
      console.log("✅ Тест успешен! Claude API работает");
      res.json({
        success: true,
        message: "Claude API connection test successful",
        claudeResponse: data,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error("❌ Тест провален:", data);
      res.status(500).json({
        success: false,
        error: "Claude API test failed",
        details: data,
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

// Обработка ошибок 404
app.use("*", (req: Request, res: Response) => {
  console.log(`❓ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: "Endpoint not found",
    available: ["/health", "/api/claude", "/api/claude/test"],
    timestamp: new Date().toISOString(),
  } as ErrorResponse);
});

// Глобальная обработка ошибок с правильной типизацией Express middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("💥 Необработанная ошибка сервера:", err);
  res.status(500).json({
    error: "Internal server error",
    details: err.message,
    timestamp: new Date().toISOString(),
  } as ErrorResponse);
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log("\n🚀 ===== ПРОКСИ СЕРВЕР ЗАПУЩЕН =====");
  console.log(`🌐 Слушает порт: ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test endpoint: http://localhost:${PORT}/api/claude/test`);
  console.log(`🤖 Claude API endpoint: http://localhost:${PORT}/api/claude`);
  console.log("=====================================\n");
});
