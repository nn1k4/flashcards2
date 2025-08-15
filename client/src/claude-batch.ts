// client/src/claude-batch.ts
import { getClaudeConfig } from "./config";
import type { Card, Context, FormEntry } from "./types";
import { textToCards, mergeCardsByBaseForm } from "./utils/cardUtils";

/* =========================================================
 * 1) Инструмент (tool) — ИМЯ ВАЖНО для tool_choice
 * ========================================================= */
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

/* =========================================================
 * 2) Построение промпта (поддерживает ДВА варианта вызова)
 * ========================================================= */
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
    `Задача: извлечь из текста ${enablePhraseExtraction ? "ВСЕ слова и релевантные фразы" : "ВСЕ индивидуальные слова"} и вернуть карточки через инструмент ${FLASHCARD_TOOL.name} (ровно один вызов).`,
    `Текст чанка [${chunkIndex + 1}/${totalChunks}]:\n${chunkText}`,
    contextSection,
    `Требования к структуре:
- unit: "word" | "phrase"
- base_form: лемма/каноническая фраза
- base_translation: общий перевод (fallback)
- contexts[]: элементы с полями:
  - latvian: исходное предложение (lv)
  - russian: перевод (ru)
  - forms[]: { form, translation } для встреченных форм`,
    `Примеры:
WORD:
${exampleWord}
PHRASE:
${examplePhrase}`,
    `Правила:
1) Вызови инструмент ${FLASHCARD_TOOL.name} ОДИН раз, input={"flashcards":[...]}.
2) Если фразы отключены — формируй только unit="word".
3) Не добавляй ничего вне tool_use. Никакого Markdown.
4) Строгая JSON-валидность.`,
  ].join("\n");
}

/**
 * Публичная обёртка — принимает либо позиции (string, number, number, ...),
 * либо объект с полями (совместимость с кодом до рефакторинга).
 */
export function buildFlashcardPrompt(
  arg1:
    | string
    | {
        chunkText: string;
        chunkIndex: number;
        totalChunks: number;
        prevText?: string;
        nextText?: string;
        enablePhraseExtraction?: boolean;
      },
  arg2?: number,
  arg3?: number,
  arg4?: string[],
  enablePhraseExtraction: boolean = true
): string {
  if (typeof arg1 === "string") {
    const chunkText = arg1;
    const chunkIndex = arg2 ?? 0;
    const totalChunks = arg3 ?? 1;
    const contextChunks = arg4;
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

  // объектная форма
  return buildPromptForChunk(arg1);
}

/* =========================================================
 * 3) Утилиты парсинга
 * ========================================================= */
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const clean = (s: unknown) => (s == null ? "" : String(s).trim());

function stripFences(s: string) {
  return s
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/gi, "")
    .trim();
}

function safeJSONParse<T = any>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Текстовая обёртка FLASHCARD_TOOL({...}) → JSON */
function parseToolEnvelope(text: string): any | null {
  const tag = `${FLASHCARD_TOOL.name}(`;
  const idx = text.indexOf(tag);
  if (idx === -1) return null;
  const start = text.indexOf("(", idx);
  const end = text.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) return null;
  const inside = text.slice(start + 1, end).trim();
  return safeJSONParse(stripFences(inside));
}

function ensureVisible(cards: Card[]): Card[] {
  return cards.map(c => ({ ...c, visible: c.visible !== false }));
}

/** Конвертация старого массива в новый Card[] */
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

