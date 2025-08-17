// client/src/claude-batch.ts
import { getClaudeConfig } from "./config";
import type { Card, Context, FormEntry } from "./types";
import { textToCards, mergeCardsByBaseForm } from "./utils/cardUtils";

/* =========================================================
 * 0) Утилиты (нормализация/парсинг)
 * ========================================================= */

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const clean = (s: unknown) => (s == null ? "" : String(s).trim());

/** Склейка переносов в пробелы + trim (для промпта и валидации) */
function normalizeForPrompt(s?: string) {
  if (!s) return "(нет)";
  return s
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Снятие ```fences``` (+ указание языка) и хвостов */
function stripFences(s: string) {
  return s
    .replace(/^```[a-zA-Z0-9_-]*\s*/g, "")
    .replace(/```$/g, "")
    .trim();
}

/** Безопасный JSON.parse */
function safeJSONParse<T = any>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Распаковать текстовую обёртку вида FLASHCARD_TOOL({...}) → объект */
function parseToolEnvelope(text: string): any | null {
  const name = FLASHCARD_TOOL.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`${name}\\s*\\(([\\s\\S]*)\\)\\s*$`));
  if (!m) return null;
  const inside = stripFences((m[1] ?? "").trim());
  return safeJSONParse(inside);
}

/** Гарантируем visible=true по умолчанию */
function ensureVisible(cards: Card[]): Card[] {
  return cards.map(c => ({ ...c, visible: c.visible !== false }));
}

/** Нормализуем unit (если сервер ошибся) */
function sanitizeUnit(unit: any, baseForm: string): "word" | "phrase" {
  const u = String(unit || "").toLowerCase();
  if (u === "word" || u === "phrase") return u as "word" | "phrase";
  return /\s/.test(baseForm) ? "phrase" : "word";
}

/* =========================================================
 * 1) Описание инструмента (tool) — name используется в tool_choice
 * ========================================================= */
