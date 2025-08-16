import React from "react";
import type { FlashcardNew, TooltipState, BaseComponentProps } from "../types";
import {
  findPhraseAtPosition,
  getContainingSentence,
  cleanTextForMatching,
} from "../utils/textUtils";
import { findTranslationForText } from "../utils/cardUtils";

/* ================== ВСПОМОГАТЕЛЬНЫЕ ХЕЛПЕРЫ ================== */
const cleanToken = (s: string): string =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()\[\]"'`«»]/g, "");

/**
 * Ищет перевод конкретной формы/фразы в карточке.
 * 1) Новая схема: contexts[].forms[{ form, translation }]
 * 2) Старая схема: context.text_forms[] + context.word_form_translations[] (по индексу)
 */
function lookupFormTranslationFromCard(
  card: any,
  rawText: string
): { translation: string; source: "new.forms" | "old.context" } | null {
  if (!card || !Array.isArray(card.contexts)) return null;
  const needle = cleanToken(rawText);

  for (const ctx of card.contexts) {
    // Новая схема (приоритет)
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

/* ================== Пропсы компонента ================== */
interface ReadingViewProps extends BaseComponentProps {
  inputText: string;
  formTranslations: Map<string, string>;
  flashcards: FlashcardNew[];
}

/* ================== Компонент интерактивного чтения ================== */
export const ReadingView: React.FC<ReadingViewProps> = ({
  inputText,
  formTranslations,
  flashcards,
  className = "",
  "data-testid": testId,
}) => {
  const [tooltip, setTooltip] = React.useState<TooltipState>({
    show: false,
    text: "",
    context: "",
    x: 0,
    y: 0,
    isPhrase: false,
  });

  const hideTooltip = React.useCallback((event?: React.MouseEvent) => {
    if (event?.currentTarget) {
      const element = event.currentTarget as HTMLElement;
      if (element.style) element.style.backgroundColor = "";
    }
    setTooltip({ show: false, text: "", context: "", x: 0, y: 0, isPhrase: false });
  }, []);

  /** Главная функция показа тултипа */
  const handleWordHover = React.useCallback(
    (
      card: FlashcardNew,
      text: string,
      event: React.MouseEvent,
      isPhrase: boolean,
      currentSentence?: string
    ) => {
      if (!card || !event?.currentTarget) return;

      try {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const containerRect = event.currentTarget.closest(".bg-white")?.getBoundingClientRect();
        if (!containerRect) return;

        let translationText = "";
        let contextInfo = "";

        // ===== ПРИОРИТЕТ 1: точная форма/фраза из contexts (новая/старая схема) =====
        const fromCard = lookupFormTranslationFromCard(card as any, text);
        if (fromCard?.translation) {
          translationText = fromCard.translation;
          contextInfo = isPhrase
            ? `Phrase (contexts): ${card.base_form || text}`
            : `Form (contexts): ${card.base_form} → ${text}`;
        }

        // ===== ПРИОРИТЕТ 2: если это ФРАЗА — берем base_translation карточки фразы =====
        // (Это исправляет кейс «iebiezināts piens»: показываем «сгущенное молоко», а не склейку отдельных слов)
        if (!translationText && isPhrase && card.base_translation) {
          translationText = card.base_translation;
          contextInfo = `Phrase: ${card.base_form}`;
        }

        // ===== ПРИОРИТЕТ 3: историческое поле word_form_translation =====
        if (!translationText && (card as any).word_form_translation) {
          translationText = (card as any).word_form_translation!;
          contextInfo = isPhrase
            ? `Phrase: ${card.base_form || text}`
            : `Form: ${card.base_form} → ${text}`;
        }

        // ===== ПРИОРИТЕТ 4: Map форм (formTranslations) =====
        if (!translationText && formTranslations && formTranslations.size > 0) {
          const cleanText = cleanTextForMatching(text);

          if (isPhrase) {
            // точное совпадение по ключу фразы
            translationText = formTranslations.get(cleanText) || "";

            // варианты с разделителями
            if (!translationText) {
              const variants = [
                cleanText.replace(/ /g, "_"),
                cleanText.replace(/ /g, ""),
                cleanText.replace(/ /g, "-"),
              ];
              for (const v of variants) {
                const found = formTranslations.get(v);
                if (found) {
                  translationText = found;
                  break;
                }
              }
            }

            // ⚠️ ЕСЛИ фразовый перевод так и не найден — только тогда пробуем «склейку слов»
            if (!translationText && cleanText.includes(" ")) {
              const words = cleanText.split(" ").filter(Boolean);
              const translations = words
                .map(w => formTranslations.get(w))
                .filter(Boolean) as string[];

              if (translations.length > 0) {
                // Спец-правило под «dzimšanas dienas»
                if (
                  words.includes("dzimšanas") &&
                  (words.includes("diena") || words.includes("dienas"))
                ) {
                  translationText = translations.reverse().join(" ");
                } else {
                  translationText = translations.join(" ");
                }
              }
            }

            if (translationText) {
              contextInfo = `Phrase: ${card.base_form || text}`;
            }
          } else {
            // слово
            const formTranslation = formTranslations.get(cleanText);
            if (formTranslation) {
              translationText = formTranslation;
              contextInfo = `Form: ${card.base_form} → ${text}`;
            }

            // Проба двухсловной мини-фразы в пределах предложения
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
                }
              }
            }
          }
        }

        // ===== ПРИОРИТЕТ 5: контекстное предложение из карточек =====
        if (!translationText && currentSentence) {
          const viaCard = findTranslationForText(text.trim(), flashcards, currentSentence);
          if (viaCard?.contextTranslation) {
            translationText = viaCard.contextTranslation;
            contextInfo = "Sentence translation (context)";
          }
        }

        // ===== ПРИОРИТЕТ 6: card.back → base_translation =====
        if (!translationText && (card as any).back) {
          translationText = (card as any).back!;
          contextInfo = `Card back: ${card.base_form}`;
        }
        if (!translationText && card.base_translation) {
          translationText = card.base_translation;
          contextInfo = `Base: ${card.base_form}`;
        }

        // ===== FALLBACK =====
        if (!translationText) {
          translationText = "Translation not found";
          contextInfo = "No translation available";
        }

        // Позиционирование тултипа
        const tooltipX = rect.left - containerRect.left + rect.width / 2;
        const tooltipY = rect.top - containerRect.top - 60;

        setTooltip({
          show: true,
          text: typeof translationText === "string" ? translationText : String(translationText),
          context: contextInfo,
          x: tooltipX,
          y: tooltipY,
          isPhrase,
        });

        // Подсветка ховер-элемента
        const element = event.currentTarget as HTMLElement;
        if (element.style) element.style.backgroundColor = isPhrase ? "#dbeafe" : "#fef3c7";
      } catch (error) {
        console.error("❌ Tooltip error:", error);
        setTooltip({
          show: true,
          text: (card.base_translation || (card as any).back || "Error") as string,
          context: "Error occurred",
          x: 0,
          y: 0,
          isPhrase,
        });
      }
    },
    [formTranslations, flashcards]
  );

  // Диагностика
  console.log("📖 [ReadingView] inputText length:", inputText?.length);
  console.log("📖 [ReadingView] flashcards:", flashcards.length);

  if (!inputText) {
    return (
      <div className={`text-center text-white ${className}`} data-testid={testId}>
        <p style={{ fontFamily: "Noto Sans Display, sans-serif" }}>No text available for reading</p>
      </div>
    );
  }

  // Разбивка текста на «слова» и «пробелы» (для позиционной логики)
  const words = inputText.split(/(\s+)/);
  const renderedElements: React.ReactNode[] = [];
  let i = 0;

  while (i < words.length) {
    const token = words[i];

    // Пробелы — выводим как есть
    if (/^\s+$/.test(token)) {
      renderedElements.push(<span key={i}>{token}</span>);
      i++;
      continue;
    }

    // Пунктуация отдельно, без подсказок
    if (!token.trim() || /^[.,!?;:]+$/.test(token.trim())) {
      renderedElements.push(<span key={i}>{token}</span>);
      i++;
      continue;
    }

    // 1) Пытаемся найти фразу
    const phraseMatch = findPhraseAtPosition(words, i, flashcards);
    if (phraseMatch) {
      const phraseParts: string[] = [];
      let collected = 0;
      let j = i;

      while (j < words.length && collected < phraseMatch.length) {
        const w = words[j++];
        phraseParts.push(w);
        if (!/^\s+$/.test(w)) collected++;
      }

      const phraseText = phraseParts.join("");

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

    // 2) Иначе — проверяем индивидуальное слово
    const wordMatch = findTranslationForText(token.trim(), flashcards);
    if (wordMatch) {
      renderedElements.push(
        <span
          key={i}
          className="hover:bg-yellow-100 cursor-pointer border-b border-dotted border-orange-300"
          onMouseEnter={e =>
            handleWordHover(
              wordMatch.card,
              token,
              e,
              false,
              getContainingSentence(i, words, inputText)
            )
          }
          onMouseLeave={hideTooltip}
        >
          {token}
        </span>
      );
    } else {
      renderedElements.push(<span key={i}>{token}</span>);
    }

    i++;
  }

  return (
    <div className={`w-full max-w-4xl mx-auto p-8 ${className}`} data-testid={testId}>
      {/* Легенда */}
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

      {/* Текст и тултип */}
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

export default ReadingView;
