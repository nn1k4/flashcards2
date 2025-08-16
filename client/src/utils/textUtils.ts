import type { FlashcardNew } from "../types";

/* =========================
 * Общие утилиты нормализации
 * ========================= */
const PUNCT = /[.,!?;:()\[\]"'`«»]/g;

export const cleanTextForMatching = (text: string): string =>
  (text || "").toLowerCase().trim().replace(PUNCT, "");

/** «Стем» для очень грубого сопоставления: нижний регистр + без пунктуации + первые 4 символа */
function roughStem(word: string): string {
  const w = cleanTextForMatching(word);
  // для латышского этого мало, но работает как эвристика для «dzimšanas/dzimšana» и т.п.
  return w.slice(0, Math.min(4, w.length));
}

/** Нормализуем пробельные последовательности и переносы */
function squashSpaces(s: string): string {
  return (s || "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
 * Типы для построения чанков
 * ========================= */
interface TextChunk {
  chunkText: string;
  context: string;
  sentences: string[];
  startIndex: number;
  endIndex: number;
}

/* =========================
 * Разбиение на предложения
 * ========================= */
export const splitIntoSentences = (text: string): string[] => {
  return (text || "")
    .split(/(?<=[.!?])\s+/)
    .map(squashSpaces)
    .filter(s => s.length > 0);
};

/* =========================
 * Чанки из предложений
 * ========================= */
export const createSentenceChunks = (sentences: string[], chunkSize: number = 2): TextChunk[] => {
  const chunks: TextChunk[] = [];

  for (let i = 0; i < sentences.length; i += chunkSize) {
    const chunkSentences = sentences.slice(i, i + chunkSize);
    const chunkText = chunkSentences.join(" ");

    // Расширенный контекст ±3 предложения
    const contextStart = Math.max(0, i - 3);
    const contextEnd = Math.min(sentences.length, i + chunkSize + 3);
    const context = sentences.slice(contextStart, contextEnd).join(" ");

    chunks.push({
      chunkText,
      context,
      sentences: chunkSentences,
      startIndex: i,
      endIndex: i + chunkSize - 1,
    });
  }

  return chunks;
};

/* =========================
 * Окно контекста вокруг индекса
 * ========================= */
export const getContextSentences = (
  sentences: string[],
  currentIndex: number,
  contextSize: number = 6
): string[] => {
  const startIndex = Math.max(0, currentIndex - Math.floor(contextSize / 2));
  const endIndex = Math.min(sentences.length, currentIndex + Math.ceil(contextSize / 2) + 1);
  return sentences.slice(startIndex, endIndex);
};

/* =========================
 * Поиск предложения по индексу слова
 * ========================= */
export const getContainingSentence = (
  wordIndex: number,
  allWords: string[],
  inputText: string
): string => {
  if (!inputText || !allWords) return "";
  const sentences = splitIntoSentences(inputText);
  const wordsBeforeCurrent = allWords.slice(0, wordIndex).join("");
  const approximatePosition = wordsBeforeCurrent.length;

  let currentPosition = 0;
  for (const sentence of sentences) {
    const len = sentence.length;
    if (approximatePosition >= currentPosition && approximatePosition <= currentPosition + len) {
      return sentence.trim();
    }
    currentPosition += len + 1; // предполагаемый пробел между предложениями
  }
  return sentences[0] || "";
};

/* =========================
 * Вспомогалки для фраз
 * ========================= */

/** Проверка совпадения фразы с base_form карточки (точно или по грубым стемам 70%+) */
function phraseMatchesBaseForm(phrase: string, cardBaseForm: string): boolean {
  const p = cleanTextForMatching(phrase);
  const c = cleanTextForMatching(cardBaseForm);
  if (!p || !c) return false;
  if (p === c) return true;

  const pw = p.split(/\s+/);
  const cw = c.split(/\s+/);
  if (pw.length !== cw.length || pw.length < 2) return false;

  let matches = 0;
  for (let i = 0; i < pw.length; i++) {
    if (pw[i] === cw[i]) {
      matches++;
    } else if (roughStem(pw[i]) === roughStem(cw[i])) {
      matches++;
    }
  }
  return matches >= Math.ceil(cw.length * 0.7);
}

/** Совпадение фразы с одной из форм из contexts[].forms (если форма сама фраза) */
function phraseMatchesAnyContextForm(phrase: string, card: FlashcardNew): boolean {
  if (!Array.isArray(card?.contexts)) return false;
  const p = cleanTextForMatching(phrase);
  for (const ctx of card.contexts) {
    for (const f of (ctx as any)?.forms || []) {
      const form = cleanTextForMatching(f?.form || "");
      if (!form) continue;
      if (form.includes(" ") && (form === p || phraseMatchesBaseForm(p, form))) {
        return true;
      }
    }
  }
  return false;
}

/* =========================
 * Поиск фразы в позиции токена
 * (обратная совместимость для текущего рендера)
 * ========================= */
export const findPhraseAtPosition = (
  words: string[],
  startIndex: number,
  flashcards: FlashcardNew[]
): { card: FlashcardNew; length: number; isPhrase: boolean } | null => {
  if (!flashcards || !words || startIndex >= words.length) return null;

  // Пробуем фразы длиной 5→2 токена
  for (let phraseLength = 5; phraseLength >= 2; phraseLength--) {
    if (startIndex + phraseLength > words.length) continue;

    const phraseWords: string[] = [];
    let wordIndex = startIndex;

    // собираем непустые токены
    while (phraseWords.length < phraseLength && wordIndex < words.length) {
      const w = words[wordIndex++];
      if (w && !/^\s+$/.test(w)) phraseWords.push(w);
    }
    if (phraseWords.length < 2) continue;

    const phrase = squashSpaces(phraseWords.join(" "));
    const phraseClean = cleanTextForMatching(phrase);

    // только видимые карточки
    const visibleCards = (flashcards || []).filter(c => c.visible !== false);

    for (const card of visibleCards) {
      const base = cleanTextForMatching(card.base_form || "");

      // карточка-слово пропускается
      if (!base.includes(" ")) continue;

      // 1) точное совпадение по base_form
      if (base === phraseClean) {
        return { card, length: phraseLength, isPhrase: true };
      }

      // 2) совпадение по формам из contexts
      if (phraseMatchesAnyContextForm(phrase, card)) {
        return { card, length: phraseLength, isPhrase: true };
      }

      // 3) грубая проверка по стемам (70%)
      if (phraseMatchesBaseForm(phrase, card.base_form || "")) {
        return { card, length: phraseLength, isPhrase: true };
      }
    }
  }

  return null;
};
