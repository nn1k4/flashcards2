import type { FlashcardNew, FlashcardOld, Context, Card } from "../types";

/* ================================================
 * ВСПОМОГАТЕЛЬНЫЕ ХЕЛПЕРЫ ДЛЯ МЯГКОЙ МИГРАЦИИ
 * Поддержка старой и новой модели карточек
 * ================================================ */

type Unit = "word" | "phrase";

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const norm = (s: string | undefined): string => (s ?? "").normalize().trim();

/** Признак "нового" контекста Card: есть latvian/russian/forms */
const isNewContext = (
  ctx: any
): ctx is { latvian: string; russian: string; forms: { form: string; translation: string }[] } =>
  ctx &&
  (typeof ctx.latvian === "string" || typeof ctx.russian === "string" || Array.isArray(ctx.forms));

/** Попытка понять unit для старой карточки */
const inferUnitFromOld = (old: FlashcardOld): Unit => {
  const t = (old as any)?.item_type;
  return t === "phrase" ? "phrase" : "word";
};

/** Преобразование НОВОГО контекста -> СТАРЫЙ Context */
const newCtxToOldContext = (ctx: any): Context => {
  const text_forms = Array.isArray(ctx?.forms)
    ? ctx.forms.map((f: any) => (isNonEmptyString(f?.form) ? norm(f.form) : "")).filter(Boolean)
    : [];

  const word_form_translations = Array.isArray(ctx?.forms)
    ? ctx.forms
        .map((f: any) => (isNonEmptyString(f?.translation) ? norm(f.translation) : ""))
        .filter(Boolean)
    : [];

  return {
    original_phrase: norm(ctx?.latvian),
    phrase_translation: norm(ctx?.russian),
    text_forms,
    word_form_translations,
  };
};

/** Преобразование FlashcardOld/FlashcardNew/Card в массив контекстов СТАРОГО формата */
const toOldContexts = (card: any, fallbackPhrase?: string): Context[] => {
  // Если уже есть contexts старого вида (original_phrase/phrase_translation/text_forms/word_form_translations)
  if (
    Array.isArray(card?.contexts) &&
    card.contexts.some((c: any) => c && ("original_phrase" in c || "text_forms" in c))
  ) {
    return (card.contexts as Context[]).map(c => ({
      original_phrase: norm(c.original_phrase),
      phrase_translation: norm(c.phrase_translation),
      text_forms: Array.isArray(c.text_forms)
        ? c.text_forms.filter(isNonEmptyString).map(norm)
        : [],
      word_form_translations: Array.isArray((c as any).word_form_translations)
        ? (c as any).word_form_translations.filter(isNonEmptyString).map(norm)
        : [],
    }));
  }

  // Если contexts нового вида
  if (Array.isArray(card?.contexts) && card.contexts.some((c: any) => isNewContext(c))) {
    return card.contexts.map((c: any) => newCtxToOldContext(c));
  }

  // Fallback: собираем минимальный контекст из полей верхнего уровня
  const original_phrase = norm(card?.original_phrase) || norm(fallbackPhrase);
  const phrase_translation = norm(card?.phrase_translation);

  const text_forms = Array.isArray(card?.text_forms)
    ? card.text_forms.filter(isNonEmptyString).map(norm)
    : isNonEmptyString(card?.front)
      ? [norm(card.front)]
      : [];

  const word_form_translations = Array.isArray(card?.word_form_translations)
    ? card.word_form_translations.filter(isNonEmptyString).map(norm)
    : isNonEmptyString(card?.word_form_translation)
      ? [norm(card.word_form_translation)]
      : isNonEmptyString(card?.back)
        ? [norm(card.back)]
        : [];

  if (!original_phrase || !phrase_translation) {
    return []; // старое поведение: пустые контексты пропускаем
  }

  return [
    {
      original_phrase,
      phrase_translation,
      text_forms,
      word_form_translations,
    },
  ];
};

