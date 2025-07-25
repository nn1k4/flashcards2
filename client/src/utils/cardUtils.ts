import type { FlashcardNew, FlashcardOld, Context } from "../types";

// Функция нормализации карточек с валидацией и очисткой
export const normalizeCards = (cards: FlashcardOld[], sentence: string): FlashcardOld[] => {
  return cards
    .filter(card => {
      // Более строгая валидация
      return (
        card &&
        card.front &&
        card.back &&
        card.front.trim().length > 0 &&
        card.back.trim().length > 0 &&
        card.front.trim().length < 100 && // Разумные ограничения длины
        card.back.trim().length < 200
      );
    })
    .map(card => {
      const normalizedCard: FlashcardOld = {
        front: (card.front || "").trim(),
        back: (card.back || "").trim(),
        base_form: (card.base_form || card.front || "").trim(),
        base_translation: (card.base_translation || card.back || "").trim(),
        original_phrase: (card.original_phrase || sentence || "").trim(),
        phrase_translation: (card.phrase_translation || "").trim(), // КРИТИЧНО: Сохраняем это поле
        text_forms: Array.isArray(card.text_forms)
          ? card.text_forms.filter(form => form && form.trim().length > 0)
          : [(card.front || "").trim()].filter(form => form.length > 0),
        visible: card.visible !== false,
      };

      return normalizedCard;
    });
};

// Функция объединения карточек по base_form (убирает дубликаты)
export const mergeCardsByBaseForm = (cards: FlashcardOld[]): FlashcardNew[] => {
  const merged = new Map<string, FlashcardNew>();

  cards.forEach(card => {
    const baseForm = card.base_form || card.front || "";

    if (!baseForm.trim()) {
      console.warn("Карточка без base_form пропущена:", card);
      return;
    }

    // Создаем контекст из текущей карточки
    const newContext: Context = {
      original_phrase: card.original_phrase || "",
      phrase_translation: card.phrase_translation || "",
      text_forms: Array.isArray(card.text_forms) ? card.text_forms : [card.front || ""],
    };

    if (merged.has(baseForm)) {
      // Добавляем контекст к существующей карточке
      const existing = merged.get(baseForm)!;

      // Проверяем, нет ли уже такого же контекста (избегаем дублирования)
      const isDuplicate = existing.contexts.some(
        ctx => ctx.original_phrase === newContext.original_phrase
      );

      if (!isDuplicate) {
        existing.contexts.push(newContext);
      }
    } else {
      // Создаем новую карточку с первым контекстом
      merged.set(baseForm, {
        base_form: baseForm,
        base_translation: card.base_translation || card.back || "",
        contexts: [newContext],
        visible: card.visible !== false,
      });
    }
  });

  const result = Array.from(merged.values());
  console.log(`🔄 Объединение завершено: ${cards.length} карточек → ${result.length} уникальных`);

  return result;
};

// Функция сохранения переводов форм слов в Map
export const saveFormTranslations = (
  cards: FlashcardOld[],
  currentFormTranslations: Map<string, string>
): Map<string, string> => {
  const newFormTranslations = new Map(currentFormTranslations);

  cards.forEach(card => {
    // Сохраняем перевод базовой формы (front → back)
    if (card.front && card.back) {
      const key = card.front
        .toLowerCase()
        .trim()
        .replace(/[.,!?;:]/g, "");

      if (key && !newFormTranslations.has(key)) {
        newFormTranslations.set(key, card.back.trim());
        console.log(`💾 Сохранен перевод формы: "${card.front}" → "${card.back}"`);
      }
    }

    // Сохраняем переводы из text_forms если есть
    if (Array.isArray(card.text_forms) && card.back) {
      card.text_forms.forEach(form => {
        const formKey = form
          .toLowerCase()
          .trim()
          .replace(/[.,!?;:]/g, "");
        if (formKey && !newFormTranslations.has(formKey)) {
          newFormTranslations.set(formKey, card.back.trim());
          console.log(`💾 Сохранен перевод text_form: "${form}" → "${card.back}"`);
        }
      });
    }
  });

  return newFormTranslations;
};

// Функция поиска переводов с контекстно-зависимой логикой
export const findTranslationForText = (
  text: string,
  flashcards: FlashcardNew[],
  sentence?: string
): {
  card: FlashcardNew;
  isPhrase: boolean;
  contextTranslation?: string;
  textForm?: string;
} | null => {
  if (!flashcards || !text) return null;

  const cleanText = text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]/g, "");
  const visibleCards = flashcards.filter(card => card.visible !== false);

  for (const card of visibleCards) {
    // 1. Поиск по base_form
    const cardBaseForm = (card.base_form || "")
      .toLowerCase()
      .replace(/[.,!?;:]/g, "")
      .trim();
    if (cardBaseForm === cleanText) {
      // НОВОЕ: ищем правильный контекст если передано предложение
      if (sentence) {
        const rightContext = card.contexts.find(
          context =>
            context.original_phrase &&
            (context.original_phrase.includes(sentence) ||
              sentence.includes(context.original_phrase.trim()))
        );
        if (rightContext) {
          // Возвращаем контекстно-зависимый перевод
          return {
            card: { ...card, back: card.base_translation },
            isPhrase: cleanText.includes(" "),
            contextTranslation: rightContext.phrase_translation,
          };
        }
      }
      return { card: { ...card, back: card.base_translation }, isPhrase: cleanText.includes(" ") };
    }

    // 2. Поиск по text_forms с контекстом
    for (const context of card.contexts) {
      if (Array.isArray(context.text_forms)) {
        const formMatch = context.text_forms.find(form => {
          const cleanForm = form
            .toLowerCase()
            .replace(/[.,!?;:]/g, "")
            .trim();
          return cleanForm === cleanText;
        });
        if (formMatch) {
          return {
            card: { ...card, back: card.base_translation },
            isPhrase: cleanText.includes(" "),
            contextTranslation: context.phrase_translation,
            textForm: formMatch,
          };
        }
      }
    }
  }

  return null;
};

