import React from "react";
import type { FlashcardNew, TooltipState, BaseComponentProps } from "../types";
import { findPhraseAtPosition, getContainingSentence } from "../utils/textUtils";
import { findTranslationForText } from "../utils/cardUtils";

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
        hasWordFormTranslation: !!card.word_form_translation,
      });

      try {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const containerRect = event.currentTarget.closest(".bg-white")?.getBoundingClientRect();

        if (!containerRect) return;

        let translationText = "";
        let contextInfo = "";

        // ===== ПРИОРИТЕТ 1: word_form_translation из карточки =====
        if (card.word_form_translation) {
          translationText = card.word_form_translation;
          contextInfo = isPhrase
            ? `Phrase: ${card.base_form || text}`
            : `Form: ${card.base_form} → ${text}`;
          console.log(`✅ Using word_form_translation: "${text}" → "${translationText}"`);
        }

        // ===== ПРИОРИТЕТ 2: Поиск в formTranslations =====
        else if (formTranslations && formTranslations.size > 0) {
          const cleanText = text
            .toLowerCase()
            .trim()
            .replace(/[.,!?;:]/g, "");

          if (isPhrase) {
            // Для фраз: пробуем разные варианты
            console.log(`🔍 Searching phrase in formTranslations: "${cleanText}"`);

            // Пробуем точное совпадение
            translationText = formTranslations.get(cleanText) || "";

            // Пробуем варианты с разделителями
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

            // Собираем из слов если не нашли
            if (!translationText && cleanText.includes(" ")) {
              const words = cleanText.split(" ");
              const translations = words.map(w => formTranslations.get(w)).filter(Boolean);

              if (translations.length > 0) {
                // Специальная логика для "dzimšanas dienas" → "дня рождения"
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
            // Для слов: ищем форму
            console.log(`🔍 Searching word in formTranslations: "${cleanText}"`);

            // Проверяем точную форму
            const formTranslation = formTranslations.get(cleanText);
            if (formTranslation) {
              translationText = formTranslation;
              contextInfo = `Form: ${card.base_form} → ${text}`;
              console.log(`✅ Found in formTranslations: "${cleanText}" → "${formTranslation}"`);
            }

            // Проверяем двухсловные комбинации
            if (!translationText && currentSentence) {
              const sentenceWords = currentSentence.toLowerCase().split(/\s+/);
              const wordIndex = sentenceWords.findIndex(
                w => w.replace(/[.,!?;:]/g, "") === cleanText
              );

              if (wordIndex >= 0 && wordIndex < sentenceWords.length - 1) {
                const nextWord = sentenceWords[wordIndex + 1]?.replace(/[.,!?;:]/g, "");
                if (nextWord) {
                  const phrase = `${cleanText} ${nextWord}`;
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
        }

        // ===== ПРИОРИТЕТ 3: card.back =====
        if (!translationText && card.back) {
          translationText = card.back;
          contextInfo = `Card back: ${card.base_form}`;
          console.log(`📝 Using card.back: "${text}" → "${translationText}"`);
        }

        // ===== ПРИОРИТЕТ 4: base_translation =====
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

        // Проверка типа для безопасности
        if (typeof translationText !== "string") {
          console.error("⚠️ translationText is not string:", translationText);
          translationText = String(translationText) || "Translation error";
        }

        // Позиционирование tooltip
        const tooltipX = rect.left - containerRect.left + rect.width / 2;
        const tooltipY = rect.top - containerRect.top - 60;

        setTooltip({
          show: true,
          text: translationText,
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
          text: card.base_translation || card.back || "Error",
          context: "Error occurred",
          x: 0,
          y: 0,
          isPhrase: isPhrase,
        });
      }
    },
    [formTranslations]
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
      const phraseElements = [];
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