/** Определение базовой формы и перевода из старого/нового объекта */
const getBaseForm = (card: any): string => {
  const fromNew = isNonEmptyString(card?.base_form) ? card.base_form : undefined;
  const fromOld = isNonEmptyString(card?.front) ? card.front : undefined;
  const fromTextForm =
    Array.isArray(card?.text_forms) && isNonEmptyString(card.text_forms?.[0])
      ? card.text_forms[0]
      : undefined;
  return norm(fromNew || fromOld || fromTextForm || "");
};

const getBaseTranslation = (card: any): string => {
  const fromNew = isNonEmptyString(card?.base_translation) ? card.base_translation : undefined;
  const fromOldBack = isNonEmptyString(card?.back) ? card.back : undefined;
  const fromOldForms =
    Array.isArray(card?.word_form_translations) &&
    isNonEmptyString(card.word_form_translations?.[0])
      ? card.word_form_translations[0]
      : isNonEmptyString(card?.word_form_translation)
        ? card.word_form_translation
        : undefined;
  return norm(fromNew || fromOldBack || fromOldForms || "");
};

/* ================================================
 * НОРМАЛИЗАЦИЯ (оставляем без изменений логики)
 * ================================================ */

// Функция нормализации карточек с валидацией и очисткой
export const normalizeCards = (cards: FlashcardOld[]): FlashcardOld[] => {
  console.log("🐞 [normalizeCards] входные данные:", cards);
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
      // Строка ~24, после phrase_translation
      const normalizedCard: FlashcardOld = {
        front: (card.front || "").trim(),
        back: (card.back || "").trim(),
        base_form: (card.base_form || card.front || "").trim(),
        base_translation: (card.base_translation || card.back || "").trim(),
        original_phrase: card.original_phrase?.trim() || undefined,
        phrase_translation: (card.phrase_translation || "").trim(),
        word_form_translation: card.word_form_translation?.trim() || undefined, // ⬅️ ДОБАВЛЕНО РАНЕЕ
        text_forms: Array.isArray(card.text_forms)
          ? card.text_forms.filter(form => form && form.trim().length > 0)
          : [(card.front || "").trim()].filter(form => form.length > 0),
        visible: card.visible !== false,
      };

      return normalizedCard;
    });
};

/* ================================================
 * СЛИЯНИЕ: поддержка старой и новой модели
 * ================================================ */