export const FLASHCARD_TOOL = {
  name: "FLASHCARD_TOOL",
  description:
    "Return Latvian→Russian flashcards in the new Card schema with precise sentence context, anchors (sid) and form-level translations.",
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
                // sid опционален на уровне схемы (мы автопроставим на клиенте при отсутствии)
                required: ["latvian", "russian", "forms"],
                properties: {
                  latvian: { type: "string", minLength: 1 },
                  russian: { type: "string", minLength: 1 },
                  sid: { type: "integer", minimum: 0 },
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
 * 2) Построение промпта (лемма/перевод/якорь sid)
 * ========================================================= */

/** Жёсткие правила ПОЛНОГО перевода предложения в contexts[].russian */
const TRANSLATION_RULES = `
ПЕРЕВОД ПРЕДЛОЖЕНИЙ (contexts[].russian):
- ВСЕГДА возвращай ПОЛНЫЙ перевод ВСЕГО предложения (чанка), а не фрагмент.
- Сначала склей переносы строк в одно предложение (\\n → пробел), затем переводи.
- Сохраняй завершающую пунктуацию (., !, ?), если она была.
- contexts[].latvian = исходное предложение после склейки переносов и trim.
- Если из одного предложения создаются несколько карточек, contexts[].russian у них ДОЛЖЕН быть идентичным (одна строка полного перевода).
`.trim();

/** Жёсткие правила лемматизации и словарного перевода базовой формы */
const LEMMA_RULES = `
ЛЕММАТИЗАЦИЯ И ПЕРЕВОД ЛЕММЫ (СТРОГО):
- base_form — ТОЛЬКО словарная форма (лемма), а не встретившаяся форма.
  • Глаголы → инфинитив на -t/-ties: pamosties, gribēt, pārsteigt.
  • Существительные → именительный ед. ч.: mamma, pankūka, diena.
  • Прилаг./прич. → муж. род, им. ед.: garš, lēns.
  • Наречия/предлоги/частицы → как в словаре.
  • Сохраняй диакритики (ā, ē, ī, ū, ķ, ļ, ņ, ģ, š, ž).

- base_translation — общий рус. перевод ЛЕММЫ:
  • Глаголы — инфинитив: «просыпаться», «хотеть».
  • Сущ. — Nom Sg: «мама», «блин», «день».
  • НЕЛЬЗЯ ставить перевод конкретной формы (напр. «просыпается», «маму») в base_translation.

- Встречённые формы идут ТОЛЬКО в contexts[].forms[] с контекстным переводом:
  forms: [{ "form": "<встретившаяся форма>", "translation": "<перевод формы в контексте>" }].

- Никогда не смешивай разные леммы:
  • pamosties (просыпаться) ≠ pamodināt (разбудить) — это РАЗНЫЕ карточки.

- Для фраз (unit="phrase"):
  • base_form — канонический вид фразы (леммы внутри, если применимо).
  • base_translation — общий перевод фразы.
  • Словоформы фразы — в contexts[].forms[].
`.trim();

/** Требование к якорям sid */
const ANCHOR_RULES = (i: number, total: number) =>
  `
SID (якорь контекста):
- В каждом contexts[] укажи "sid" — 0-базовый индекс исходного предложения.
- Текущее предложение чанка имеет sid=${i}.
- Если используешь соседние предложения как контекст:
  • предыдущее → sid=${Math.max(i - 1, 0)}
  • следующее   → sid=${Math.min(i + 1, total - 1)}
- Не выдумывай иные sid — только эти индексы из текущего текста.
`.trim();

const GOOD_BAD = `
ПРИМЕРЫ «ПЛОХО/ХОРОШО»:

1) "Anna pamostas agri."
❌ ПЛОХО:
{"unit":"word","base_form":"pamostas","base_translation":"просыпается", ...}
✅ ХОРОШО:
{"unit":"word","base_form":"pamosties","base_translation":"просыпаться",
 "contexts":[{"latvian":"Anna pamostas agri.","russian":"Анна просыпается рано.",
              "sid": 0,
              "forms":[{"form":"pamostas","translation":"просыпается (3л ед.)"}]}]}

2) "Viņas mammai ... dzimšanas diena."
✅:
{"unit":"word","base_form":"mamma","base_translation":"мама",
 "contexts":[{"latvian":"Viņas mammai ...","russian":"У её мамы ...",
              "sid": 1,
              "forms":[{"form":"mammai","translation":"маме (дат.)"}]}]}

3) Фраза:
✅:
{"unit":"phrase","base_form":"dzimšanas dienas brokastis","base_translation":"завтрак на день рождения",
 "contexts":[{"latvian":"... ar dzimšanas dienas brokastīm.","russian":"... завтраком на день рождения.",
              "sid": 3,
              "forms":[{"form":"dzimšanas dienas brokastīm","translation":"завтраком на день рождения (тв.)"}]}]}
`.trim();

function buildPromptForChunk(params: {
  chunkText: string;
  chunkIndex: number;
  totalChunks: number;
  prevText?: string;
  nextText?: string;
  enablePhraseExtraction?: boolean;
}) {
  const {
    chunkText,
    chunkIndex,
    totalChunks,
    prevText,
    nextText,
    enablePhraseExtraction = true,
  } = params;

  const normChunk = normalizeForPrompt(chunkText);
  const normPrev = normalizeForPrompt(prevText);
  const normNext = normalizeForPrompt(nextText);

  const contextSection = `
Дополнительный контекст:
- Предыдущий фрагмент: ${normPrev}
- Следующий фрагмент: ${normNext}
`.trim();

  const exampleWord = `{"unit":"word","base_form":"mamma","base_translation":"мама","contexts":[{"latvian":"Es redzu mammu.","russian":"Я вижу маму.","sid": 12,"forms":[{"form":"mammu","translation":"маму (вин.)"}]}]}`;
  const exampleVerb = `{"unit":"word","base_form":"pamosties","base_translation":"просыпаться","contexts":[{"latvian":"Anna pamostas agri.","russian":"Анна просыпается рано.","sid": ${chunkIndex},"forms":[{"form":"pamostas","translation":"просыпается (3л ед.)"}]}]}`;
  const examplePhrase = `{"unit":"phrase","base_form":"dzimšanas diena","base_translation":"день рождения","contexts":[{"latvian":"Mēs svinam dzimšanas dienu.","russian":"Мы празднуем день рождения.","sid": ${Math.min(
    chunkIndex + 1,
    totalChunks - 1
  )},"forms":[{"form":"dzimšanas dienu","translation":"день рождения (вин.)"}]}]}`;

  return [
    `Ты — помощник по лингвистике латышского языка.`,
    `Задача: извлечь из текста ${enablePhraseExtraction ? "ВСЕ слова и релевантные фразы" : "ВСЕ индивидуальные слова"} и вернуть карточки через инструмент ${FLASHCARD_TOOL.name} (ровно один вызов).`,
    `Текст чанка [${chunkIndex + 1}/${totalChunks}]:\n${normChunk}`,
    contextSection,
    LEMMA_RULES,
    TRANSLATION_RULES,
    ANCHOR_RULES(chunkIndex, totalChunks),
    GOOD_BAD,
    `Требования к структуре:
- unit: "word" | "phrase"
- base_form: ЛЕММА/каноническая фраза (не инфлектированная форма!)
- base_translation: словарный перевод ЛЕММЫ (гл. — инфинитив; сущ. — именит. ед.)
- contexts[]:
  - latvian: исходное предложение (после склейки переносов)
  - russian: ПОЛНЫЙ перевод всего предложения
  - sid: индекс предложения (якорь)
  - forms[]: { form, translation } — встречённые формы с контекстным переводом`,
    `Примеры:
WORD:
${exampleWord}
${exampleVerb}
PHRASE:
${examplePhrase}`,
    `Правила:
1) Вызови инструмент ${FLASHCARD_TOOL.name} ОДИН раз, input={"flashcards":[...]}.
2) Если фразы отключены — формируй только unit="word".
3) Никакого текста вне tool_use. Строгая JSON-валидность.`,
  ].join("\n");
}

/** Публичная обёртка для гибких сигнатур */
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
    const ctx = arg4;
    const prevText = ctx && chunkIndex > 0 ? ctx[chunkIndex - 1] : undefined;
    const nextText = ctx && chunkIndex < totalChunks - 1 ? ctx[chunkIndex + 1] : undefined;

    return buildPromptForChunk({
      chunkText,
      chunkIndex,
      totalChunks,
      prevText,
      nextText,
      enablePhraseExtraction,
    });
  }
  return buildPromptForChunk(arg1);
}

