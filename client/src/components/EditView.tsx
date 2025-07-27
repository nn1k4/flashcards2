import React, { useState } from "react";
import type { FlashcardNew, BaseComponentProps, Context } from "../types";

// Интерфейс пропсов для EditView компонента
interface EditViewProps extends BaseComponentProps {
  flashcards: FlashcardNew[]; // массив карточек для редактирования
  onCardUpdate: (index: number, field: string, value: string | boolean | Context[]) => void; // функция обновления карточки
  onDeleteCard: (index: number) => void; // функция удаления карточки
  onAddCard: () => void; // функция добавления новой карточки
}

// Компонент редактирования флеш-карт
export const EditView: React.FC<EditViewProps> = ({
  flashcards,
  onCardUpdate,
  onDeleteCard,
  onAddCard,
  className = "",
  "data-testid": testId,
}) => {
  // Локальное состояние для поиска и пагинации
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const cardsPerPage = 20;

  // Фильтрация карточек по поисковому запросу
  const filteredCards = React.useMemo(() => {
    if (!searchTerm.trim()) return flashcards;

    const searchLower = searchTerm.toLowerCase();
    return flashcards.filter(
      card =>
        (card.base_form || "").toLowerCase().includes(searchLower) ||
        (card.base_translation || "").toLowerCase().includes(searchLower)
    );
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
      `📊 EditView: Обновлено карточек: ${filteredCards.length} видимых: ${visibleCards.length}`
    );
  }, [filteredCards.length, visibleCards.length]);

  // Обработчик изменения страницы
  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));
  };

  return (
    <div className={`w-full max-w-7xl mx-auto p-8 ${className}`} data-testid={testId}>
      {/* Заголовок и кнопка добавления */}
      <div className="bg-white rounded-3xl p-6 shadow-lg mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2
            className="text-2xl font-bold text-gray-800"
            style={{ fontFamily: "Noto Sans Display, sans-serif" }}
          >
            Edit Flashcards ({filteredCards.length} total)
          </h2>
          <button
            onClick={onAddCard}
            className="px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
            style={{ fontFamily: "Noto Sans Display, sans-serif" }}
            data-testid="add-card-button"
          >
            + Add New Card
          </button>
        </div>

        {/* Поиск */}
        <input
          type="text"
          placeholder="Search cards by base form or translation..."
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
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-20">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cards.map(card => {
                const realIndex = flashcards.findIndex(originalCard => originalCard === card);
                const isSystem =
                  (card as { needsReprocessing?: boolean }).needsReprocessing === true;

                return (
                  <tr
                    key={realIndex}
                    className={`${!card.visible ? "opacity-50 bg-gray-100" : ""}`}
                    data-testid={`card-row-${realIndex}`}
                  >
                    {/* VISIBLE checkbox */}
                    <td className="px-3 py-4">
                      {!isSystem && (
                        <input
                          type="checkbox"
                          checked={card.visible !== false}
                          onChange={e => onCardUpdate(realIndex, "visible", e.target.checked)}
                          className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                          data-testid="visibility-checkbox"
                        />
                      )}
                    </td>

                    {/* BASE FORM */}
                    <td className="px-3 py-4">
                      <input
                        type="text"
                        value={card.base_form || ""}
                        onChange={e => onCardUpdate(realIndex, "base_form", e.target.value)}
                        placeholder="Введите базовую форму..."
                        className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                        data-testid="base-form-input"
                      />
                    </td>

                    {/* BASE TRANSLATION */}
                    <td className="px-3 py-4">
                      <input
                        type="text"
                        value={card.base_translation || ""}
                        onChange={e => onCardUpdate(realIndex, "base_translation", e.target.value)}
                        placeholder="Введите перевод..."
                        className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                        data-testid="base-translation-input"
                      />
                    </td>

                    {/* ACTIONS */}
                    <td className="px-3 py-4 text-center">
                      {!isSystem && (
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
