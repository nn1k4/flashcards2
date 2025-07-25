import React from "react";
import { X } from "lucide-react";
import type { AppMode, BaseComponentProps } from "../types";

// Интерфейс пропсов для ModeSelector компонента
interface ModeSelectorProps extends BaseComponentProps {
  mode: AppMode; // текущий выбранный режим
  onChange: (mode: AppMode) => void; // функция изменения режима
  onClear: () => void; // функция очистки данных
  isProcessed: boolean; // есть ли обработанные данные
}

// Конфигурация режимов приложения
const MODES_CONFIG = [
  { key: "text" as AppMode, label: "Text", requiresData: false },
  { key: "flashcards" as AppMode, label: "Flashcards", requiresData: true },
  { key: "reading" as AppMode, label: "Reading", requiresData: true },
  { key: "translation" as AppMode, label: "Translation", requiresData: true },
  { key: "edit" as AppMode, label: "Edit", requiresData: true },
];

// Компонент селектора режимов работы приложения
export const ModeSelector: React.FC<ModeSelectorProps> = ({
  mode,
  onChange,
  onClear,
  isProcessed,
  className = "",
  "data-testid": testId,
}) => {
  return (
    <div
      className={`flex justify-center items-center mb-8 space-x-4 ${className}`}
      data-testid={testId}
    >
      {/* Группа кнопок режимов */}
      <div className="bg-white/20 p-0.5 rounded-full inline-flex">
        {MODES_CONFIG.map(({ key, label, requiresData }) => {
          const isActive = mode === key;
          const isDisabled = requiresData && !isProcessed;

          return (
            <button
              key={key}
              onClick={() => !isDisabled && onChange(key)}
              disabled={isDisabled}
              className={`px-6 py-2 rounded-full font-medium transition-all text-base ${
                isDisabled
                  ? "text-white/50 cursor-not-allowed"
                  : isActive
                    ? "bg-white text-gray-700 shadow-md"
                    : "text-white hover:text-white/90"
              }`}
              style={{ fontFamily: "Noto Sans Display, sans-serif" }}
              data-testid={`mode-${key}`}
              title={isDisabled ? "Сначала обработайте текст" : `Переключиться на режим ${label}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Кнопка очистки данных */}
      <button
        onClick={onClear}
        className="px-4 py-2 bg-red-600 text-white rounded-full font-medium hover:bg-red-700 transition-colors flex items-center space-x-2"
        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
        data-testid="clear-button"
        title="Очистить все данные"
      >
        <X size={16} aria-hidden="true" />
        <span>Clear</span>
      </button>
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default ModeSelector;
