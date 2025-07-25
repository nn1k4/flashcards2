import React from "react";
import type { BaseComponentProps } from "../types";

// Интерфейс пропсов для TranslationView компонента
interface TranslationViewProps extends BaseComponentProps {
  translationText: string; // текст перевода для отображения
}

// Компонент отображения итогового перевода текста
export const TranslationView: React.FC<TranslationViewProps> = ({
  translationText,
  className = "",
  "data-testid": testId,
}) => {
  return (
    <div className={`w-full max-w-4xl mx-auto p-8 ${className}`} data-testid={testId}>
      <div className="bg-white rounded-3xl p-8 shadow-lg">
        {/* Заголовок секции */}
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
          }}
          data-testid="translation-content"
        >
          {translationText ? (
            translationText
          ) : (
            <div className="text-gray-400 italic">
              Перевод будет отображен здесь после обработки текста...
            </div>
          )}
        </div>

        {/* Дополнительная информация, если перевод есть */}
        {translationText && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div
              className="text-sm text-gray-500 flex items-center space-x-4"
              style={{ fontFamily: "Noto Sans Display, sans-serif" }}
            >
              <span>📊 Слов в переводе: {translationText.split(/\s+/).length}</span>
              <span>📝 Символов: {translationText.length}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default TranslationView;
