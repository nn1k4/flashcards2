import { getClaudeConfig, defaultConfig } from "./config";
//import { normalizeCards, mergeCardsByBaseForm } from "./utils/cardUtils";

import type { FlashcardNew, FlashcardOld } from "./types";

// НОВОЕ: Определение инструмента для структурированного вывода
const FLASHCARD_TOOL = {
  name: "create_flashcards",
  description: "Создает структурированные флэшкарты для изучения латышского языка",
  input_schema: {
    type: "object",
    properties: {
      flashcards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            front: { type: "string", description: "Латышское слово в тексте" },
            back: { type: "string", description: "Русский перевод базовой формы" },
            base_form: { type: "string", description: "Базовая форма латышского слова" },
            base_translation: { type: "string", description: "Перевод базовой формы" },
            word_form_translation: {
              type: "string",
              description: "Перевод конкретной формы слова",
            },
            original_phrase: { type: "string", description: "Оригинальное предложение" },
            phrase_translation: { type: "string", description: "Перевод предложения" },
            text_forms: {
              type: "array",
              items: { type: "string" },
              description: "Формы слова в тексте",
            },
            item_type: {
              type: "string",
              enum: ["word", "phrase"],
              description: "Тип элемента",
            },
          },
          required: [
            "front",
            "back",
            "base_form",
            "base_translation",
            "original_phrase",
            "phrase_translation",
          ],
        },
        description: "Массив флэшкарт",
      },
    },
    required: ["flashcards"],
  },
};

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
      // НОВОЕ: Добавляем tools и tool_choice
      tools: [FLASHCARD_TOOL],
      tool_choice: { type: "tool", name: "create_flashcards" },
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
  console.log("✅ Batch created with TOOL CALLING, id:", data.id);

  return { batchId: data.id };
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
  console.log(`📥 Начинаем получение результатов batch: ${batchId}`);

  const res = await fetch(`http://localhost:3001/api/claude/batch/${batchId}/results`);
  if (!res.ok) {
    console.error(`❌ Ошибка получения результатов: ${res.status}`);
    throw new Error(`Failed to fetch batch results: ${res.status}`);
  }

  const text = await res.text();
  console.log(`📄 Получен ответ размером ${text.length} символов`);

  const lines = text.split("\n").filter(Boolean);
  console.log(`📊 Найдено ${lines.length} строк в результатах`);

  // Используем Map для сохранения порядка чанков
  const chunkResults = new Map<number, FlashcardOld[]>();
  let successCount = 0;
  let errorCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const customId = entry?.custom_id || "";

      // Извлекаем индекс чанка из custom_id
      const chunkIndex = parseInt(customId.replace("chunk-", ""));

      const result = entry?.result;

      if (result?.type === "succeeded") {
        const content = result.message?.content;

        if (!content || !Array.isArray(content)) {
          console.warn(`⚠️ Нет content для ${customId}`);
          continue;
        }

        // Ищем tool_use
        const toolUse = content.find((c: any) => c.type === "tool_use");

        if (toolUse?.input) {
          console.log(`🔧 Найден tool_use в ${customId}`);

          // ВАЖНО: Проверяем структуру данных
          let flashcardsData = toolUse.input.flashcards || toolUse.input;

          // Если это объект с полем flashcards
          if (
            flashcardsData &&
            typeof flashcardsData === "object" &&
            !Array.isArray(flashcardsData)
          ) {
            if (flashcardsData.flashcards) {
              flashcardsData = flashcardsData.flashcards;
            }
          }

          // Проверяем что это массив
          if (!Array.isArray(flashcardsData)) {
            console.error(
              `❌ ${customId}: flashcards не является массивом:`,
              typeof flashcardsData
            );
            console.log("Структура данных:", JSON.stringify(flashcardsData).substring(0, 200));

            // Пробуем fallback на text parsing
            const textItem = content.find((c: any) => c.type === "text");
            if (textItem?.text) {
              console.log(`⚠️ Fallback на text parsing для ${customId}`);
              const cleaned = textItem.text
                .replace(/```json\s*/g, "")
                .replace(/```\s*$/g, "")
                .trim();

              try {
                flashcardsData = JSON.parse(cleaned);
              } catch (e) {
                console.error(`❌ Не удалось распарсить text для ${customId}`);
                errorCount++;
                continue;
              }
            } else {
              errorCount++;
              continue;
            }
          }

          // Сохраняем с правильным индексом для порядка
          chunkResults.set(chunkIndex, flashcardsData);
          successCount++;
          console.log(`✅ ${customId}: обработано ${flashcardsData.length} карточек`);
        } else {
          // Fallback на старый метод text parsing
          const textItem = content.find((c: any) => c.type === "text");
          if (textItem?.text) {
            console.log(`📝 ${customId}: используем text parsing`);

            try {
              const cleaned = textItem.text
                .replace(/```json\s*/g, "")
                .replace(/```\s*$/g, "")
                .trim();

              const parsedCards = JSON.parse(cleaned);

              if (Array.isArray(parsedCards)) {
                chunkResults.set(chunkIndex, parsedCards);
                successCount++;
              } else {
                console.error(`❌ ${customId}: результат не массив`);
                errorCount++;
              }
            } catch (e) {
              console.error(`❌ ${customId}: ошибка парсинга:`, e);
              errorCount++;
            }
          }
        }
      } else if (result?.type === "errored") {
        errorCount++;
        console.error(`❌ ${customId}: API ошибка:`, result.error);
      }
    } catch (error) {
      errorCount++;
      console.error(`❌ Ошибка обработки строки:`, error);
    }
  }

  // Собираем карточки в правильном порядке
  const sortedIndices = Array.from(chunkResults.keys()).sort((a, b) => a - b);
  const allCards: FlashcardNew[] = [];

  console.log(`📑 Обработка карточек в правильном порядке: ${sortedIndices.join(", ")}`);

  for (const index of sortedIndices) {
    const chunkCards = chunkResults.get(index) || [];

    for (const card of chunkCards) {
      const existingCard = allCards.find(c => c.base_form === card.base_form);

      if (existingCard) {
        // Добавляем контекст
        existingCard.contexts.push({
          original_phrase: card.original_phrase,
          phrase_translation: card.phrase_translation,
          text_forms: card.text_forms || [card.front],
          word_form_translations: [card.word_form_translation || card.back],
        });
      } else {
        // Создаем новую карточку
        allCards.push({
          base_form: card.base_form,
          base_translation: card.base_translation,
          contexts: [
            {
              original_phrase: card.original_phrase,
              phrase_translation: card.phrase_translation,
              text_forms: card.text_forms || [card.front],
              word_form_translations: [card.word_form_translation || card.back],
            },
          ],
          visible: true,
        });
      }
    }
  }

  console.log(`\n📊 ИТОГИ:`);
  console.log(`   ✅ Успешно: ${successCount} чанков`);
  console.log(`   ❌ Ошибки: ${errorCount} чанков`);
  console.log(`   📚 Карточек: ${allCards.length}`);

  return allCards;
}

