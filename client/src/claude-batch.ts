// client/src/claude-batch.ts
import { getClaudeConfig } from "./config";
import type { Card, Context, FormEntry } from "./types";
import { textToCards, mergeCardsByBaseForm } from "./utils/cardUtils";

/* =========================
 *  FLASHCARD_TOOL (новая схема)
 * ========================= */
export const FLASHCARD_TOOL = {
  name: "FLASHCARD_TOOL",
  description:
    "Return Latvian→Russian flashcards in the new Card schema with precise sentence context and form-level translations.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      flashcards: {
        type: "array",
        minItems: 0,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["unit", "base_form", "contexts"],
          properties: {
            unit: { type: "string", enum: ["word", "phrase"] },
            base_form: { type: "string", minLength: 1 },
            base_translation: { type: "string" },
            contexts: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["latvian", "russian", "forms"],
                properties: {
                  latvian: { type: "string", minLength: 1 },
                  russian: { type: "string", minLength: 1 },
                  forms: {
                    type: "array",
                    minItems: 1,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["form", "translation"],
                      properties: {
                        form: { type: "string", minLength: 1 },
                        translation: { type: "string", minLength: 1 },
                      },
                    },
                  },
                },
              },
            },
            visible: { type: "boolean" },
          },
        },
      },
    },
    required: ["flashcards"],
  },
} as const;

/* =========================
 *  Промпт под новую схему (batch)
 * ========================= */
function buildPromptForChunk(params: {
  chunkText: string;
  chunkIndex: number;
  totalChunks: number;
  prevText?: string;
  nextText?: string;
  enablePhraseExtraction?: boolean;
}) {
  const { chunkText, chunkIndex, totalChunks, prevText, nextText, enablePhraseExtraction } = params;

  const exampleWord = `{"unit":"word","base_form":"māja","base_translation":"дом","contexts":[{"latvian":"Es esmu mājā.","russian":"Я в доме.","forms":[{"form":"mājā","translation":"в доме"}]}]}`;
  const examplePhrase = `{"unit":"phrase","base_form":"dzimšanas diena","base_translation":"день рождения","contexts":[{"latvian":"Mēs svinam dzimšanas dienu.","russian":"Мы празднуем день рождения.","forms":[{"form":"dzimšanas dienu","translation":"день рождения (вин.)"}]}]}`;

  const contextSection =
    prevText || nextText
      ? `\nДополнительный контекст:\n- Предыдущий фрагмент: ${prevText ?? "(нет)"}\n- Следующий фрагмент: ${nextText ?? "(нет)"}\n`
      : "";

  return [
    `Ты — помощник по лингвистике латышского языка.`,
    `Задача: извлечь из текста ${enablePhraseExtraction ? "ВСЕ слова и релевантные фразы" : "ВСЕ индивидуальные слова"} и вернуть структурированные карточки через инструмент ${FLASHCARD_TOOL.name} (ровно один вызов).`,
    `Текст чанка [${chunkIndex + 1}/${totalChunks}]:\n${chunkText}`,
    contextSection,
    `Требования к НОВОЙ модели Card:
- unit: "word" или "phrase"
- base_form: лемма (для слова) или каноническая фраза
- base_translation: общий перевод (fallback)
- contexts: список предложений появления; у каждого:
  - latvian: предложение (lv)
  - russian: перевод (ru)
  - forms: массив реально встретившихся { form, translation }`,
    `Примеры:
WORD:\n${exampleWord}\nPHRASE:\n${examplePhrase}`,
    `Правила:
1) Используй инструмент ${FLASHCARD_TOOL.name} ОДИН раз, input={"flashcards":[...]}.
2) Если фразы отключены — формируй только unit="word".
3) Не добавляй ничего вне tool_use. Никакого Markdown.
4) Соблюдай JSON-валидность.`,
  ].join("\n");
}

/**
 * ПУБЛИЧНЫЙ ЭКСПОРТ для useProcessing:
 * Совместимая с хуком обёртка — принимает (chunk, index, total, contextChunks?, enablePhraseExtraction?)
 * и внутри вызывает buildPromptForChunk с prev/next.
 */
export function buildFlashcardPrompt(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  contextChunks?: string[],
  enablePhraseExtraction: boolean = true
): string {
  const prevText = contextChunks && chunkIndex > 0 ? contextChunks[chunkIndex - 1] : undefined;
  const nextText =
    contextChunks && chunkIndex < totalChunks - 1 ? contextChunks[chunkIndex + 1] : undefined;

  return buildPromptForChunk({
    chunkText,
    chunkIndex,
    totalChunks,
    prevText,
    nextText,
    enablePhraseExtraction,
  });
}

/* =========================
 *  Типы для batches API (клиент)
 * ========================= */
