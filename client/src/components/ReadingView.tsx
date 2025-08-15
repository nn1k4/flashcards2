import React from "react";
import type { FlashcardNew, TooltipState, BaseComponentProps } from "../types";
import { findPhraseAtPosition, getContainingSentence } from "../utils/textUtils";
import { findTranslationForText } from "../utils/cardUtils";

// ================== ВСПОМОГАТЕЛЬНЫЕ ХЕЛПЕРЫ ==================
const cleanToken = (s: string): string =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()\[\]"'`«»]/g, "");

/**
 * Пытается найти перевод конкретной формы/фразы в карточке
 * 1) Новая схема: contexts[].forms[{ form, translation }]
 * 2) Старая схема: context.text_forms[] + context.word_form_translations[] (по индексу)
 * Возвращает { translation, source } или null
 */
function lookupFormTranslationFromCard(
  card: any,
  rawText: string
): { translation: string; source: "new.forms" | "old.context" } | null {
  if (!card || !Array.isArray(card.contexts)) return null;
  const needle = cleanToken(rawText);

  for (const ctx of card.contexts) {
    // Новая схема
    if (Array.isArray(ctx?.forms) && ctx.forms.length > 0) {
      for (const f of ctx.forms) {
        const form = cleanToken(f?.form || "");
        if (form && form === needle) {
          const tr = (f?.translation || "").toString().trim();
          if (tr) return { translation: tr, source: "new.forms" };
        }
      }
    }

    // Старая схема
    if (Array.isArray(ctx?.text_forms) && ctx.text_forms.length > 0) {
      const index = ctx.text_forms.findIndex((t: string) => cleanToken(t) === needle);
      if (index >= 0) {
        // Берем перевод из word_form_translations по индексу
        const tr =
          (Array.isArray(ctx.word_form_translations) &&
            (ctx.word_form_translations[index] || ctx.word_form_translations[0])) ||
          "";
        const trClean = (tr || "").toString().trim();
        if (trClean) return { translation: trClean, source: "old.context" };
      }
    }
  }

  return null;
}

// Интерфейс пропсов для ReadingView компонента
interface ReadingViewProps extends BaseComponentProps {
  inputText: string; // исходный латышский текст
  formTranslations: Map<string, string>; // Map переводов форм слов
  flashcards: FlashcardNew[]; // массив карточек с контекстами
}