// Функция для контекстно-зависимого поиска переводов
export const findContextualTranslation = (
  word: string,
  currentSentence: string,
  flashcards: FlashcardNew[]
): string | null => {
  const cardMatch = findTranslationForText(word, flashcards);
  if (!cardMatch) return null;

  const card = cardMatch.card;

  // Если есть contexts, ищем правильный контекст
  if (Array.isArray(card.contexts) && card.contexts.length > 0) {
    // Найти контекст, который содержит текущее предложение
    const rightContext = card.contexts.find(
      context =>
        context.original_phrase &&
        (context.original_phrase.includes(currentSentence) ||
          currentSentence.includes(context.original_phrase.trim()))
    );

    if (rightContext) {
      return rightContext.phrase_translation; // Контекстный перевод!
    } else {
      // Если точный контекст не найден, возвращаем базовый перевод
      return card.base_translation;
    }
  } else {
    // Fallback для старых карточек
    return card.base_translation || card.back;
  }
};

// Функция выделения слов в контексте карточек
export const highlightWordInPhrase = (
  phrase: string,
  targetWord: string,
  allForms?: string[]
): string => {
  if (!phrase || !targetWord) return phrase;

  // Создаем массив всех возможных форм для выделения
  const wordsToHighlight = [
    targetWord.toLowerCase(),
    ...(allForms || []).map(form => form.toLowerCase()),
  ].filter(word => word && word.length > 1);

  let result = phrase;

  // Пробуем выделить каждую форму
  for (const word of wordsToHighlight) {
    // Создаем regex для поиска по границам слов
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b(${escapedWord})\\b`, "gi");
    result = result.replace(
      regex,
      '<span style="background-color: #FEF3C7; padding: 2px 4px; border-radius: 3px; font-weight: 600;">$1</span>'
    );
  }

  return result;
};

// Функция поиска переводов конкретных форм слов
export const findFormTranslation = (
  word: string,
  sentence: string,
  formTranslations: Map<string, string>
): {
  translation: string;
  isPhrase: boolean;
  context: string;
  contextTranslation: string;
  source: string;
} | null => {
  if (!word || !sentence) return null;

  const cleanWord = word
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]/g, "");

  // Метод 1: Поиск в глобальном Map переводов форм (быстрый поиск)
  if (formTranslations.has(cleanWord)) {
    const translation = formTranslations.get(cleanWord)!;
    console.log(`✅ Найден перевод формы в Map: "${word}" → "${translation}"`);
    return {
      translation: translation,
      isPhrase: cleanWord.includes(" "),
      context: sentence,
      contextTranslation: sentence,
      source: "formMap",
    };
  }

  console.log(`⚠️ Перевод формы не найден для: "${word}"`);
  return null;
};

// Функция разбивки текста на предложения
export const splitIntoSentences = (text: string): string[] => {
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
};

// Функция преобразования ответа Claude API в карточки
export const textToCards = (responseText: string): FlashcardOld[] => {
  if (!responseText) {
    console.warn("⚠️ Пустой ответ от API");
    return [];
  }

  try {
    // Удаляем markdown обертки если есть
    const cleanText = responseText
      .replace(/```json\s*\n?/g, "")
      .replace(/```\s*\n?/g, "")
      .trim();

    // Парсим JSON ответ
    const parsed = JSON.parse(cleanText);

    // Проверяем структуру ответа
    if (parsed && Array.isArray(parsed.flashcards)) {
      console.log(`✅ Распарсено ${parsed.flashcards.length} карточек из API ответа`);
      return parsed.flashcards;
    } else if (Array.isArray(parsed)) {
      // Если получили массив напрямую
      console.log(`✅ Распарсено ${parsed.length} карточек (прямой массив)`);
      return parsed;
    } else {
      console.warn("⚠️ Неожиданная структура ответа:", parsed);
      return [];
    }
  } catch (error) {
    console.error("❌ Ошибка парсинга JSON ответа:", error);
    console.error("📄 Проблемный текст:", responseText.substring(0, 200) + "...");

    // Возвращаем пустой массив при ошибке парсинга
    return [];
  }
};
