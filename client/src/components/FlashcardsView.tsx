import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FlashcardNew, BaseComponentProps } from "../types";
import { highlightWordInPhrase } from "../utils/cardUtils";

// Интерфейс пропсов для FlashcardsView компонента
interface FlashcardsViewProps extends BaseComponentProps {
  flashcards: FlashcardNew[]; // массив карточек для изучения
  currentIndex: number; // текущий индекс карточки
  flipped: boolean; // перевернута ли карточка
  onIndexChange: (index: number) => void; // функция изменения индекса
  onFlip: (flipped: boolean) => void; // функция переворота карточки
  onHideCard: () => void; // функция скрытия карточки
  keyboardShortcuts?: Record<string, string>; // горячие клавиши для отображения
}

// Компонент отображения и навигации по флеш-картам
export const FlashcardsView: React.FC<FlashcardsViewProps> = ({
  flashcards,
  currentIndex,
  flipped,
  onIndexChange,
  onFlip,
  // onHideCard используется через клавиатурную навигацию в App.tsx, не в этом компоненте
  keyboardShortcuts,
  className = "",
  "data-testid": testId,
}) => {
  // Проверяем наличие карточек
  if (!flashcards || flashcards.length === 0) {
    return (
      <div className={`text-center text-white ${className}`} data-testid={testId}>
        <p style={{ fontFamily: "Noto Sans Display, sans-serif" }}>No flashcards available</p>
      </div>
    );
  }

  // Фильтруем только видимые карточки
  const visibleCards = flashcards.filter(card => card.visible !== false);

  if (visibleCards.length === 0) {
    return (
      <div className={`text-center text-white ${className}`} data-testid={testId}>
        <p style={{ fontFamily: "Noto Sans Display, sans-serif" }}>
          All flashcards are hidden. Enable some cards in Edit mode.
        </p>
      </div>
    );
  }

  // Корректируем текущий индекс
  const adjustedIndex = Math.min(currentIndex, visibleCards.length - 1);
  const currentCard = visibleCards[adjustedIndex];

  if (!currentCard) {
    return (
      <div className={`text-center text-white ${className}`} data-testid={testId}>
        <p style={{ fontFamily: "Noto Sans Display, sans-serif" }}>Invalid card data</p>
      </div>
    );
  }

  // Функции навигации
  const handleNext = () => {
    if (adjustedIndex < visibleCards.length - 1) {
      onFlip(false);
      onIndexChange(adjustedIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (adjustedIndex > 0) {
      onFlip(false);
      onIndexChange(adjustedIndex - 1);
    }
  };

  // Получаем данные карточки
  const cardFront = currentCard.base_form || "";
  const cardBack = currentCard.base_translation || "";
  const cardContexts = currentCard.contexts || [];

  return (
    <div className={`w-full max-w-2xl mx-auto px-8 ${className}`} data-testid={testId}>
      {/* Основная карточка */}
      <div className="relative">
        <div
          className="relative w-full h-96 bg-white rounded-3xl shadow-xl cursor-pointer"
          onClick={() => onFlip(!flipped)}
          data-testid="flashcard"
        >
          {!flipped ? (
            // Лицевая сторона карточки
            <div className="flex flex-col items-center justify-center h-full p-8">
              <div className="text-center flex-1 flex items-center justify-center">
                <h2
                  className="text-4xl font-medium text-gray-800"
                  style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                  data-testid="card-front"
                >
                  {cardFront}
                </h2>
              </div>
              <p
                className="text-gray-500 mt-auto text-center"
                style={{ fontFamily: "Noto Sans Display, sans-serif" }}
              >
                Click or use ↑↓ arrows to flip
                <br />
                ←→ arrows to navigate
              </p>
            </div>
          ) : (
            // Оборотная сторона карточки
            <div className="flex flex-col h-full p-8">
              {/* Основной перевод */}
              <div className="flex-1 flex items-center justify-center">
                <p
                  className="text-4xl text-gray-700 font-medium text-center"
                  style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                  data-testid="card-back"
                >
                  {cardBack}
                </p>
              </div>
              {/* Множественные контексты - показываем только если есть валидные контексты */}
              {cardContexts.length > 0 && cardContexts.some(ctx => ctx.original_phrase?.trim()) && (
                <div
                  className="mt-4 space-y-3 max-h-40 overflow-y-auto"
                  data-testid="card-contexts"
                >
                  {cardContexts
                    .slice(0, 2)
                    .filter(ctx => ctx.original_phrase?.trim())
                    .map((context, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-lg"
                        style={{ backgroundColor: "rgba(106, 155, 204, 0.15)" }}
                      >
                        {/* Номер контекста если их больше одного */}
                        {cardContexts.length > 1 && (
                          <div
                            className="text-xs text-gray-500 mb-1"
                            style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                          >
                            Context {idx + 1}:
                          </div>
                        )}

                        {/* Оригинальная фраза с выделением */}
                        <div
                          className="text-base text-gray-800 font-semibold mb-2"
                          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                          dangerouslySetInnerHTML={{
                            __html: highlightWordInPhrase(
                              context.original_phrase,
                              cardFront,
                              context.text_forms
                            ),
                          }}
                        />

                        {/* Перевод фразы */}
                        <p
                          className="text-base text-gray-600"
                          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                        >
                          {context.phrase_translation}
                        </p>
                      </div>
                    ))}

                  {/* Индикатор дополнительных контекстов */}
                  {cardContexts.length > 2 && (
                    <div
                      className="text-center text-sm text-gray-500"
                      style={{ fontFamily: "Noto Sans Display, sans-serif" }}
                    >
                      +{cardContexts.length - 2} more contexts available
                    </div>
                  )}
                </div>
              )}

              {/* ИСПРАВЛЕНО: Убран fallback блок "No context available" */}
              {/* Если контекстов нет - ничего не показываем, как и просил пользователь */}
            </div>
          )}
        </div>
      </div>

      {/* Навигация */}
      <div className="flex items-center justify-center mt-8">
        <button
          onClick={handlePrevious}
          disabled={adjustedIndex === 0}
          className={`p-3 rounded-full transition-all ${
            adjustedIndex === 0
              ? "bg-white/20 text-white/50 cursor-not-allowed"
              : "bg-white/20 text-white hover:bg-white/30"
          }`}
          data-testid="previous-button"
          title="Предыдущая карточка (←)"
        >
          <ChevronLeft size={24} />
        </button>

        <span
          className="mx-6 text-white text-lg font-medium"
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
          data-testid="card-counter"
        >
          {adjustedIndex + 1} / {visibleCards.length}
        </span>

        <button
          onClick={handleNext}
          disabled={adjustedIndex === visibleCards.length - 1}
          className={`p-3 rounded-full transition-all ${
            adjustedIndex === visibleCards.length - 1
              ? "bg-white/20 text-white/50 cursor-not-allowed"
              : "bg-white/20 text-white hover:bg-white/30"
          }`}
          data-testid="next-button"
          title="Следующая карточка (→)"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Горячие клавиши */}
      {keyboardShortcuts && (
        <div className="mt-6 text-center">
          <div
            className="text-white/70 text-sm"
            style={{ fontFamily: "Noto Sans Display, sans-serif" }}
          >
            Горячие клавиши:{" "}
            {Object.entries(keyboardShortcuts)
              .map(([key, desc]) => `${key} - ${desc}`)
              .join(" • ")}
          </div>
        </div>
      )}
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default FlashcardsView;
