import React from "react";
import type { AppMode, AppState, FlashcardNew } from "../types";

// Интерфейс для хука клавиатурной навигации
interface UseKeyboardNavigationProps {
  mode: AppMode; // текущий режим приложения
  state: AppState; // состояние приложения
  flashcards: FlashcardNew[]; // массив карточек
  currentIndex: number; // текущий индекс карточки
  flipped: boolean; // перевернута ли карточка
  onIndexChange: (index: number) => void; // функция изменения индекса
  onFlip: (flipped: boolean) => void; // функция переворота карточки
  onHideCard: () => void; // функция скрытия карточки
}

// Хук для обработки клавиатурной навигации в режиме флеш-карт
export const useKeyboardNavigation = ({
  mode,
  state,
  flashcards,
  currentIndex,
  flipped,
  onIndexChange,
  onFlip,
  onHideCard,
}: UseKeyboardNavigationProps) => {
  // Мемоизированный обработчик клавиш
  const handleKeyPress = React.useCallback(
    (e: KeyboardEvent) => {
      // Навигация работает только в режиме flashcards
      if (mode !== "flashcards" || state !== "ready" || flashcards.length === 0) {
        return;
      }

      // Фильтруем только видимые карточки
      const visibleCards = flashcards.filter(card => card.visible !== false);
      if (visibleCards.length === 0) return;

      const currentVisibleIndex = Math.min(currentIndex, visibleCards.length - 1);

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (currentVisibleIndex > 0) {
            onFlip(false); // Сбрасываем flip при переходе
            onIndexChange(currentVisibleIndex - 1);
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (currentVisibleIndex < visibleCards.length - 1) {
            onFlip(false); // Сбрасываем flip при переходе
            onIndexChange(currentVisibleIndex + 1);
          }
          break;

        case "ArrowUp":
        case "ArrowDown":
          e.preventDefault();
          onFlip(!flipped); // Переворачиваем карточку
          break;

        case "h":
        case "H":
          e.preventDefault();
          onHideCard(); // Скрываем текущую карточку
          break;

        case " ": // Пробел
          e.preventDefault();
          onFlip(!flipped); // Альтернативный способ переворота
          break;

        default:
          // Не обрабатываем другие клавиши
          break;
      }
    },
    [mode, state, flashcards, currentIndex, flipped, onIndexChange, onFlip, onHideCard]
  );

  // Подписка на события клавиатуры
  React.useEffect(() => {
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [handleKeyPress]);

  // Возвращаем информацию о доступных горячих клавишах
  return {
    shortcuts: {
      "←": "Предыдущая карточка",
      "→": "Следующая карточка",
      "↑↓": "Перевернуть карточку",
      H: "Скрыть карточку",
      Space: "Перевернуть карточку",
    },
  };
};