/** Парсим assistant message → Card[] (tool_use > текстовая обёртка > старый JSON) */
function parseMessageToCards(message: any): Card[] {
  try {
    const content = Array.isArray(message?.content) ? message.content : [];

    // 1) tool_use
    for (const item of content) {
      if (item?.type === "tool_use" && item?.name === FLASHCARD_TOOL.name) {
        const input = item.input ?? {};
        let arr: any[] = [];
        if (Array.isArray(input?.flashcards)) arr = input.flashcards;
        else if (Array.isArray(input)) arr = input;

        const normalized: Card[] = (arr || []).map((c: any) => ({
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
        }));

        return ensureVisible(
          normalized.filter(
            c =>
              (c.unit === "word" || c.unit === "phrase") &&
              c.base_form &&
              Array.isArray(c.contexts) &&
              c.contexts.length > 0
          )
        );
      }
    }

    // 2) текстовые куски (включая FLASHCARD_TOOL(...))
    const textParts = content
      .filter((i: any) => i?.type === "text" && typeof i?.text === "string")
      .map((i: any) => i.text);
    if (textParts.length > 0) {
      const joined = textParts.join("\n");

      // 2a) попытка снять обёртку FLASHCARD_TOOL(...)
      const env = parseToolEnvelope(joined);
      if (env) {
        const list = Array.isArray(env?.flashcards)
          ? env.flashcards
          : Array.isArray(env)
            ? env
            : [];
        if (Array.isArray(list)) {
          const cardsFromTool = parseMessageToCards({
            content: [{ type: "tool_use", name: FLASHCARD_TOOL.name, input: { flashcards: list } }],
          });
          if (cardsFromTool.length) return cardsFromTool;
        }
      }

      // 2b) старый JSON → Card[]
      const old = textToCards(stripFences(joined));
      if (Array.isArray(old) && old.length > 0) return oldArrayToNew(old);
    }

    return [];
  } catch (e) {
    console.error("❌ parseMessageToCards error:", e);
    return [];
  }
}

/* =========================================================
 * 4) Batch API
 * ========================================================= */
type BatchCreateResponse = { id: string; processing_status?: string };
type BatchStatusResponse = { id: string; processing_status: string };

type BatchRequestParams = Record<string, unknown>;
type BatchRequestItem = { custom_id: string; params: BatchRequestParams };