/* =========================================================
 * 3) Парсинг assistant message → Card[]
 * ========================================================= */

/** Fallback-конвертер «старого массива» → Card[] */
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

/** Нормализация contexts[] (склейка переносов, фильтр пустых, прокидывание sid) */
function normalizeContexts(arr: any[]): Context[] {
  if (!Array.isArray(arr)) return [];
  const out: Context[] = [];
  for (const raw of arr) {
    const latvian = normalizeForPrompt(clean(raw?.latvian || raw?.original_phrase));
    const russian = normalizeForPrompt(clean(raw?.russian || raw?.phrase_translation));
    const sidRaw = raw?.sid;
    const sid = Number.isFinite(sidRaw) ? Number(sidRaw) : undefined;

    const formsRaw = Array.isArray(raw?.forms) ? raw.forms : [];
    const forms: FormEntry[] = formsRaw
      .map((f: any) => ({
        form: clean(f?.form),
        translation: clean(f?.translation),
      }))
      .filter((f: FormEntry) => f.form && f.translation);

    if (!latvian || !russian || forms.length === 0) continue;
    out.push({ latvian, russian, forms, ...(sid !== undefined ? { sid } : {}) } as Context);
  }
  return out;
}

/** Основной парсер сообщения ассистента → Card[] */
function parseMessageToCards(message: any): Card[] {
  try {
    const content = Array.isArray(message?.content) ? message.content : [];

    // 1) Нормальный путь — tool_use
    for (const item of content) {
      if (item?.type === "tool_use" && item?.name === FLASHCARD_TOOL.name) {
        const input = item.input ?? {};
        let arr: any[] = [];
        if (Array.isArray(input?.flashcards)) arr = input.flashcards;
        else if (Array.isArray(input)) arr = input;

        const normalized: Card[] = (arr || []).map((c: any) => {
          const base_form = clean(c?.base_form);
          const unit = sanitizeUnit(c?.unit, base_form);
          return {
            unit,
            base_form,
            base_translation: clean(c?.base_translation) || undefined,
            contexts: normalizeContexts(c?.contexts),
            visible: c?.visible !== false,
          };
        });

        return ensureVisible(
          normalized.filter(
            c =>
              (c.unit === "word" || c.unit === "phrase") &&
              !!c.base_form &&
              Array.isArray(c.contexts) &&
              c.contexts.length > 0
          )
        );
      }
    }

    // 2) Текстовые куски (включая FLASHCARD_TOOL(...))
    const textParts = content
      .filter((i: any) => i?.type === "text" && typeof i?.text === "string")
      .map((i: any) => i.text);

    if (textParts.length > 0) {
      const joined = textParts.join("\n");

      // 2a) FLASHCARD_TOOL(...) как текст
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

      // 2b) Старый JSON → Card[]
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
 * 4) Batch API — типы и функции
 * ========================================================= */

export type BatchProgress = {
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
};

type BatchCreateResponse = { id: string; processing_status?: BatchProgress["processing_status"] };

type BatchGetResponse = {
  id: string;
  processing_status: BatchProgress["processing_status"];
  request_counts: BatchProgress["request_counts"];
  results_url?: string;
};

type BatchRequestParams = Record<string, unknown>;
type BatchRequestItem = { custom_id: string; params: BatchRequestParams };

function buildUserMessageForChunk(
  chunkText: string,
  index: number,
  total: number,
  prev?: string,
  next?: string
) {
  return {
    role: "user",
    content: buildFlashcardPrompt({
      chunkText,
      chunkIndex: index,
      totalChunks: total,
      prevText: prev,
      nextText: next,
      enablePhraseExtraction: true,
    }),
  };
}

/** Создание batch на сервере-прокси */
export async function callClaudeBatch(chunks: string[]): Promise<{ batchId: string }> {
  const cfg = getClaudeConfig("textProcessing");
  const requests: BatchRequestItem[] = [];

  for (let i = 0; i < chunks.length; i++) {
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
        messages: [buildUserMessageForChunk(chunks[i], i, chunks.length, prevText, nextText)],
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
 * Ждём 'ended', шлём прогресс наружу, затем тянем JSONL и парсим.
 * Возвращаем ДВА набора: «сырые» и «объединённые».
 */
export async function fetchBatchResults(
  batchId: string,
  options?: { pollIntervalMs?: number; maxWaitMs?: number; initialDelayMs?: number },
  onProgress?: (p: BatchProgress) => void
): Promise<{ rawCards: Card[]; mergedCards: Card[] }> {
  const pollIntervalMs = options?.pollIntervalMs ?? 3000;
  const maxWaitMs = options?.maxWaitMs ?? 10 * 60 * 1000;
  const initialDelayMs = options?.initialDelayMs ?? 1200;

  const start = Date.now();
  let notFoundAttempts = 0;

  // Небольшая задержка перед первым запросом — меньше шанс раннего 404
  await sleep(initialDelayMs);

  // 1) Поллинг статуса до 'ended'
  while (true) {
    if (Date.now() - start > maxWaitMs) {
      throw new Error(`Timeout waiting for batch ${batchId}`);
    }

    try {
      const st = await fetch(`http://localhost:3001/api/claude/batch/${batchId}`, {
        method: "GET",
      });

      if (!st.ok) {
        if (st.status === 404) {
          notFoundAttempts++;
          const backoff = Math.min(pollIntervalMs * (notFoundAttempts + 1), 15000);
          console.info(`ℹ️ batch ${batchId} not indexed yet (404). Retry in ${backoff}ms`);
          await sleep(backoff);
          continue;
        }
        console.warn("⚠️ batch status non-OK:", st.status, await st.text());
        await sleep(pollIntervalMs);
        continue;
      }

      const statusJson = (await st.json()) as BatchGetResponse;

      onProgress?.({
        processing_status: statusJson.processing_status,
        request_counts: statusJson.request_counts,
      });

      const p = statusJson.processing_status;
      console.log(`🛰️ Batch ${batchId} status: ${p}`);
      if (p === "ended") break;
    } catch (e) {
      console.warn("⚠️ batch status fetch error:", e);
    }

    await sleep(pollIntervalMs);
  }

  // 2) Получаем .jsonl результаты (несколько попыток с бэкоффом)
  let res: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      res = await fetch(`http://localhost:3001/api/claude/batch/${batchId}/results`, {
        method: "GET",
      });
      if (res.ok) break;
      console.warn("⚠️ results fetch non-OK:", res.status, await res.text());
    } catch (e) {
      console.warn("⚠️ results fetch error:", e);
    }
    const wait = Math.min(1500 * (attempt + 1), 8000);
    await sleep(wait);
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

  // СЫРЫЕ карточки (ничего не теряем)
  const rawCollected: Card[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      // Возможные обёртки результата
      const message =
        obj?.result?.message ||
        obj?.message ||
        obj?.output?.message ||
        obj?.result?.output?.message;

      if (!message) continue;

      // Нормальный путь — tool_use
      const cards = parseMessageToCards(message);
      if (cards.length) {
        rawCollected.push(...cards);
        continue;
      }

      // Попробуем вытащить текст и разобрать по обёртке/старому JSON
      const text = Array.isArray(message?.content)
        ? message.content
            .filter((p: any) => p?.type === "text" && typeof p?.text === "string")
            .map((p: any) => p.text)
            .join("\n")
        : "";

      if (text) {
        // FLASHCARD_TOOL({...})
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
            if (viaTool.length) {
              rawCollected.push(...viaTool);
              continue;
            }
          }
        }

        // Старый JSON
        const old = textToCards(stripFences(text));
        rawCollected.push(...oldArrayToNew(old));
      }
    } catch (e) {
      console.error("❌ JSONL parse error:", e);
    }
  }

  const rawCards = ensureVisible(rawCollected);
  const mergedCards = mergeCardsByBaseForm(rawCards);
  console.log(
    `🎉 Batch parsed: ${rawCards.length} → ${mergedCards.length} unique base_form entries`
  );
  return { rawCards, mergedCards };
}

/* =========================================================
 * 5) Последовательный режим (tool-calling)
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
      messages: [buildUserMessageForChunk(chunk, index, total, prevText, nextText)],
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

  if (typeof text === "string" && text.includes(`${FLASHCARD_TOOL.name}`)) {
    const env = parseToolEnvelope(text);
    const list = Array.isArray(env?.flashcards) ? env.flashcards : Array.isArray(env) ? env : [];
    if (Array.isArray(list) && list.length > 0) {
      cards = parseMessageToCards({
        content: [{ type: "tool_use", name: FLASHCARD_TOOL.name, input: { flashcards: list } }],
      });
      if (cards.length) return mergeCardsByBaseForm(ensureVisible(cards));
    }
  }

  // 3) Старый JSON-массив (fallback)
  if (typeof text === "string") {
    const old = textToCards(stripFences(text));
    const converted = oldArrayToNew(old);
    if (converted.length > 0) return mergeCardsByBaseForm(ensureVisible(converted));
  }

  // Пусто — верхний слой решит, что делать
  return [];
}