// Компонент интерактивного чтения с контекстными подсказками
export const ReadingView: React.FC<ReadingViewProps> = ({
  inputText,
  formTranslations,
  flashcards,
  className = "",
  "data-testid": testId,
}) => {
  // Состояние tooltip
  const [tooltip, setTooltip] = React.useState<TooltipState>({
    show: false,
    text: "",
    context: "",
    x: 0,
    y: 0,
    isPhrase: false,
  });

  // Функция скрытия tooltip с очисткой стилей DOM
  const hideTooltip = React.useCallback((event?: React.MouseEvent) => {
    // Очищаем стили DOM элемента, если event передан
    if (event?.currentTarget) {
      const element = event.currentTarget as HTMLElement;
      if (element.style) {
        element.style.backgroundColor = ""; // Убираем жёлтый фон
      }
    }

    setTooltip({
      show: false,
      text: "",
      context: "",
      x: 0,
      y: 0,
      isPhrase: false,
    });
  }, []);

  // Функция обработки hover на слово/фразу
  const handleWordHover = React.useCallback(
    (
      card: FlashcardNew,
      text: string,
      event: React.MouseEvent,
      isPhrase: boolean,
      currentSentence?: string
    ) => {
      if (!card || !event?.currentTarget) return;

      console.log(`🎯 handleWordHover called:`, {
        text,
        isPhrase,
        currentSentence: currentSentence ? currentSentence.substring(0, 50) + "..." : "none",
        cardBaseForm: card.base_form,
        hasWordFormTranslation: !!(card as any).word_form_translation,
      });

      try {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const containerRect = event.currentTarget.closest(".bg-white")?.getBoundingClientRect();

        if (!containerRect) return;

        let translationText = "";
        let contextInfo = "";

        // ===== ПРИОРИТЕТ 1: Точная форма/фраза из контекстов карточки (новая/старая схема) =====
        const fromCard = lookupFormTranslationFromCard(card as any, text);
        if (fromCard?.translation) {
          translationText = fromCard.translation;
          contextInfo = isPhrase
            ? `Phrase (contexts): ${card.base_form || text}`
            : `Form (contexts): ${card.base_form} → ${text}`;
          console.log(`✅ Using ${fromCard.source}: "${text}" → "${translationText}"`);
        }

        // ===== ПРИОРИТЕТ 2: word_form_translation из карточки (историческое поле) =====
        if (!translationText && (card as any).word_form_translation) {
          translationText = (card as any).word_form_translation!;
          contextInfo = isPhrase
            ? `Phrase: ${card.base_form || text}`
            : `Form: ${card.base_form} → ${text}`;
          console.log(`✅ Using word_form_translation: "${text}" → "${translationText}"`);
        }

        // ===== ПРИОРИТЕТ 3: Поиск в formTranslations (глобальная Map) =====
        if (!translationText && formTranslations && formTranslations.size > 0) {
          const cleanText = cleanToken(text);

          if (isPhrase) {
            console.log(`🔍 Searching phrase in formTranslations: "${cleanText}"`);
            // Точное совпадение
            translationText = formTranslations.get(cleanText) || "";

            // Варианты с разделителями
            if (!translationText) {
              const variants = [
                cleanText.replace(/ /g, "_"),
                cleanText.replace(/ /g, ""),
                cleanText.replace(/ /g, "-"),
              ];
              for (const variant of variants) {
                const found = formTranslations.get(variant);
                if (found) {
                  translationText = found;
                  console.log(`✅ Found phrase variant: "${variant}" → "${found}"`);
                  break;
                }
              }
            }

            // Собрать из слов, если не нашли
            if (!translationText && cleanText.includes(" ")) {
              const words = cleanText.split(" ").filter(Boolean);
              const translations = words
                .map(w => formTranslations.get(w))
                .filter(Boolean) as string[];

              if (translations.length > 0) {
                // Спец-кейс: "dzimšanas dienas" → "дня рождения"
                if (
                  words.includes("dzimšanas") &&
                  (words.includes("diena") || words.includes("dienas"))
                ) {
                  translationText = translations.reverse().join(" ");
                } else {
                  translationText = translations.join(" ");
                }
                console.log(`🔧 Built phrase from words: "${translationText}"`);
              }
            }

            if (translationText) {
              contextInfo = `Phrase: ${card.base_form || text}`;
            }
          } else {
            // Для слов
            console.log(`🔍 Searching word in formTranslations: "${cleanText}"`);
            const formTranslation = formTranslations.get(cleanText);
            if (formTranslation) {
              translationText = formTranslation;
              contextInfo = `Form: ${card.base_form} → ${text}`;
              console.log(`✅ Found in formTranslations: "${cleanText}" → "${formTranslation}"`);
            }

            // Двухсловные комбинации в рамках предложения
            if (!translationText && currentSentence) {
              const sentenceWords = currentSentence
                .split(/\s+/)
                .map(w => cleanToken(w))
                .filter(Boolean);
              const w = cleanToken(text);
              const wordIndex = sentenceWords.findIndex(sw => sw === w);

              if (wordIndex >= 0 && wordIndex < sentenceWords.length - 1) {
                const phrase = `${w} ${sentenceWords[wordIndex + 1]}`;
                const phraseTranslation = formTranslations.get(phrase);
                if (phraseTranslation) {
                  translationText = phraseTranslation;
                  contextInfo = `Phrase: ${phrase}`;
                  console.log(`✅ Found two-word phrase: "${phrase}" → "${phraseTranslation}"`);
                }
              }
            }
          }
        }

        // ===== ПРИОРИТЕТ 4: Контекстная подсказка из карточек (findTranslationForText) =====
        if (!translationText && currentSentence) {
          const viaCard = findTranslationForText(text.trim(), flashcards, currentSentence);
          if (viaCard?.contextTranslation) {
            translationText = viaCard.contextTranslation;
            contextInfo = isPhrase
              ? "Sentence translation (context)"
              : "Sentence translation (context)";
            console.log(`🧠 Using context sentence translation: "${translationText}"`);
          }
        }

        // ===== ПРИОРИТЕТ 5: card.back (историческое поле), затем base_translation =====
        if (!translationText && (card as any).back) {
          translationText = (card as any).back!;
          contextInfo = `Card back: ${card.base_form}`;
          console.log(`📝 Using card.back: "${text}" → "${translationText}"`);
        }
        if (!translationText && card.base_translation) {
          translationText = card.base_translation;
          contextInfo = `Base: ${card.base_form}`;
          console.log(`⚠️ Using base_translation: "${text}" → "${translationText}"`);
        }

        // ===== FALLBACK =====
        if (!translationText) {
          translationText = "Translation not found";
          contextInfo = "No translation available";
          console.log(`❌ No translation found for: "${text}"`);
        }

        // Позиционирование tooltip
        const tooltipX = rect.left - containerRect.left + rect.width / 2;
        const tooltipY = rect.top - containerRect.top - 60;

        setTooltip({
          show: true,
          text: typeof translationText === "string" ? translationText : String(translationText),
          context: contextInfo,
          x: tooltipX,
          y: tooltipY,
          isPhrase: isPhrase,
        });

        // Визуальная обратная связь
        const element = event.currentTarget as HTMLElement;
        if (element.style) {
          element.style.backgroundColor = "#fef3c7"; // Желтый фон
        }
      } catch (error) {
        console.error("❌ Tooltip error:", error);

        // Fallback при ошибке
        setTooltip({
          show: true,
          text: (card.base_translation || (card as any).back || "Error") as string,
          context: "Error occurred",
          x: 0,
          y: 0,
          isPhrase: isPhrase,
        });
      }
    },
    [formTranslations, flashcards]
  );

  // Проверяем наличие текста
  console.log("📖 [ReadingView] inputText length:", inputText?.length);
  console.log("📖 [ReadingView] flashcards:", flashcards.length);

  if (!inputText) {
    return (
      <div className={`text-center text-white ${className}`} data-testid={testId}>
        <p style={{ fontFamily: "Noto Sans Display, sans-serif" }}>No text available for reading</p>
      </div>
    );
  }

  // Разбиваем текст на слова с сохранением пробелов
  const words = inputText.split(/(\s+)/);
  const renderedElements: React.ReactNode[] = [];
  let i = 0;

  // Обрабатываем каждое слово
  while (i < words.length) {
    const word = words[i];

    // Пропускаем пробелы
    if (/^\s+$/.test(word)) {
      renderedElements.push(<span key={i}>{word}</span>);
      i++;
      continue;
    }

    // Пропускаем чистую пунктуацию
    if (!word.trim() || /^[.,!?;:]+$/.test(word.trim())) {
      renderedElements.push(<span key={i}>{word}</span>);
      i++;
      continue;
    }

    // Сначала пробуем найти фразу
    const phraseMatch = findPhraseAtPosition(words, i, flashcards);

    if (phraseMatch) {
      // Найдена фраза - собираем элементы
      const phraseElements: string[] = [];
      let phraseWordsCollected = 0;
      let j = i;

      while (j < words.length && phraseWordsCollected < phraseMatch.length) {
        if (/^\s+$/.test(words[j])) {
          phraseElements.push(words[j]);
        } else {
          phraseElements.push(words[j]);
          phraseWordsCollected++;
        }
        j++;
      }

      const phraseText = phraseElements.join("");

      renderedElements.push(
        <span
          key={`phrase-${i}`}
          className="hover:bg-blue-100 cursor-pointer border-b-2 border-dotted border-blue-400 bg-blue-50"
          onMouseEnter={e =>
            handleWordHover(
              phraseMatch.card,
              phraseText,
              e,
              true,
              getContainingSentence(i, words, inputText)
            )
          }
          onMouseLeave={hideTooltip}
        >
          {phraseText}
        </span>
      );

      i = j;
      continue;
    }

    // Проверяем индивидуальное слово
    const wordMatch = findTranslationForText(word.trim(), flashcards);

    if (wordMatch) {
      renderedElements.push(
        <span
          key={i}
          className="hover:bg-yellow-100 cursor-pointer border-b border-dotted border-orange-300"
          onMouseEnter={e =>
            handleWordHover(
              wordMatch.card,
              word,
              e,
              false,
              getContainingSentence(i, words, inputText)
            )
          }
          onMouseLeave={hideTooltip}
        >
          {word}
        </span>
      );
    } else {
      renderedElements.push(<span key={i}>{word}</span>);
    }

    i++;
  }

  return (
    <div className={`w-full max-w-4xl mx-auto p-8 ${className}`} data-testid={testId}>
      {/* Легенда с объяснением цветов */}
      <div
        className="rounded-2xl p-4 shadow-lg mb-4"
        style={{ backgroundColor: "rgba(106, 155, 204, 0.3)" }}
      >
        <div
          className="flex items-center justify-center space-x-6 text-sm"
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
        >
          <div className="flex items-center space-x-2">
            <span className="px-2 py-1 bg-blue-50 border-b-2 border-dotted border-blue-400 rounded">
              phrase example
            </span>
            <span className="text-white">📖 Phrases (blue)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-1 bg-yellow-50 border-b border-dotted border-orange-300 rounded">
              word
            </span>
            <span className="text-white">📝 Words (yellow)</span>
          </div>
        </div>
      </div>

      {/* Основной текст с интерактивными элементами */}
      <div className="bg-white rounded-3xl p-8 shadow-lg relative">
        <div
          className="text-gray-900 leading-relaxed"
          style={{
            fontFamily: "Noto Sans Display, sans-serif",
            fontSize: "18px",
            lineHeight: "1.8",
          }}
          data-testid="interactive-text"
        >
          {renderedElements}
        </div>

        {/* Tooltip */}
        {tooltip.show && (
          <div
            className={`absolute z-50 px-3 py-2 rounded-lg shadow-lg pointer-events-none max-w-xs ${
              tooltip.isPhrase ? "bg-blue-800 text-white" : "bg-gray-800 text-white"
            }`}
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: "translateX(-50%)",
              fontFamily: "Noto Sans Display, sans-serif",
              fontSize: "14px",
            }}
            data-testid="tooltip"
          >
            <div className="font-medium">{tooltip.text}</div>
            {tooltip.context && <div className="text-xs opacity-90 mt-1">{tooltip.context}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default ReadingView;
