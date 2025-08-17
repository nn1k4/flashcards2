// client/src/components/TranslationView.tsx
import React from "react";
import type { BaseComponentProps } from "../types";

interface TranslationViewProps extends BaseComponentProps {
  /** Итоговый собранный перевод (по sid) */
  translationText: string;
}

export const TranslationView: React.FC<TranslationViewProps> = ({
  translationText,
  className = "",
  "data-testid": testId,
}) => {
  const text = (translationText || "").trim();

  const wordsCount = React.useMemo(
    () => (text ? text.split(/\s+/).filter(Boolean).length : 0),
    [text]
  );

  return (
    <div className={`w-full max-w-4xl mx-auto p-8 ${className}`} data-testid={testId}>
      <div className="bg-white rounded-3xl p-8 shadow-lg">
        {/* Заголовок */}
        <h3
          className="text-xl font-semibold mb-4 text-gray-800"
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
        >
          Translation
        </h3>

        {/* Содержимое перевода */}
        <div
          className="text-gray-700 leading-relaxed"
          style={{
            fontFamily: "Noto Sans Display, sans-serif",
            fontSize: "18px",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
          }}
          data-testid="translation-content"
        >
          {text ? (
            text
          ) : (
            <div className="text-gray-400 italic">
              Перевод будет отображён здесь после обработки текста…
            </div>
          )}
        </div>

        {/* Метрики */}
        {text && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div
              className="text-sm text-gray-500 flex items-center space-x-4"
              style={{ fontFamily: "Noto Sans Display, sans-serif" }}
            >
              <span>📊 Слов в переводе: {wordsCount}</span>
              <span>📝 Символов: {text.length}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TranslationView;
