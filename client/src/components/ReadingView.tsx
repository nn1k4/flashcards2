import React from "react";
import type { FlashcardNew, TooltipState, BaseComponentProps } from "../types";
import { findPhraseAtPosition, getContainingSentence } from "../utils/textUtils";
import { findTranslationForText, findFormTranslation } from "../utils/cardUtils";

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
        formTranslationsSize: formTranslations.size,
      });

      try {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const containerRect = event.currentTarget.closest(".bg-white")?.getBoundingClientRect();

        if (!containerRect) return;

        let translationText = "";
        let contextInfo = "";

        if (isPhrase) {
          // ДЛЯ ФРАЗ: сначала ищем правильную форму фразы
          console.log(`🔍 Searching phrase translation for: "${text}"`);

          const cleanPhrase = text
            .toLowerCase()
            .trim()
            .replace(/[.,!?;:]/g, "");

          // 1. СНАЧАЛА ищем точную форму фразы в formTranslations
          let foundTranslation = formTranslations?.get?.(cleanPhrase);

          if (foundTranslation) {
            translationText = foundTranslation;
            contextInfo = `Phrase form: ${card.base_form?.trim()} → ${text}`;
            console.log(`✅ Found exact phrase form: "${text}" → "${foundTranslation}"`);
          } else {
            // 2. Пробуем варианты с разными разделителями
            const phraseVariants = [
              cleanPhrase.replace(/ /g, "_"), // dzimšanas_dienas
              cleanPhrase.replace(/ /g, ""), // dzimšanasdienas
              cleanPhrase.replace(/ /g, "-"), // dzimšanas-dienas
            ];

            for (const variant of phraseVariants) {
              foundTranslation = formTranslations?.get?.(variant);
              if (foundTranslation) {
                translationText = foundTranslation;
                contextInfo = `Phrase variant: ${variant}`;
                console.log(`✅ Found phrase variant: "${variant}" → "${foundTranslation}"`);
                break;
              }
            }
          }

          // 3. Если не найдено, собираем из отдельных слов
          if (!translationText && cleanPhrase.includes(" ")) {
            console.log(`🔧 Building phrase translation from words: "${cleanPhrase}"`);

            const words = cleanPhrase.split(" ");
            const wordTranslations = words
              .map(word => formTranslations?.get?.(word.trim()))
              .filter(t => t && t.length > 0);

            if (wordTranslations.length > 0) {
              // Специальная логика для латышских фраз
              if (
                words.length === 2 &&
                (words.includes("dzimšanas") || words.includes("diena") || words.includes("dienas"))
              ) {
                // Для "dzimšanas dienas" = "рождения" + "дня" → "дня рождения"
                translationText = wordTranslations.reverse().join(" ");
                console.log(`🔧 Built Latvian phrase (reversed): "${translationText}"`);
              } else {
                translationText = wordTranslations.join(" ");
                console.log(`🔧 Built phrase (normal order): "${translationText}"`);
              }
              contextInfo = `Built from: ${words.join(" ")}`;
            }
          }

          // 4. Проверяем соответствие с base_form карточки (с очисткой пробелов)
          if (!translationText) {
            const cardBaseForm = (card.base_form || "")
              .toLowerCase()
              .trim()
              .replace(/[.,!?;:]/g, "");

            if (
              cardBaseForm === cleanPhrase ||
              cardBaseForm.includes(cleanPhrase) ||
              cleanPhrase.includes(cardBaseForm)
            ) {
              translationText = card.base_translation || "";
              contextInfo = `Phrase base: ${card.base_form?.trim()}`;
              console.log(`⚠️ Using base translation for phrase: "${text}" → "${translationText}"`);
            }
          }

          // 5. Финальный fallback
          if (!translationText) {
            translationText = card.base_translation || card.back || "Phrase translation not found";
            contextInfo = `Phrase fallback: ${card.base_form?.trim() || text}`;
            console.log(`❌ Using fallback for phrase: "${text}" → "${translationText}"`);
          }

          // 6. БЕЗОПАСНОСТЬ: убеждаемся что это строка
          if (typeof translationText !== "string") {
            console.error("⚠️ Phrase translationText is not string:", translationText);
            translationText = String(translationText) || "Phrase translation error";
          }
        } else {
          // ДЛЯ СЛОВ: ищем перевод конкретной формы слова из данного предложения
          console.log(
            `🔍 Searching word form translation for: "${text}" in sentence: "${currentSentence || "unknown"}"`
          );

          let foundTranslation = null;
          let foundContext = "";

          if (currentSentence) {
            // 1. Безопасный поиск точной формы слова
            const formResult = findFormTranslation(text, currentSentence, formTranslations);

            if (formResult) {
              // Безопасное извлечение перевода
              if (typeof formResult === "string") {
                foundTranslation = formResult;
              } else if (typeof formResult === "object" && formResult.translation) {
                foundTranslation = formResult.translation;
              }

              if (foundTranslation) {
                foundContext = `Form: ${card.base_form} → ${text}`;
                console.log(`✅ Found form translation: "${text}" → "${foundTranslation}"`);
              }
            }

            // 2. Если не найдено, проверяем двухсловные фразы
            if (!foundTranslation) {
              const cleanText = text.toLowerCase().replace(/[.,!?;:]/g, "");
              const sentenceWords = currentSentence.toLowerCase().split(/\s+/);
              const wordIndex = sentenceWords.findIndex(
                w => w.replace(/[.,!?;:]/g, "") === cleanText
              );

              if (wordIndex >= 0 && wordIndex < sentenceWords.length - 1) {
                const nextWord = sentenceWords[wordIndex + 1]?.replace(/[.,!?;:]/g, "");

                if (nextWord) {
                  const twoWordPhrase = `${cleanText} ${nextWord}`;
                  console.log(`🔍 Checking two-word phrase: "${twoWordPhrase}"`);

                  // Проверяем перевод фразы целиком
                  const phraseTranslation = formTranslations?.get?.(twoWordPhrase);

                  if (phraseTranslation) {
                    foundTranslation = phraseTranslation;
                    foundContext = `Phrase: ${cleanText} ${nextWord}`;
                    console.log(
                      `✅ Found phrase translation: "${twoWordPhrase}" → "${phraseTranslation}"`
                    );
                  } else {
                    // Собираем из переводов отдельных слов
                    const word1Trans = formTranslations?.get?.(cleanText);
                    const word2Trans = formTranslations?.get?.(nextWord);

                    if (word1Trans && word2Trans) {
                      if (
                        cleanText === "dzimšanas" &&
                        (nextWord === "dienas" || nextWord === "diena")
                      ) {
                        // Для латышского: "дня рождения" или "день рождения"
                        foundTranslation = `${word2Trans} ${word1Trans}`;
                        foundContext = `Built phrase: ${nextWord} ${cleanText}`;
                        console.log(`🔧 Built "${twoWordPhrase}": "${foundTranslation}"`);
                      } else {
                        foundTranslation = `${word1Trans} ${word2Trans}`;
                        foundContext = `Built phrase: ${cleanText} ${nextWord}`;
                        console.log(`🔧 Built phrase: "${foundTranslation}"`);
                      }
                    }
                  }
                }
              }
            }
          }

          // 3. Используем найденный перевод или fallback
          if (foundTranslation) {
            translationText = foundTranslation;
            contextInfo = foundContext;
          } else {
            // Fallback к base_translation
            translationText = card.base_translation || card.back || "Translation not found";
            contextInfo = `Base: ${card.base_form}`;
            console.log(`⚠️ Using base translation: "${text}" → "${translationText}"`);
          }

          // 4. БЕЗОПАСНОСТЬ: убеждаемся что translationText это строка
          if (typeof translationText !== "string") {
            console.error("⚠️ translationText is not string:", translationText);
            translationText = String(translationText) || "Error: invalid translation";
          }
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
        if ((event.currentTarget as HTMLElement).style) {
          (event.currentTarget as HTMLElement).style.backgroundColor = "#fef3c7"; // Желтый фон при показе tooltip
        }
      } catch (error) {
        console.error("❌ Tooltip positioning error:", error);

        // Fallback tooltip при ошибке
        setTooltip({
          show: true,
          text: card.base_translation || card.back || "Translation error",
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
