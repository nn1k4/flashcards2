// client/src/components/EditView.tsx
import React, { useMemo, useState, useEffect } from "react";
import type { FlashcardNew, BaseComponentProps, Context } from "../types";

/* ===================== Helpers (new/old schema friendly) ===================== */
function getUnit(card: any): "word" | "phrase" {
  // 1) explicit from data
  const u = String(card?.unit || "").toLowerCase();
  if (u === "word" || u === "phrase") return u as "word" | "phrase";

  // 2) base_form looks like a phrase
  const bf = (card?.base_form || "").trim();
  if (/\s/.test(bf)) return "phrase";

  // 3) first LV context looks like a phrase
  const lv = String(card?.contexts?.[0]?.latvian || card?.contexts?.[0]?.original_phrase || "");
  if (/\s/.test(lv.trim())) return "phrase";

  return "word";
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

function stableKeyOf(card: any, fallback: string) {
  const bf = (card?.base_form || "").toString();
  const bt = (card?.base_translation || "").toString();
  const u = getUnit(card);
  // Prefer an id if present, otherwise a composite key
  return (card?.id as string) || `${u}::${bf}::${bt}` || fallback;
}

/* ===================== Props ===================== */
interface EditViewProps extends BaseComponentProps {
  flashcards: FlashcardNew[];
  onCardUpdate: (index: number, field: string, value: string | boolean | Context[]) => void;
  onToggleVisibility?: (index: number) => void;
  onDeleteCard: (index: number) => void;
  onAddCard: () => void;
  onClearAll: () => void;
}

/* ===================== Component ===================== */
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
  // Local UI state
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const cardsPerPage = 20;

  // Reset page when search changes
  useEffect(() => setCurrentPage(0), [searchTerm]);

  // Filter by base_form / base_translation / unit
  const filteredCards = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return flashcards;
    return flashcards.filter(card => {
      const bf = (card.base_form || "").toLowerCase();
      const bt = (card.base_translation || "").toLowerCase();
      const u = getUnit(card);
      return bf.includes(q) || bt.includes(q) || u.includes(q);
    });
  }, [flashcards, searchTerm]);

  // Map filteredCards -> indices in the source array (stable addressing)
  const indexMap = useMemo(
    () => filteredCards.map(c => flashcards.indexOf(c)),
    [filteredCards, flashcards]
  );

  const totalPages = Math.ceil(filteredCards.length / cardsPerPage);
  const startIndex = currentPage * cardsPerPage;
  const endIndex = Math.min(startIndex + cardsPerPage, filteredCards.length);

  // Page slices
  const pageCards = filteredCards.slice(startIndex, endIndex);
  const pageIndices = indexMap.slice(startIndex, endIndex);

  // Fallback resolver if referential equality is lost
  const getRealIndex = (card: any, fallback: number) => {
    const idx = flashcards.indexOf(card);
    if (idx !== -1) return idx;
    const bf = card?.base_form;
    const bt = card?.base_translation;
    const u = getUnit(card);
    const byFields = flashcards.findIndex(
      c => c.base_form === bf && c.base_translation === bt && getUnit(c) === u
    );
    return byFields !== -1 ? byFields : fallback;
  };

  // Logging
  useEffect(() => {
    const visible = filteredCards.filter(c => c.visible !== false).length;
    console.log(`📊 EditView: filtered=${filteredCards.length} | visible=${visible}`);
  }, [filteredCards]);

  // Handlers
  const handlePageChange = (page: number) =>
    setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));

  const handleTextChange =
    (index: number, field: "base_form" | "base_translation") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onCardUpdate(index, field, e.target.value);
    };

  const handleUnitChange = (index: number) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value === "phrase" ? "phrase" : "word";
    onCardUpdate(index, "unit", val);
  };

  const handleVisibilityToggle = (index: number, currentVisible: boolean) => {
    if (typeof onToggleVisibility === "function") {
      onToggleVisibility(index);
    } else {
      onCardUpdate(index, "visible", !currentVisible);
    }
  };

  return (
    <div className={`w-full max-w-7xl mx-auto p-8 ${className}`} data-testid={testId}>
      {/* Header */}
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

        {/* Search */}
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

      {/* Table */}
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
              {pageCards.map((card, idx) => {
                const fallbackIdx = pageIndices[idx];
                const realIndex = getRealIndex(card, fallbackIdx);
                const unit = getUnit(card);
                const isVisible = card.visible !== false;
                const needsReprocessing =
                  (card as { needsReprocessing?: boolean }).needsReprocessing === true;
                const preview = getPreviewContext(card);
                const contextCount = getContextCount(card);

                return (
                  <tr
                    key={stableKeyOf(card, String(realIndex))}
                    className={`${!isVisible ? "opacity-50 bg-gray-100" : ""}`}
                    data-testid={`card-row-${realIndex}`}
                  >
                    {/* VISIBLE */}
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

                    {/* BASE FORM */}
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

                    {/* BASE TRANSLATION */}
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

                    {/* CONTEXTS */}
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

        {/* Pagination */}
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

      {/* Footer */}
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

export default EditView;