// Функция объединения карточек по base_form (убирает дубликаты)
export const mergeCardsByBaseForm = (
  cards: (FlashcardOld | FlashcardNew | Card)[]
): FlashcardNew[] => {
  // Храним в Map base_form → FlashcardNew (контексты в старом формате для совместимости UI на Этапе 5)
  const merged = new Map<string, FlashcardNew>();

  cards.forEach(card => {
    const anyCard = card as any & { needsReprocessing?: boolean };
    const baseForm = getBaseForm(anyCard);

    if (!baseForm.trim()) {
      console.warn("Карточка без base_form пропущена:", card);
      return;
    }

    // Собираем контексты в СТАРОМ формате (чтобы Reading/Edit/TranslationView не сломались до ЭТАПА 5)
    const contexts: Context[] = toOldContexts(anyCard);

    if (merged.has(baseForm)) {
      // Добавляем контекст(ы) к существующей карточке
      const existing = merged.get(baseForm)!;

      // Обновляем word_form_translation если есть в новой записи, а в существующей отсутствует
      if (
        isNonEmptyString((anyCard as FlashcardOld).word_form_translation) &&
        !(existing as any).word_form_translation
      ) {
        (existing as any).word_form_translation = norm(
          (anyCard as FlashcardOld).word_form_translation!
        );
      }

      // Дедупликация по паре (original_phrase, phrase_translation)
      const existingKeys = new Set(
        existing.contexts.map(
          ex =>
            `${norm((ex as any).original_phrase).toLowerCase()}__${norm((ex as any).phrase_translation).toLowerCase()}`
        )
      );

      contexts.forEach(ctx => {
        const phrase = norm((ctx as any).original_phrase);
        const phraseTr = norm((ctx as any).phrase_translation);
        if (!phrase || !phraseTr) return;

        const ctxKey = `${phrase.toLowerCase()}__${phraseTr.toLowerCase()}`;
        if (!existingKeys.has(ctxKey)) {
          // нормализуем формы и добавляем
          const safeCtx: Context = {
            original_phrase: phrase,
            phrase_translation: phraseTr,
            text_forms: Array.isArray((ctx as any).text_forms)
              ? (ctx as any).text_forms.filter(isNonEmptyString).map(norm)
              : [],
            word_form_translations: Array.isArray((ctx as any).word_form_translations)
              ? (ctx as any).word_form_translations.filter(isNonEmptyString).map(norm)
              : [],
          };
          existing.contexts.push(safeCtx);
          existingKeys.add(ctxKey);
        }
      });

      if (anyCard.needsReprocessing) {
        (existing as any).needsReprocessing = true;
      }

      // Обновляем базовый перевод, если в существующей пусто, а в новой есть
      if (!isNonEmptyString((existing as any).base_translation)) {
        (existing as any).base_translation = getBaseTranslation(anyCard);
      }
    } else {
      // Создаем новую карточку (в формате совместимом с текущим UI)
      const newCard: any = {
        base_form: baseForm,
        base_translation: getBaseTranslation(anyCard),
        word_form_translation: isNonEmptyString((anyCard as any).word_form_translation)
          ? norm((anyCard as any).word_form_translation)
          : undefined,
        contexts: [...contexts],
        visible: (anyCard as any).visible !== false,
      };

      if (anyCard.needsReprocessing) {
        newCard.needsReprocessing = true;
      }

      merged.set(baseForm, newCard as FlashcardNew);
    }
  });

  const result = Array.from(merged.values());
  console.log(`🔄 Объединение завершено: ${cards.length} карточек → ${result.length} уникальных`);

  return result;
};

/* ================================================
 * СОХРАНЕНИЕ ПЕРЕВОДОВ ФОРМ: поддержка обеих схем
 * ================================================ */

// Функция сохранения переводов форм слов в Map
export const saveFormTranslations = (
  cards: (FlashcardOld | FlashcardNew | Card)[],
  currentFormTranslations: Map<string, string>
): Map<string, string> => {
  const newFormTranslations = new Map(currentFormTranslations);

  cards.forEach(card => {
    const anyCard = card as any;

    // Вариант НОВОЙ модели: contexts[].forms[]
    if (Array.isArray(anyCard?.contexts) && anyCard.contexts.some((c: any) => isNewContext(c))) {
      anyCard.contexts.forEach((ctx: any) => {
        const forms = Array.isArray(ctx?.forms) ? ctx.forms : [];
        forms.forEach((f: any) => {
          const formKey = norm(f?.form)
            .toLowerCase()
            .replace(/[.,!?;:]/g, "");
          const tr = norm(f?.translation);
          if (formKey && tr && !newFormTranslations.has(formKey)) {
            newFormTranslations.set(formKey, tr);
            console.log(`💾 [new] Сохранен перевод формы: "${formKey}" → "${tr}"`);
          }
        });
      });
      return;
    }

    // СТАРЫЙ формат: front/text_forms + word_form_translation(s)/back
    const front = isNonEmptyString(anyCard?.front) ? norm(anyCard.front) : "";
    const wft = isNonEmptyString(anyCard?.word_form_translation)
      ? norm(anyCard.word_form_translation)
      : "";
    const textForms: string[] = Array.isArray(anyCard?.text_forms)
      ? anyCard.text_forms.filter(isNonEmptyString).map(norm)
      : front
        ? [front]
        : [];

    // Сохраняем front → word_form_translation
    if (front && wft) {
      const key = front.toLowerCase().replace(/[.,!?;:]/g, "");
      if (key && !newFormTranslations.has(key)) {
        newFormTranslations.set(key, wft);
        console.log(`💾 [old] Сохранен перевод формы: "${front}" → "${wft}"`);
      }
    }

    // Сохраняем text_forms → word_form_translation
    if (textForms.length && wft) {
      textForms.forEach(form => {
        const formKey = form.toLowerCase().replace(/[.,!?;:]/g, "");
        if (formKey && !newFormTranslations.has(formKey)) {
          newFormTranslations.set(formKey, wft);
          console.log(`💾 [old] Сохранен перевод text_form: "${form}" → "${wft}"`);
        }
      });
    }
  });

  return newFormTranslations;
};

