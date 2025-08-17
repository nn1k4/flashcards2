// client/src/components/ReadingView.tsx
import React from "react";
import type { FlashcardNew, TooltipState, BaseComponentProps } from "../types";
import {
  findPhraseAtPosition,
  getContainingSentence,
  cleanTextForMatching,
} from "../utils/textUtils";
import { findTranslationForText } from "../utils/cardUtils";

/* ================== Утилиты нормализации ================== */
const cleanToken = (s: string): string =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()\[\]"'`«»]/g, "");

const norm = (s: string) =>
  (s ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[«»“”"(){}\[\]—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sentenceKey = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/[.?!…:;]+$/u, "")
    .trim();

/* ================== Доставание перевода формы/фразы из карточки ================== */
/**
 * Возвращает перевод формы/фразы из карточки.
 * Приоритет:
 *   1) contexts[].forms[] (новая схема) — c приоритизацией того контекста,
 *      чей LV-предложение точно совпадает с текущим предложением.
 *   2) старые поля (text_forms / word_form_translations).
 */
function lookupFormTranslationFromCard(
  card: any,
  rawText: string,
  currentSentence?: string
): { translation: string; source: "new.forms" | "old.context" } | null {
  if (!card || !Array.isArray(card.contexts)) return null;
  const needle = cleanToken(rawText);
  const curKey = currentSentence ? sentenceKey(currentSentence) : "";

  // --- Новая схема: contexts[].forms[] ---
  // 2 прохода: сначала ищем только в тех contexts, где LV == текущему предложению,
  // потом — в остальных (чтобы не «перепрыгивать» на соседние предложения).
  const contextsOrdered: any[] = [];
  const exact: any[] = [];
  const rest: any[] = [];
  for (const ctx of card.contexts) {
    const lvKey = sentenceKey(String(ctx?.latvian || ""));
    if (curKey && lvKey && lvKey === curKey) exact.push(ctx);
    else rest.push(ctx);
  }
  contextsOrdered.push(...exact, ...rest);

  for (const ctx of contextsOrdered) {
    if (Array.isArray(ctx?.forms) && ctx.forms.length > 0) {
      for (const f of ctx.forms) {
        const form = cleanToken(f?.form || "");
        if (form && form === needle) {
          const tr = (f?.translation || "").toString().trim();
          if (tr) return { translation: tr, source: "new.forms" };
        }
      }
    }
  }

  // --- Старая схема: text_forms + word_form_translations (по индексу) ---
  for (const ctx of contextsOrdered) {
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

/* ================== Пропсы ================== */
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

  /** Показ тултипа по наведению */
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

        // === 1) contexts[].forms[] / старая схема, с приоритетом на текущее предложение ===
        const fromCard = lookupFormTranslationFromCard(card as any, text, currentSentence);
        if (fromCard?.translation) {
          translationText = fromCard.translation;
          contextInfo = isPhrase
            ? `Phrase (contexts): ${card.base_form || text}`
            : `Form (contexts): ${card.base_form} → ${text}`;
        }

        // === 2) Если это ФРАЗА — берём base_translation карточки фразы, когда форм нет ===
        if (!translationText && isPhrase && card.base_translation) {
          translationText = card.base_translation;
          contextInfo = `Phrase: ${card.base_form}`;
        }

        // === 3) Историческое поле word_form_translation (если вдруг есть) ===
        if (!translationText && (card as any).word_form_translation) {
          translationText = (card as any).word_form_translation!;
          contextInfo = isPhrase
            ? `Phrase: ${card.base_form || text}`
            : `Form: ${card.base_form} → ${text}`;
        }

        // === 4) Map форм (formTranslations) ===
        if (!translationText && formTranslations && formTranslations.size > 0) {
          const clean = cleanTextForMatching(text);

          if (isPhrase) {
            // точный ключ фразы
            translationText = formTranslations.get(clean) || "";

            // более либеральные варианты
            if (!translationText) {
              const variants = [
                clean.replace(/ /g, "_"),
                clean.replace(/ /g, ""),
                clean.replace(/ /g, "-"),
              ];
              for (const v of variants) {
                const found = formTranslations.get(v);
                if (found) {
                  translationText = found;
                  break;
                }
              }
            }

            // как крайний случай — склейка словарных переводов
            if (!translationText && clean.includes(" ")) {
              const words = clean.split(" ").filter(Boolean);
              const translations = words
                .map(w => formTranslations.get(w))
                .filter(Boolean) as string[];
              if (translations.length > 0) {
                // спец-правило под «dzimšanas dienas»
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
            const formTranslation = formTranslations.get(clean);
            if (formTranslation) {
              translationText = formTranslation;
              contextInfo = `Form: ${card.base_form} → ${text}`;
            }

            // небольшой бридж для двусловных мини-фраз в пределах предложения
            if (!translationText && currentSentence) {
              const sentenceWords = currentSentence
                .split(/\s+/)
                .map(w => cleanToken(w))
                .filter(Boolean);
              const w = cleanToken(text);
              const idx = sentenceWords.findIndex(sw => sw === w);
              if (idx >= 0 && idx < sentenceWords.length - 1) {
                const phrase = `${w} ${sentenceWords[idx + 1]}`;
                const phraseTranslation = formTranslations.get(phrase);
                if (phraseTranslation) {
                  translationText = phraseTranslation;
                  contextInfo = `Phrase: ${phrase}`;
                }
              }
            }
          }
        }

        // === 5) Перевод всего предложения из карточек (с учётом текущего предложения) ===
        if (!translationText && currentSentence) {
          const viaCard = findTranslationForText(text.trim(), flashcards, currentSentence);
          if (viaCard?.contextTranslation) {
            translationText = viaCard.contextTranslation;
            contextInfo = "Sentence translation (context)";
          }
        }

        // === 6) Запасные варианты: card.back → base_translation ===
        if (!translationText && (card as any).back) {
          translationText = (card as any).back!;
          contextInfo = `Card back: ${card.base_form}`;
        }
        if (!translationText && card.base_translation) {
          translationText = card.base_translation;
          contextInfo = `Base: ${card.base_form}`;
        }

        // === FALLBACK ===
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

  // Рендер строго исходного текста (никакой реконструкции)
  // Разбиваем его на «токены» и пробелы, чтобы подсвечивать слова/фразы.
  const words = inputText.split(/(\s+)/);
  const renderedElements: React.ReactNode[] = [];
  let i = 0;

  while (i < words.length) {
    const token = words[i];

    // Пробельные токены — выводим как есть
    if (/^\s+$/.test(token)) {
      renderedElements.push(<span key={i}>{token}</span>);
      i++;
      continue;
    }

    // Чистая пунктуация — без тултипа
    if (!token.trim() || /^[.,!?;:]+$/.test(token.trim())) {
      renderedElements.push(<span key={i}>{token}</span>);
      i++;
      continue;
    }

    // 1) Попытка найти фразу (по карточкам)
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
