import type { FlashcardNew } from "../types";

// Интерфейс для чанка текста
interface TextChunk {
  chunkText: string; // текст чанка
  context: string; // расширенный контекст
  sentences: string[]; // предложения в чанке
  startIndex: number; // начальный индекс
  endIndex: number; // конечный индекс
}

// Функция создания чанков по предложениям (2 предложения за раз)
export const createSentenceChunks = (sentences: string[], chunkSize: number = 2): TextChunk[] => {
  const chunks: TextChunk[] = [];

  for (let i = 0; i < sentences.length; i += chunkSize) {
    const chunkSentences = sentences.slice(i, i + chunkSize);
    const chunkText = chunkSentences.join(" ");

    // Контекст: предыдущие и следующие предложения
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

// Функция получения контекстных предложений вокруг текущего
export const getContextSentences = (
  sentences: string[],
  currentIndex: number,
  contextSize: number = 6
): string[] => {
  const startIndex = Math.max(0, currentIndex - Math.floor(contextSize / 2));
  const endIndex = Math.min(sentences.length, currentIndex + Math.ceil(contextSize / 2) + 1);
  return sentences.slice(startIndex, endIndex);
};

// Функция поиска фраз в позиции
export const findPhraseAtPosition = (
  words: string[],
  startIndex: number,
  flashcards: FlashcardNew[]
): { card: FlashcardNew; length: number; isPhrase: boolean } | null => {
  if (!flashcards || !words || startIndex >= words.length) return null;

  // УЛУЧШЕНО: Попробуем фразы разной длины (2-5 слов для поддержки более длинных фраз)
  for (let phraseLength = 5; phraseLength >= 2; phraseLength--) {
    if (startIndex + phraseLength > words.length) continue;

    const phraseWords = [];
    let wordIndex = startIndex;

    // Собираем непробельные слова для фразы
    for (let i = 0; i < phraseLength && wordIndex < words.length; i++) {
      while (wordIndex < words.length && /^\s+$/.test(words[wordIndex])) {
        wordIndex++;
      }
      if (wordIndex < words.length) {
        phraseWords.push(words[wordIndex]);
        wordIndex++;
      }
    }

    if (phraseWords.length < 2) continue;

    const phrase = phraseWords
      .join(" ")
      .toLowerCase()
      .replace(/[.,!?;:]/g, "")
      .trim();

    // Ищем фразу в карточках
    const visibleCards = flashcards.filter(card => card.visible !== false);
    for (const card of visibleCards) {
      const cardBaseForm = (card.base_form || "")
        .toLowerCase()
        .replace(/[.,!?;:]/g, "")
        .trim();

      // ИСПРАВЛЕНО: Улучшенная логика поиска фраз с учетом склонений
      if (cardBaseForm.includes(" ")) {
        // Это фраза (содержит пробел)
        const cardWords = cardBaseForm.split(/\s+/);
        const phraseWordsClean = phrase.split(/\s+/);

        // Проверяем точное совпадение
        if (cardBaseForm === phrase) {
          console.log(`✅ Точное совпадение фразы: "${phrase}" → "${card.base_form}"`);
          return {
            card: card,
            length: phraseLength,
            isPhrase: true,
          };
        }

        // НОВОЕ: Проверяем совпадение с учетом словоформ (для случаев типа "dzimšana diena" vs "dzimšanas diena")
        if (cardWords.length === phraseWordsClean.length) {
          let matchesCount = 0;
          for (let i = 0; i < cardWords.length; i++) {
            const cardWord = cardWords[i];
            const phraseWord = phraseWordsClean[i];

            // Точное совпадение
            if (cardWord === phraseWord) {
              matchesCount++;
            }
            // Проверяем частичное совпадение (основа слова)
            else if (cardWord.length > 3 && phraseWord.length > 3) {
              // Берем первые 4 символа как основу слова
              const cardBase = cardWord.substring(0, Math.min(4, cardWord.length));
              const phraseBase = phraseWord.substring(0, Math.min(4, phraseWord.length));
              if (cardBase === phraseBase) {
                matchesCount++;
              }
            }
          }

          // Если совпадает больше половины слов, считаем это совпадением
          if (matchesCount >= Math.ceil(cardWords.length * 0.7)) {
            console.log(
              `✅ Найдена фраза с учетом словоформ: "${phrase}" → "${card.base_form}" (совпадений: ${matchesCount}/${cardWords.length})`
            );
            return {
              card: card,
              length: phraseLength,
              isPhrase: true,
            };
          }
        }
      }
    }
  }

  return null;
};

// Функция определения предложения по индексу слова
export const getContainingSentence = (
  wordIndex: number,
  allWords: string[],
  inputText: string
): string => {
  if (!inputText || !allWords) return "";

  // Собираем текст до текущего слова и после для поиска границ предложения
  const sentences = inputText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  // Определяем примерную позицию в тексте
  const wordsBeforeCurrent = allWords.slice(0, wordIndex).join("");
  const approximatePosition = wordsBeforeCurrent.length;

  // Ищем предложение, которое содержит эту позицию
  let currentPosition = 0;
  for (const sentence of sentences) {
    if (
      approximatePosition >= currentPosition &&
      approximatePosition <= currentPosition + sentence.length
    ) {
      return sentence.trim();
    }
    currentPosition += sentence.length + 1; // +1 для пробела между предложениями
  }

  // Fallback: первое предложение
  return sentences[0] || "";
};

// Функция разбивки текста на предложения
export const splitIntoSentences = (text: string): string[] => {
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
};

// Функция очистки текста от знаков препинания
export const cleanTextForMatching = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]/g, "");
};