/* ================================================
 * ПОИСК/ПОДСВЕТКА (оставлены как были)
 * ================================================ */

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
  const visibleCards = flashcards.filter(card => (card as any).visible !== false);

  for (const card of visibleCards as any[]) {
    // 1. Поиск по base_form
    const cardBaseForm = ((card as any).base_form || "")
      .toLowerCase()
      .replace(/[.,!?;:]/g, "")
      .trim();
    if (cardBaseForm === cleanText) {
      // НОВОЕ: ищем правильный контекст если передано предложение
      if (sentence && Array.isArray((card as any).contexts)) {
        const rightContext = (card as any).contexts.find((context: any) => {
          const original = (context?.original_phrase || context?.latvian || "").trim();
          return original && (original.includes(sentence) || sentence.includes(original));
        });
        if (rightContext) {
          return {
            card: { ...card, back: (card as any).base_translation } as any,
            isPhrase: cleanText.includes(" "),
            contextTranslation: rightContext?.phrase_translation || rightContext?.russian,
          };
        }
      }

      return {
        card: { ...card, back: (card as any).base_translation } as any,
        isPhrase: cleanText.includes(" "),
      };
    }

    // 2. Поиск по text_forms (старый) или forms[].form (новый)
    if (Array.isArray((card as any).contexts)) {
      for (const context of (card as any).contexts) {
        // Старые text_forms
        if (Array.isArray(context?.text_forms)) {
          const formMatch = context.text_forms.find((form: string) => {
            const cleanForm = form
              .toLowerCase()
              .replace(/[.,!?;:]/g, "")
              .trim();
            return cleanForm === cleanText;
          });
          if (formMatch) {
            return {
              card: { ...card, back: (card as any).base_translation } as any,
              isPhrase: cleanText.includes(" "),
              contextTranslation: context?.phrase_translation || context?.russian,
              textForm: formMatch,
            };
          }
        }

        // Новые forms[]
        if (Array.isArray((context as any)?.forms)) {
          const f = (context as any).forms.find(
            (f: any) =>
              isNonEmptyString(f?.form) &&
              f.form
                .toLowerCase()
                .replace(/[.,!?;:]/g, "")
                .trim() === cleanText
          );
          if (f) {
            return {
              card: { ...card, back: (card as any).base_translation } as any,
              isPhrase: cleanText.includes(" "),
              contextTranslation: context?.russian || context?.phrase_translation,
              textForm: f.form,
            };
          }
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

  const card: any = cardMatch.card;

  // Если есть contexts, ищем правильный контекст
  if (Array.isArray(card.contexts) && card.contexts.length > 0) {
    // Найти контекст, который содержит текущее предложение
    const rightContext = card.contexts.find((context: any) => {
      const original = (context?.original_phrase || context?.latvian || "").trim();
      return original && (original.includes(currentSentence) || currentSentence.includes(original));
    });

    if (rightContext) {
      return rightContext?.phrase_translation || rightContext?.russian || card.base_translation;
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

    // Если получили { flashcards }
    if (parsed && Array.isArray(parsed.flashcards)) {
      console.log(`✅ Распарсено ${parsed.flashcards.length} карточек из API ответа`);
      // Приведем новые контексты к старому виду при необходимости
      const arr = parsed.flashcards as any[];
      return arr.flatMap(cardLike => {
        const contexts = toOldContexts(cardLike);
        if (contexts.length === 0) {
          // Fallback к старому минимуму
          return [
            {
              front: norm(cardLike?.front || cardLike?.base_form || ""),
              back: norm(cardLike?.word_form_translation || cardLike?.base_translation || ""),
              base_form: norm(cardLike?.base_form || cardLike?.front || ""),
              base_translation: norm(cardLike?.base_translation || cardLike?.back || ""),
              original_phrase: norm(cardLike?.original_phrase),
              phrase_translation: norm(cardLike?.phrase_translation),
              text_forms: Array.isArray(cardLike?.text_forms) ? cardLike.text_forms : [],
              visible: (cardLike as any).visible !== false,
            } as FlashcardOld,
          ];
        }
        // Развернуть по контекстам
        return contexts.map(ctx => ({
          front: (
            ctx.text_forms?.[0] ||
            norm(cardLike?.front) ||
            norm(cardLike?.base_form) ||
            ""
          ).trim(),
          back: (
            ctx.word_form_translations?.[0] ||
            norm(cardLike?.word_form_translation) ||
            norm(cardLike?.base_translation) ||
            ""
          ).trim(),
          word_form_translation:
            (
              ctx.word_form_translations?.[0] ||
              norm(cardLike?.word_form_translation) ||
              ""
            ).trim() || undefined,
          base_form: norm(cardLike?.base_form || cardLike?.front || ""),
          base_translation: norm(cardLike?.base_translation || cardLike?.back || ""),
          original_phrase: ctx.original_phrase,
          phrase_translation: ctx.phrase_translation,
          text_forms: ctx.text_forms || [],
          visible: (cardLike as any).visible !== false,
        })) as FlashcardOld[];
      });
    }

    // Если получили массив напрямую
    if (Array.isArray(parsed)) {
      console.log(`✅ Распарсено ${parsed.length} карточек (прямой массив)`);
      const arr = parsed as any[];
      return arr.flatMap(cardLike => {
        const contexts = toOldContexts(cardLike);
        if (contexts.length === 0) {
          return [
            {
              front: norm(cardLike?.front || cardLike?.base_form || ""),
              back: norm(cardLike?.word_form_translation || cardLike?.base_translation || ""),
              base_form: norm(cardLike?.base_form || cardLike?.front || ""),
              base_translation: norm(cardLike?.base_translation || cardLike?.back || ""),
              original_phrase: norm(cardLike?.original_phrase),
              phrase_translation: norm(cardLike?.phrase_translation),
              text_forms: Array.isArray(cardLike?.text_forms) ? cardLike.text_forms : [],
              visible: (cardLike as any).visible !== false,
            } as FlashcardOld,
          ];
        }
        return contexts.map(ctx => ({
          front: (
            ctx.text_forms?.[0] ||
            norm(cardLike?.front) ||
            norm(cardLike?.base_form) ||
            ""
          ).trim(),
          back: (
            ctx.word_form_translations?.[0] ||
            norm(cardLike?.word_form_translation) ||
            norm(cardLike?.base_translation) ||
            ""
          ).trim(),
          word_form_translation:
            (
              ctx.word_form_translations?.[0] ||
              norm(cardLike?.word_form_translation) ||
              ""
            ).trim() || undefined,
          base_form: norm(cardLike?.base_form || cardLike?.front || ""),
          base_translation: norm(cardLike?.base_translation || cardLike?.back || ""),
          original_phrase: ctx.original_phrase,
          phrase_translation: ctx.phrase_translation,
          text_forms: ctx.text_forms || [],
          visible: (cardLike as any).visible !== false,
        })) as FlashcardOld[];
      });
    }

    console.warn("⚠️ Неожиданная структура ответа:", parsed);
    return [];
  } catch (error) {
    console.error("❌ Ошибка парсинга JSON ответа:", error);
    console.error("📄 Проблемный текст:", responseText.substring(0, 200) + "...");
    return [];
  }
};