type BatchCreateResponse = { id: string; processing_status?: string };
type BatchStatusResponse = {
  id: string;
  processing_status: string; // creating | processing | completed | canceled | failed | ...
  results_url?: string;
};
type BatchItem = { custom_id: string; params: Record<string, unknown> };

/* =========================
 *  Вспомогательные утилиты
 * ========================= */
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const clean = (s: unknown) => (s == null ? "" : String(s).trim());

function ensureVisible(cards: Card[]): Card[] {
  return cards.map(c => ({ ...c, visible: c.visible !== false }));
}

// Конвертация со старого массива (FlashcardOld[]) в новый Card[]
function oldArrayToNew(oldArr: any[]): Card[] {
  if (!Array.isArray(oldArr)) return [];
  const result: Card[] = [];
  for (const o of oldArr) {
    const baseForm = clean(o?.base_form) || clean(o?.front);
    if (!baseForm) continue;

    const phrase = clean(o?.original_phrase);
    const phraseTr = clean(o?.phrase_translation);
    const textForms: string[] =
      Array.isArray(o?.text_forms) && o.text_forms.length > 0
        ? o.text_forms.map(clean)
        : clean(o?.front)
          ? [clean(o.front)]
          : [];

    const forms: FormEntry[] =
      textForms.length > 0
        ? textForms
            .map(f => ({ form: f, translation: clean(o?.word_form_translation || o?.back) }))
            .filter(f => f.form && f.translation)
        : [];

    const contexts: Context[] =
      phrase && phraseTr && forms.length > 0 ? [{ latvian: phrase, russian: phraseTr, forms }] : [];

    result.push({
      unit: baseForm.includes(" ") ? "phrase" : "word",
      base_form: baseForm,
      base_translation: clean(o?.base_translation || o?.back) || undefined,
      contexts,
      visible: true,
    });
  }
  return result;
}

// Извлечь Card[] из assistant message (приоритет tool_use)
function parseMessageToCards(message: any, rawTextFallback?: string): Card[] {
  try {
    const content = Array.isArray(message?.content) ? message.content : [];

    // 1) Ищем tool_use нашего инструмента
    for (const item of content) {
      if (item?.type === "tool_use" && item?.name === FLASHCARD_TOOL.name) {
        const input = item.input ?? {};
        let arr: any[] = [];
        if (Array.isArray(input?.flashcards)) arr = input.flashcards;
        else if (Array.isArray(input?.cards)) arr = input.cards;
        else if (Array.isArray(input?.payload)) arr = input.payload;

        const normalized = (arr || []).map((c: any) => ({
          unit: c?.unit === "phrase" ? "phrase" : "word",
          base_form: clean(c?.base_form),
          base_translation: clean(c?.base_translation) || undefined,
          contexts: Array.isArray(c?.contexts)
            ? c.contexts
                .map((ctx: any) => ({
                  latvian: clean(ctx?.latvian),
                  russian: clean(ctx?.russian),
                  forms: Array.isArray(ctx?.forms)
                    ? ctx.forms
                        .map((f: any) => ({
                          form: clean(f?.form),
                          translation: clean(f?.translation),
                        }))
                        .filter((f: FormEntry) => f.form && f.translation)
                    : [],
                }))
                .filter(
                  (ctx: Context) =>
                    ctx.latvian && ctx.russian && Array.isArray(ctx.forms) && ctx.forms.length > 0
                )
            : [],
          visible: c?.visible !== false,
        })) as Card[];

        return ensureVisible(
          normalized.filter(
            (c: Card) =>
              (c.unit === "word" || c.unit === "phrase") &&
              c.base_form &&
              Array.isArray(c.contexts) &&
              c.contexts.length > 0
          )
        );
      }
    }

    // 2) Фолбэк: text → старый парсер → конвертация
    const textItems = content.filter((i: any) => i?.type === "text" && typeof i?.text === "string");
    if (textItems.length > 0) {
      const joined = textItems.map((x: any) => x.text).join("\n");
      const old = textToCards(joined);
      return oldArrayToNew(old);
    }

    // 3) Фолбэк на сырой текст
    if (rawTextFallback) {
      const old = textToCards(rawTextFallback);
      return oldArrayToNew(old);
    }

    return [];
  } catch (e) {
    console.error("❌ parseMessageToCards error:", e);
    return [];
  }
}

/* =========================
 *  Публичные функции batch API
 * ========================= */
type BatchRequestParams = Record<string, unknown>;
type BatchRequestItem = { custom_id: string; params: BatchRequestParams };

