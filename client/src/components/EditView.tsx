import React, { useState } from "react";
import type { FlashcardNew, BaseComponentProps, Context } from "../types";

// ================== ВСПОМОГАТЕЛЬНЫЕ ХЕЛПЕРЫ (совместимость старой/новой схем) ==================
function getUnit(card: any): "word" | "phrase" {
  return card?.unit === "phrase" ? "phrase" : "word";
}

function getContextCount(card: any): number {
  return Array.isArray(card?.contexts) ? card.contexts.length : 0;
}

function getPreviewContext(card: any): { lv: string; ru: string } | null {
  if (!Array.isArray(card?.contexts) || card.contexts.length === 0) return null;
  const c = card.contexts[0] || {};
  const lv = (c.original_phrase || c.latvian || "").toString();
  const ru = (c.phrase_translation || c.russian || "").toString();
  if (!lv && !ru) return null;
  return { lv, ru };
}

// ================== Пропсы компонента ==================
interface EditViewProps extends BaseComponentProps {
  flashcards: FlashcardNew[]; // массив карточек для редактирования
  onCardUpdate: (index: number, field: string, value: string | boolean | Context[]) => void; // функция обновления карточки
  onToggleVisibility?: (index: number) => void; // ✅ optional if not required internally
  onDeleteCard: (index: number) => void; // функция удаления карточки
  onAddCard: () => void; // функция добавления новой карточки
  onClearAll: () => void; // очистка всех карточек
}