export async function callClaudeBatch(chunks: string[]): Promise<{ batchId: string }> {
  const cfg = getClaudeConfig("textProcessing");
  const requests: BatchRequestItem[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const prevText = i > 0 ? chunks[i - 1] : undefined;
    const nextText = i < chunks.length - 1 ? chunks[i + 1] : undefined;

    requests.push({
      custom_id: `chunk_${i + 1}`,
      params: {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        tools: [FLASHCARD_TOOL],
        tool_choice: { type: "tool", name: FLASHCARD_TOOL.name },
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
      },
    });
  }

  const resp = await fetch("http://localhost:3001/api/claude/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests }),
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

/**
 * Ждём `ended|completed|succeeded`, терпим временами 404/сетевые ошибки на статусе,
 * затем забираем JSONL результаты и склеиваем по base_form.
 */
export async function fetchBatchResults(
  batchId: string,
  options?: { pollIntervalMs?: number; maxWaitMs?: number }
): Promise<Card[]> {
  const pollIntervalMs = options?.pollIntervalMs ?? 3000;
  const maxWaitMs = options?.maxWaitMs ?? 10 * 60 * 1000;
  const start = Date.now();

  // 1) Ожидание терминального статуса
  /* ТЕРМИНАЛЬНЫЕ СТАТУСЫ у Anthropic batch:
   * - ended (Anthropic)
   * - completed/succeeded (на некоторых прослойках)
   */
  while (true) {
    if (Date.now() - start > maxWaitMs) throw new Error(`Timeout waiting for batch ${batchId}`);

    try {
      const st = await fetch(`http://localhost:3001/api/claude/batch/${batchId}`, {
        method: "GET",
      });
      if (!st.ok) {
        // Бывает промежуточный 404 — не валимся, ждём ещё
        console.warn("⚠️ batch status non-OK:", st.status, await st.text());
        await sleep(pollIntervalMs);
        continue;
      }

      const statusJson = (await st.json()) as BatchStatusResponse;
      const p = (statusJson?.processing_status || "").toLowerCase();
      console.log(`🛰️ Batch ${batchId} status: ${p}`);

      if (p === "ended" || p === "completed" || p === "succeeded") break;
      if (p === "failed" || p === "canceled" || p === "expired") {
        throw new Error(`Batch ${batchId} ended with status ${p}`);
      }
    } catch (e) {
      // сетевые/временные проблемы — подождём и продолжим
      console.warn("⚠️ batch status fetch error:", e);
    }

    await sleep(pollIntervalMs);
  }

  // 2) Получаем .jsonl с результатами
  let res: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      res = await fetch(`http://localhost:3001/api/claude/batch/${batchId}/results`, {
        method: "GET",
      });
      if (res.ok) break;
      console.warn("⚠️ results fetch non-OK:", res.status, await res.text());
    } catch (e) {
      console.warn("⚠️ results fetch error:", e);
    }
    await sleep(1500 * (attempt + 1));
  }

  if (!res || !res.ok) {
    throw new Error(`Failed to fetch batch results${res ? `: ${res.status}` : ""}`);
  }

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

      if (!message) continue;

      // Нормализуем в Card[]
      const cards = parseMessageToCards(message);
      if (cards.length) collected.push(...cards);
      else {
        // попробуем вытащить текст и разобрать по старой схеме
        const text = Array.isArray(message?.content)
          ? message.content
              .filter((p: any) => p?.type === "text" && typeof p?.text === "string")
              .map((p: any) => p.text)
              .join("\n")
          : "";
        if (text) {
          const toolEnv = parseToolEnvelope(text);
          if (toolEnv) {
            const list = Array.isArray(toolEnv?.flashcards)
              ? toolEnv.flashcards
              : Array.isArray(toolEnv)
                ? toolEnv
                : [];
            if (Array.isArray(list)) {
              const viaTool = parseMessageToCards({
                content: [
                  { type: "tool_use", name: FLASHCARD_TOOL.name, input: { flashcards: list } },
                ],
              });
              collected.push(...viaTool);
              continue;
            }
          }
          const old = textToCards(stripFences(text));
          collected.push(...oldArrayToNew(old));
        }
      }
    } catch (e) {
      console.error("❌ JSONL parse error:", e);
    }
  }

  const withVisible = ensureVisible(collected);
  const merged = mergeCardsByBaseForm(withVisible);
  console.log(`🎉 Batch parsed: ${withVisible.length} → ${merged.length} unique base_form entries`);
  return merged;
}

/* =========================================================
 * 5) Последовательный режим с tool-calling (используйте в useProcessing)
 * ========================================================= */
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

  if (!response.ok)
    throw new Error(`API request failed: ${response.status} ${await response.text()}`);

  const data = await response.json();

  // 1) Нормальный путь — tool_use
  let cards = parseMessageToCards(data);
  if (cards.length > 0) return mergeCardsByBaseForm(ensureVisible(cards));

  // 2) Текстовая обёртка FLASHCARD_TOOL(...)
  const text = Array.isArray(data?.content)
    ? data.content.find((p: any) => p?.type === "text")?.text
    : undefined;

  if (typeof text === "string" && text.includes(`${FLASHCARD_TOOL.name}(`)) {
    const env = parseToolEnvelope(text);
    const list = Array.isArray(env?.flashcards) ? env.flashcards : Array.isArray(env) ? env : [];
    if (Array.isArray(list) && list.length > 0) {
      cards = parseMessageToCards({
        content: [{ type: "tool_use", name: FLASHCARD_TOOL.name, input: { flashcards: list } }],
      });
      if (cards.length) return mergeCardsByBaseForm(ensureVisible(cards));
    }
  }

  // 3) Старый JSON массив
  if (typeof text === "string") {
    const old = textToCards(stripFences(text));
    const converted = oldArrayToNew(old);
    if (converted.length > 0) return mergeCardsByBaseForm(ensureVisible(converted));
  }

  // Пусто — вернём [], пусть наверху решат, что с этим делать
  return [];
}
