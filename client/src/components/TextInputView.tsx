import React from "react";
import type { AppState, ProcessingProgress, BaseComponentProps } from "../types";

// Интерфейс пропсов для TextInputView компонента
interface TextInputViewProps extends BaseComponentProps {
  inputText: string; // текущий введенный текст
  setInputText: (text: string) => void; // функция изменения текста
  onProcessText: () => void; // функция запуска обработки
  state: AppState; // текущее состояние приложения
  processingProgress: ProcessingProgress; // прогресс обработки
}

// Компонент отображения загрузки с прогрессом
const LoadingView: React.FC<{ processingProgress: ProcessingProgress }> = ({
  processingProgress,
}) => {
  const isProcessingChunks = processingProgress.total > 0;
  const progressPercent = isProcessingChunks
    ? Math.round((processingProgress.current / processingProgress.total) * 100)
    : 0;

  return (
    <div className="text-center">
      <h2
        className="text-white text-3xl font-medium mb-4"
        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
      >
        Processing text...
      </h2>

      {isProcessingChunks ? (
        <div className="mb-6">
          <p className="text-white/80 mb-4" style={{ fontFamily: "Noto Sans Display, sans-serif" }}>
            {processingProgress.step}
          </p>

          {/* Прогресс-бар */}
          <div className="w-full max-w-md mx-auto">
            <div
              className="flex justify-between text-white/70 text-sm mb-2"
              style={{ fontFamily: "Noto Sans Display, sans-serif" }}
            >
              <span>
                Chunk {processingProgress.current} of {processingProgress.total}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full bg-white/20 rounded-full h-3">
              <div
                className="bg-white h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <p className="text-white/80 mb-6" style={{ fontFamily: "Noto Sans Display, sans-serif" }}>
            Generating flashcards and translation...
          </p>
          <div className="flex justify-center">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
          </div>
        </div>
      )}

      <button
        onClick={() => window.location.reload()}
        className="px-6 py-2 bg-white/20 text-white rounded-full hover:bg-white/30 transition-colors"
        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
      >
        Cancel
      </button>
    </div>
  );
};

// Основной компонент ввода текста
export const TextInputView: React.FC<TextInputViewProps> = ({
  inputText,
  setInputText,
  onProcessText,
  state,
  processingProgress,
  className = "",
  "data-testid": testId,
}) => {
  // Если состояние загрузки, показываем компонент загрузки
  if (state === "loading") {
    return (
      <div className={className} data-testid={testId}>
        <LoadingView processingProgress={processingProgress} />
      </div>
    );
  }

  // Вычисляем количество символов и проверяем лимит
  const charCount = inputText.length;
  const isOverLimit = charCount > 15000;

  return (
    <div className={`w-full max-w-4xl mx-auto p-8 ${className}`} data-testid={testId}>
      {/* Основное поле ввода */}
      <div className="bg-white rounded-3xl p-8 shadow-lg">
        <textarea
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          placeholder="Paste Latvian text here..."
          className="w-full h-64 text-gray-900 placeholder-gray-400 resize-none focus:outline-none"
          style={{
            fontFamily: "Noto Sans Display, sans-serif",
            fontSize: "18px",
            lineHeight: "1.6",
          }}
          data-testid="text-input"
        />

        {/* Счетчик символов */}
        <div className="flex justify-between items-center mt-4">
          <div
            className={`text-sm ${isOverLimit ? "text-red-500" : "text-gray-500"}`}
            style={{ fontFamily: "Noto Sans Display, sans-serif" }}
          >
            {charCount} / 15000 characters {isOverLimit && "(too long)"}
          </div>
        </div>
      </div>

      {/* Кнопка обработки */}
      <button
        onClick={onProcessText}
        disabled={!inputText.trim() || isOverLimit}
        className="w-full mt-8 py-4 bg-gray-900 text-white font-medium rounded-full hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-lg"
        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
        data-testid="process-button"
      >
        Process (Chunk-by-Chunk)
      </button>
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default TextInputView;