// Функция для последовательной обработки с TOOL CALLING
export async function processChunkWithTools(
  chunk: string,
  index: number,
  total: number,
  allChunks: string[]
): Promise<FlashcardOld[]> {
  const claudeConfig = getClaudeConfig("textProcessing");

  const response = await fetch("http://localhost:3001/api/claude", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: claudeConfig.model,
      max_tokens: claudeConfig.maxTokens,
      temperature: claudeConfig.temperature,
      tools: [FLASHCARD_TOOL],
      tool_choice: { type: "tool", name: "create_flashcards" },
      messages: [
        {
          role: "user",
          content: buildPrompt(chunk, index, total, allChunks),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const data = await response.json();

  // Извлекаем данные из tool_use
  const toolUse = data.content?.find((c: any) => c.type === "tool_use");

  if (toolUse?.input?.flashcards) {
    console.log(`✅ Чанк ${index + 1}/${total} обработан через TOOL CALLING`);
    return toolUse.input.flashcards;
  }

  // Fallback на старый метод
  const textContent = data.content?.find((c: any) => c.type === "text");
  if (textContent?.text) {
    console.warn(`⚠️ Fallback на text parsing для чанка ${index + 1}`);
    const cleaned = textContent.text
      .replace(/```json\s*/g, "")
      .replace(/```\s*$/g, "")
      .trim();
    return JSON.parse(cleaned);
  }

  throw new Error("No flashcards in response");
}