export async function callClaudeBatch(chunks: string[]): Promise<{ batchId: string }> {
  const cfg = getClaudeConfig("textProcessing");
  const items: BatchRequestItem[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const prevText = i > 0 ? chunks[i - 1] : undefined;
    const nextText = i < chunks.length - 1 ? chunks[i + 1] : undefined;

    const params: BatchRequestParams = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      tools: [FLASHCARD_TOOL],
      tool_choice: { type: "tool", name: FLASHCARD_TOOL.name }, // принудительно
      messages: [
        {
          role: "user",
          content: buildPromptForChunk({
            chunkText,
            chunkIndex: i,
            totalChunks: chunks.length,
            prevText,
            nextText,
            enablePhraseExtraction: true,
          }),
        },
      ],
    };

    items.push({ custom_id: `chunk_${i + 1}`, params });
  }

  const resp = await fetch("http://localhost:3001/api/claude/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: items }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error("❌ Batch creation failed:", resp.status, txt);
    throw new Error(`Batch creation failed: ${resp.status} ${txt}`);
  }

  const data = (await resp.json()) as BatchCreateResponse;
  if (!data?.id) throw new Error("Batch API did not return id");
  console.log("✅ Batch created:", data.id);
  return { batchId: data.id };
}

export async function fetchBatchResults(
  batchId: string,
  options?: { pollIntervalMs?: number; maxWaitMs?: number }
): Promise<Card[]> {
  const pollIntervalMs = options?.pollIntervalMs ?? 3000;
  const maxWaitMs = options?.maxWaitMs ?? 10 * 60 * 1000;
  const start = Date.now();

  // 1) Ожидаем завершения
  while (true) {
    if (Date.now() - start > maxWaitMs) throw new Error(`Timeout waiting for batch ${batchId}`);

    const st = await fetch(`http://localhost:3001/api/claude/batch/${batchId}`, { method: "GET" });
    if (!st.ok) throw new Error(`Failed to get batch status: ${st.status} ${await st.text()}`);

    const statusJson = (await st.json()) as BatchStatusResponse;
    const p = statusJson?.processing_status || "";
    console.log(`🛰️ Batch ${batchId} status: ${p}`);

    if (p === "completed") break;
    if (p === "canceled" || p === "expired" || p === "failed") {
      throw new Error(`Batch ${batchId} ended with status ${p}`);
    }
    await sleep(pollIntervalMs);
  }

  // 2) Забираем .jsonl
  const res = await fetch(`http://localhost:3001/api/claude/batch/${batchId}/results`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(`Failed to fetch batch results: ${res.status} ${await res.text()}`);

  const jsonl = await res.text();
  const lines = jsonl
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  console.log(`📦 Results lines: ${lines.length}`);

  const collected: Card[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const message =
        obj?.result?.message ||
        obj?.message ||
        obj?.output?.message ||
        obj?.result?.output?.message;

      let rawTextFallback: string | undefined;
      try {
        if (Array.isArray(message?.content)) {
          rawTextFallback =
            message.content
              .filter((it: any) => it?.type === "text" && typeof it?.text === "string")
              .map((it: any) => it.text)
              .join("\n") || undefined;
        }
      } catch {
        /* ignore */
      }

      const cards = parseMessageToCards(message, rawTextFallback);
      collected.push(...cards);
    } catch (e) {
      console.error("❌ JSONL parse error (line head):", line.substring(0, 180), e);
    }
  }

  const withVisible = ensureVisible(collected);
  const merged = mergeCardsByBaseForm(withVisible);
  console.log(
    `🎉 Batch parsed: ${withVisible.length} cards → ${merged.length} unique base_form entries`
  );
  return merged;
}

/* =========================
 *  Последовательный режим (tool calling) — опционально
 * ========================= */
export async function processChunkWithTools(
  chunk: string,
  index: number,
  total: number,
  allChunks: string[]
): Promise<Card[]> {
  const cfg = getClaudeConfig("textProcessing");
  const prevText = index > 0 ? allChunks[index - 1] : undefined;
  const nextText = index < total - 1 ? allChunks[index + 1] : undefined;

  const response = await fetch("http://localhost:3001/api/claude", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      tools: [FLASHCARD_TOOL],
      tool_choice: { type: "tool", name: FLASHCARD_TOOL.name },
      messages: [
        {
          role: "user",
          content: buildPromptForChunk({
            chunkText: chunk,
            chunkIndex: index,
            totalChunks: total,
            prevText,
            nextText,
            enablePhraseExtraction: true,
          }),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`API request failed: ${response.status}`);

  const data = await response.json();
  const cards = parseMessageToCards(data);
  if (cards.length > 0) return mergeCardsByBaseForm(ensureVisible(cards));

  const textContent = Array.isArray(data?.content)
    ? data.content.find((c: any) => c?.type === "text" && typeof c?.text === "string")?.text
    : undefined;

  if (textContent) {
    const old = textToCards(textContent);
    const converted = oldArrayToNew(old);
    return mergeCardsByBaseForm(ensureVisible(converted));
  }

  throw new Error("No flashcards in response");
}