// ================== Компонент редактирования флеш-карт ==================
export const EditView: React.FC<EditViewProps> = ({
  flashcards,
  onCardUpdate,
  onToggleVisibility,
  onDeleteCard,
  onAddCard,
  onClearAll,
  className = "",
  "data-testid": testId,
}) => {
  // Локальное состояние для поиска и пагинации
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  // 📌 Сброс текущей страницы при изменении поискового запроса
  React.useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm]);

  const cardsPerPage = 20;

  // Фильтрация карточек по поисковому запросу (учитываем base_form/base_translation/unit)
  const filteredCards = React.useMemo(() => {
    if (!searchTerm.trim()) return flashcards;
    const q = searchTerm.toLowerCase();
    return flashcards.filter(card => {
      const bf = (card.base_form || "").toLowerCase();
      const bt = (card.base_translation || "").toLowerCase();
      const u = getUnit(card);
      return bf.includes(q) || bt.includes(q) || u.includes(q);
    });
  }, [flashcards, searchTerm]);

  // Подсчет карточек для отображения
  const visibleCards = filteredCards.filter(card => card.visible !== false);
  const totalPages = Math.ceil(filteredCards.length / cardsPerPage);
  const startIndex = currentPage * cardsPerPage;
  const endIndex = Math.min(startIndex + cardsPerPage, filteredCards.length);
  const cards = filteredCards.slice(startIndex, endIndex);

  // Логирование для отладки
  React.useEffect(() => {
    console.log(
      `📊 EditView: Обновлено карточек: ${filteredCards.length} | видимых: ${visibleCards.length}`
    );
  }, [filteredCards.length, visibleCards.length]);

  // Обработчик изменения страницы
  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));
  };

  // Универсальный обработчик изменения текстовых полей
  const handleTextChange =
    (index: number, field: "base_form" | "base_translation") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onCardUpdate(index, field, e.target.value);
    };

  // Обработчик смены unit
  const handleUnitChange = (index: number) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    onCardUpdate(index, "unit", e.target.value);
  };

  // Обработчик переключения видимости (используем onToggleVisibility если передан)
  const handleVisibilityToggle = (index: number, currentVisible: boolean) => {
    if (typeof onToggleVisibility === "function") {
      onToggleVisibility(index);
    } else {
      onCardUpdate(index, "visible", !currentVisible);
    }
  };

  return (
    <div className={`w-full max-w-7xl mx-auto p-8 ${className}`} data-testid={testId}>
      {/* Заголовок и действия */}
      <div className="bg-white rounded-3xl p-6 shadow-lg mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2
            className="text-2xl font-bold text-gray-800"
            style={{ fontFamily: "Noto Sans Display, sans-serif" }}
          >
            Edit Flashcards ({filteredCards.length} total)
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onAddCard}
              className="px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
              style={{ fontFamily: "Noto Sans Display, sans-serif" }}
              data-testid="add-card-button"
            >
              + Add New Card
            </button>
            <button
              onClick={onClearAll}
              className="px-4 py-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
              style={{ fontFamily: "Noto Sans Display, sans-serif" }}
              data-testid="clear-all-button"
              title="Очистить все карточки"
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Поиск */}
        <input
          type="text"
          placeholder="Search cards by base form, translation or unit..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
          data-testid="search-input"
        />
      </div>

      {/* Таблица карточек */}
      <div className="bg-white rounded-3xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">
                  VISIBLE
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-48">
                  BASE FORM
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-48">
                  BASE TRANSLATION
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28">
                  UNIT
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28">
                  CONTEXTS
                </th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-24">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cards.map((card, idx) => {
                const realIndex = startIndex + idx;
                const needsReprocessing =
                  (card as { needsReprocessing?: boolean }).needsReprocessing === true;
                const preview = getPreviewContext(card);
                const contextCount = getContextCount(card);
                const unit = getUnit(card);
                const isVisible = card.visible !== false;

                return (
                  <tr
                    key={realIndex}
                    className={`${!isVisible ? "opacity-50 bg-gray-100" : ""}`}
                    data-testid={`card-row-${realIndex}`}
                  >
                    {/* VISIBLE checkbox */}
                    <td className="px-3 py-4 align-top">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={needsReprocessing}
                          checked={isVisible}
                          onChange={() => handleVisibilityToggle(realIndex, isVisible)}
                          className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                          data-testid="visibility-checkbox"
                          title="Переключить видимость карточки"
                        />
                        {needsReprocessing && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                            needs reprocessing
                          </span>
                        )}
                      </div>
                    </td>

                    {/* BASE FORM + превью фразы */}
                    <td className="px-3 py-4 align-top">
                      <input
                        type="text"
                        disabled={needsReprocessing}
                        value={card.base_form || ""}
                        onChange={handleTextChange(realIndex, "base_form")}
                        placeholder="Введите базовую форму..."
                        className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                        data-testid="base-form-input"
                      />
                      {preview?.lv && (
                        <div className="mt-1 text-xs text-gray-500 line-clamp-2">
                          <span className="font-medium">LV:</span> {preview.lv}
                        </div>
                      )}
                    </td>

                    {/* BASE TRANSLATION + превью перевода */}
                    <td className="px-3 py-4 align-top">
                      <input
                        type="text"
                        disabled={needsReprocessing}
                        value={card.base_translation || ""}
                        onChange={handleTextChange(realIndex, "base_translation")}
                        placeholder="Введите перевод..."
                        className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                        data-testid="base-translation-input"
                      />
                      {preview?.ru && (
                        <div className="mt-1 text-xs text-gray-500 line-clamp-2">
                          <span className="font-medium">RU:</span> {preview.ru}
                        </div>
                      )}
                    </td>

                    {/* UNIT */}
                    <td className="px-3 py-4 align-top">
                      <select
                        className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        value={unit}
                        onChange={handleUnitChange(realIndex)}
                        disabled={needsReprocessing}
                        title="Тип карточки"
                      >
                        <option value="word">word</option>
                        <option value="phrase">phrase</option>
                      </select>
                    </td>

                    {/* CONTEXTS count */}
                    <td className="px-3 py-4 align-top">
                      <span className="inline-flex items-center gap-2 text-sm">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                        {contextCount}
                      </span>
                    </td>

                    {/* ACTIONS */}
                    <td className="px-3 py-4 text-center align-top">
                      {!needsReprocessing && (
                        <button
                          onClick={() => onDeleteCard(realIndex)}
                          className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                          title="Удалить карточку"
                          data-testid="delete-card-button"
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Пагинация */}
        {totalPages > 1 && (
          <div className="px-6 py-4 bg-gray-50 border-t">
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-700">
                Showing {startIndex + 1} to {endIndex} of {filteredCards.length} cards
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 0}
                  className={`px-3 py-1 rounded ${
                    currentPage === 0
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                  style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                  data-testid="previous-page"
                >
                  Previous
                </button>

                <span
                  className="px-3 py-1 text-gray-700"
                  style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                >
                  Page {currentPage + 1} of {totalPages}
                </span>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages - 1}
                  className={`px-3 py-1 rounded ${
                    currentPage >= totalPages - 1
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                  style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                  data-testid="next-page"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Информация */}
      <div className="mt-6 text-center">
        <p
          className="text-white/80 text-sm"
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
        >
          💾 All changes are saved automatically. Simple and clean interface.
        </p>
      </div>
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default EditView;
