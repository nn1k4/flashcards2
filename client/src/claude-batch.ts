import { getClaudeConfig, defaultConfig } from "./config";
import { normalizeCards, mergeCardsByBaseForm } from "./utils/cardUtils";

import type { FlashcardNew, FlashcardOld } from "./types";

// Простая генерация промпта, повторяет логику из useProcessing
function buildPrompt(
  chunk: string,
  chunkIndex: number,
  _totalChunks: number,
  contextChunks: string[]
): string {
  const config = defaultConfig.processing;
  const prevChunk = chunkIndex > 0 ? contextChunks[chunkIndex - 1] : "";
  const nextChunk = chunkIndex < contextChunks.length - 1 ? contextChunks[chunkIndex + 1] : "";
  const contextText =
    prevChunk || nextChunk
      ? `\n\nДополнительный контекст:\nПредыдущий фрагмент: ${prevChunk}\nСледующий фрагмент: ${nextChunk}`
      : "";

  return config.enablePhraseExtraction
    ? `Analyze these Latvian sentences systematically for Russian learners: "${chunk}"\n\n` +
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
        `- base_form: dictionary form of the word\n` +
        `- base_translation: Russian translation of that dictionary form\n` +
        `- word_form_translation: Russian translation of the exact form from the text\n` +
        `- original_phrase: the sentence containing it\n` +
        `- phrase_translation: Russian translation of the sentence\n` +
        `- text_forms: [form from text]\n` +
        `- item_type: "word" or "phrase"\n\n` +
        `EXAMPLES:\n` +
        `Word: {"front": "agri", "back": "рано", "item_type": "word"}\n` +
        `Word: {"front": "šodien", "back": "сегодня", "item_type": "word"}\n` +
        `Word: {"front": "grib", "back": "хочет", "item_type": "word"}\n` +
        `Phrase: {"front": "dzimšanas diena", "back": "день рождения", "item_type": "phrase"}\n\n` +
        `VERIFICATION: Text has approximately ${
          chunk.split(/\s+/).filter(w => w.length > 0).length
        } words.\n` +
        `Your response must include AT LEAST ${Math.floor(
          chunk.split(/\s+/).filter(w => w.length > 0).length * 0.9
        )} individual word entries.\n\n` +
        `Context: ${contextText}\n\n` +
        `Return valid JSON array of objects. Each object must include: front, back, base_form, base_translation, word_form_translation, original_phrase, phrase_translation, text_forms, item_type.\n` +
        `CRITICAL: Return ONLY a valid JSON array. No explanations, no text before or after.\n` +
        `Your response must start with [ and end with ]\n` +
        `DO NOT include any text like "Here is the analysis" or explanations.\n` +
        `RESPOND WITH PURE JSON ONLY!`
    : `Extract EVERY individual word from these Latvian sentences: "${chunk}"\n\n` +
        `CRITICAL: Include absolutely ALL words - no exceptions!\n` +
        `- Small words: ir, ar, uz, pie, šodien, agri, ļoti\n` +
        `- All verb forms: grib, negrib, pamostas, dodas\n` +
        `- All pronouns: viņa, viņas, sev\n` +
        `- Everything without exception\n\n` +
        `Target: approximately ${
          chunk.split(/\s+/).filter(w => w.length > 0).length
        } word entries.\n\n` +
        `For each word create JSON object with:\n` +
        `- front: exact form from text\n` +
        `- back: Russian translation of this specific form\n` +
        `- base_form: dictionary form\n` +
        `- base_translation: Russian translation of dictionary form\n` +
        `- word_form_translation: Russian translation of exact form\n` +
        `- original_phrase: the sentence containing it\n` +
        `- phrase_translation: Russian translation of the sentence\n` +
        `- text_forms: [form from text]\n\n` +
        `Return valid JSON array. Start with [ and end with ]. No other text.\n` +
        `Context: ${contextText}`;
}

interface BatchCreateResponse {
  id: string;
}

interface BatchStatusResponse {
  processing_status: string;
  outputs?: { message?: { content?: { text: string }[] } }[];
}

export async function callClaudeBatch(chunks: string[]): Promise<{ batchId: string }> {
  const claudeConfig = getClaudeConfig("textProcessing");
  const requests = chunks.map((chunk, i) => ({
    custom_id: `chunk-${i}`,
    params: {
      model: claudeConfig.model,
      max_tokens: claudeConfig.maxTokens,
      temperature: claudeConfig.temperature,
      messages: [
        {
          role: "user",
          content: buildPrompt(chunk, i, chunks.length, chunks),
        },
      ],
    },
  }));

  const res = await fetch("http://localhost:3001/api/claude/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create batch: ${res.status}`);
  }

  const data = (await res.json()) as BatchCreateResponse;
  console.log("✅ Batch created, id:", data.id);

  return { batchId: data.id }; // 💡 теперь возвращаем ТОЛЬКО batchId
}

export async function pollBatchStatus(batchId: string): Promise<BatchStatusResponse["outputs"]> {
  const maxAttempts = 20;

  for (let i = 0; i < maxAttempts; i++) {
    console.log(`📡 Polling batch status (attempt ${i + 1}/${maxAttempts})...`);
    const res = await fetch(`http://localhost:3001/api/claude/batch/${batchId}`);
    console.log("🔍 Poll response status:", res.status);
    if (!res.ok) {
      throw new Error(`Failed to get batch status: ${res.status}`);
    }
    const data = (await res.json()) as BatchStatusResponse;
    console.log("📦 Poll data:", data);
    if (data.processing_status === "ended") {
      return data.outputs || [];
    }
    if (data.processing_status === "failed") {
      throw new Error("Batch failed");
    }
    const backoff = (attempt: number) => 1000 * Math.pow(1.5, attempt);
    await new Promise(r => setTimeout(r, backoff(i)));
  }
  throw new Error("Batch polling timeout");
}

export async function fetchBatchResults(batchId: string): Promise<FlashcardNew[]> {
  const res = await fetch(`http://localhost:3001/api/claude/batch/${batchId}/results`);
  if (!res.ok) throw new Error(`Failed to fetch batch results: ${res.status}`);

  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);

  const entries: { id: string; cards: FlashcardNew[] }[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const id = entry?.custom_id || entry?.id || "";
      const content = entry?.result?.message?.content;
      const textItem = content?.find((c: { type: string }) => c.type === "text");
      const textPayload = textItem?.text;

      if (!textPayload) continue;

      const parsedCards: FlashcardOld[] =
        typeof textPayload === "string" ? JSON.parse(textPayload) : [];

      const cleaned = parsedCards
        .filter(c => c && c.front && c.back)
        .map(c => {
          if (Array.isArray(c.text_forms)) {
            c.text_forms = [...c.text_forms].sort();
          }
          return c;
        });

      // 💡 Не группируем! Просто возвращаем сырые cleaned карточки
      entries.push({ id, cards: cleaned });
    } catch (e) {
      console.warn("⚠️ Could not parse line:", line);
      console.error("Ошибка парсинга batch ответа:", e);
    }
  }

  // 🔁 Сортировка по custom_id — chunk-0, chunk-1, ...
  entries.sort((a, b) => {
    const aIndex = parseInt(a.id.replace("chunk-", ""), 10);
    const bIndex = parseInt(b.id.replace("chunk-", ""), 10);
    return aIndex - bIndex;
  });

  const allCards = entries.flatMap(e => e.cards);
  const normalized = normalizeCards(allCards as FlashcardOld[]);
  const merged = mergeCardsByBaseForm(normalized);
  return merged;
}
