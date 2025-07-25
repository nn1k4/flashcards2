import React from "react";
import { Download } from "lucide-react";
import type { BaseComponentProps } from "../types";

// Интерфейс пропсов для Header компонента
interface HeaderProps extends BaseComponentProps {
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void; // обработчик импорта файла
  onExport: () => void; // обработчик экспорта данных
  isProcessed: boolean; // есть ли обработанные данные
}

// Компонент заголовка приложения с кнопками импорта и экспорта
export const Header: React.FC<HeaderProps> = ({
  onImport,
  onExport,
  isProcessed,
  className = "",
  "data-testid": testId,
}) => {
  return (
    <div className={`flex items-center justify-between ${className}`} data-testid={testId}>
      {/* Заголовок приложения */}
      <h1
        className="text-white text-4xl font-bold"
        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
      >
        Latvian Language Learning
      </h1>

      {/* Блок кнопок импорта и экспорта */}
      <div className="flex flex-col items-center space-y-2">
        {/* Кнопка импорта */}
        <div className="relative">
          <input
            type="file"
            accept=".json"
            onChange={onImport}
            style={{ display: "none" }}
            id="import-file-input"
            data-testid="import-file-input"
          />
          <label
            htmlFor="import-file-input"
            className="px-6 py-2 bg-white/20 text-white rounded-full font-medium hover:bg-white/30 transition-colors cursor-pointer flex items-center space-x-2"
            style={{ fontFamily: "Noto Sans Display, sans-serif" }}
            data-testid="import-button"
          >
            <Download size={16} className="transform rotate-180" aria-hidden="true" />
            <span>import</span>
          </label>
        </div>

        {/* Кнопка экспорта */}
        <button
          onClick={onExport}
          disabled={!isProcessed}
          className={`px-6 py-2 rounded-full font-medium transition-all flex items-center space-x-2 ${
            isProcessed
              ? "bg-white text-gray-700 hover:bg-white/90 cursor-pointer"
              : "bg-white/20 text-white/50 cursor-not-allowed"
          }`}
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
          data-testid="export-button"
          title={isProcessed ? "Экспортировать данные" : "Сначала обработайте текст"}
        >
          <Download size={16} aria-hidden="true" />
          <span>export</span>
        </button>
      </div>
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default Header;
