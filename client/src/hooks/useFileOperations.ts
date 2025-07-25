import React from "react";
import type { FlashcardNew, ExportData } from "../types";

// Интерфейс для хука операций с файлами
interface UseFileOperationsProps {
  flashcards: FlashcardNew[]; // текущие карточки
  inputText: string; // исходный текст
  translationText: string; // перевод текста
  formTranslations: Map<string, string>; // переводы форм слов
  onDataLoad: (data: ExportData) => void; // функция загрузки данных
}

// Хук для импорта и экспорта данных приложения
export const useFileOperations = ({
  flashcards,
  inputText,
  translationText,
  formTranslations,
  onDataLoad,
}: UseFileOperationsProps) => {
  // Функция экспорта данных в JSON файл
  const exportData = React.useCallback(() => {
    try {
      const data: ExportData = {
        inputText,
        flashcards, // Включает ВСЕ карточки, даже скрытые
        translationText,
        formTranslations: Array.from(formTranslations.entries()), // НОВОЕ: Сохраняем переводы форм
        timestamp: new Date().toISOString(),
        version: "2.1", // Увеличили версию из-за нового поля
      };

      const jsonString = JSON.stringify(data, null, 2);
      const filename = `latvian-learning-${new Date().toISOString().split("T")[0]}.json`;

      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log("Export completed successfully");
      return true;
    } catch (error) {
      console.error("Export error:", error);
      alert("Export failed. Please try again.");
      return false;
    }
  }, [flashcards, inputText, translationText, formTranslations]);

  // Функция импорта данных из JSON файла
  const importData = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = e => {
        try {
          const result = e.target?.result;
          if (!result || typeof result !== "string") {
            throw new Error("Failed to read file");
          }

          const data = JSON.parse(result) as ExportData;

          // Валидация структуры данных
          if (
            !data.inputText ||
            !data.flashcards ||
            !Array.isArray(data.flashcards) ||
            !data.translationText
          ) {
            throw new Error("Invalid file format. Please select a valid export file.");
          }

          // Нормализация карточек для обеспечения совместимости
          const normalizedCards: FlashcardNew[] = data.flashcards.map(card => {
            // Проверяем, это новая или старая структура карточки
            if ("contexts" in card && Array.isArray(card.contexts)) {
              // Новая структура - используем как есть
              return {
                base_form: card.base_form || "",
                base_translation: card.base_translation || "",
                contexts: card.contexts || [],
                visible: card.visible !== undefined ? card.visible : true,
              };
            } else {
              // Старая структура - конвертируем в новую
              const oldCard = card as FlashcardOld | FlashcardNew;
              return {
                base_form: oldCard.base_form || oldCard.front || "",
                base_translation: oldCard.base_translation || oldCard.back || "",
                contexts: [
                  {
                    original_phrase: oldCard.original_phrase || "",
                    phrase_translation: oldCard.phrase_translation || "",
                    text_forms: Array.isArray(oldCard.text_forms)
                      ? oldCard.text_forms
                      : [oldCard.front || ""],
                  },
                ],
                visible: oldCard.visible !== undefined ? oldCard.visible : true,
              };
            }
          });

          // Создаем объект для загрузки
          const loadData: ExportData = {
            ...data,
            flashcards: normalizedCards,
          };

          // Загружаем данные
          onDataLoad(loadData);

          // Очищаем input для повторного использования
          event.target.value = "";

          const totalCards = normalizedCards.length;
          const visibleCards = normalizedCards.filter(card => card.visible).length;
          alert(
            `Imported ${totalCards} flashcards (${visibleCards} visible, ${totalCards - visibleCards} hidden)`
          );
        } catch (error) {
          console.error("Error importing data:", error);
          alert(
            `Error importing file: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      };

      reader.readAsText(file);
    },
    [onDataLoad]
  );

  // Возвращаем функции для использования в компонентах
  return {
    exportData,
    importData,
  };
};
