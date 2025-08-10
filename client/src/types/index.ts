// Централизованные типы данных для приложения изучения латышского языка

export type ClaudeTool = {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
};

export type ClaudeToolChoice =
  | "auto"
  | "none"
  | {
      type: "tool" | "function";
      name: string;
    };

// Контекст использования слова в предложении
export interface Context {
  original_phrase: string; // предложение где встретилось слово
  phrase_translation: string; // перевод этого предложения
  text_forms: string[]; // формы слова в этом предложении
  word_form_translations: string[]; // НОВОЕ: переводы конкретных форм слов
}

// Новая структура флеш-карты с множественными контекстами
export interface FlashcardNew {
  base_form: string; // основная форма слова (для группировки)
  base_translation: string; // перевод основной формы
  word_form_translation?: string;
  contexts: Context[]; // МАССИВ контекстов (может быть несколько)
  visible: boolean; // видимость карточки
}

// Старая структура флеш-карты (для совместимости)
export interface FlashcardOld {
  front: string; // форма слова из текста
  back: string; // перевод формы
  word_form_translation: string; // НОВОЕ: перевод конкретной формы слова
  base_form: string; // основная форма
  base_translation: string; // перевод основной формы
  original_phrase: string; // исходное предложение
  phrase_translation: string; // перевод предложения
  text_forms: string[]; // массив форм слова
  visible: boolean; // видимость карточки
  item_type?: "word" | "phrase";
}

// Прогресс обработки текста
export interface ProcessingProgress {
  current: number; // текущий обработанный чанк
  total: number; // общее количество чанков
  step: string; // текущий шаг или ошибка
}

// Состояния приложения
export type AppState = "input" | "loading" | "ready";

// Режимы работы приложения
export type AppMode = "text" | "flashcards" | "reading" | "translation" | "edit";

// Состояние tooltip в режиме Reading
export interface TooltipState {
  show: boolean; // показывать ли tooltip
  text: string; // текст перевода
  context: string; // контекстная информация
  x: number; // позиция X
  y: number; // позиция Y
  isPhrase: boolean; // это фраза или слово
}

// Настройки приложения (для будущего использования)
export interface AppSettings {
  chunking: {
    mode: "sentences" | "tokens"; // тип разбиения
    sentencesPerChunk: number; // предложений в чанке
    maxTokensPerChunk: number; // максимум токенов в чанке
  };
  display: {
    contextsToShow: number | "all"; // количество показываемых контекстов
    autoSaveInterval: number; // интервал автосохранения
    enableAutoExport: boolean; // автоэкспорт при завершении
  };
  processing: {
    enableProgressResume: boolean; // возобновление прогресса
    maxRetries: number; // попытки при ошибках
  };
}

// Данные для экспорта/импорта
export interface ExportData {
  inputText: string; // исходный текст
  flashcards: FlashcardNew[] | FlashcardOld[]; // карточки
  translationText: string; // итоговый перевод
  formTranslations: [string, string][]; // переводы форм (Map в массив)
  timestamp: string; // время создания
  version: string; // версия формата
  settings?: AppSettings; // настройки (опционально)
}

// Результат обработки чанка
export interface ChunkProcessingResult {
  cards: FlashcardOld[]; // полученные карточки
  translationSegment: string; // перевод чанка
  error?: string; // ошибка если есть
}

// Пропсы для компонентов (базовые)
export interface BaseComponentProps {
  className?: string; // дополнительные CSS классы
  "data-testid"?: string; // для тестирования
}

// Импорт типов конфигурации
export type { AppConfig } from "../config";
// Дополнительные типы для работы с конфигурацией
export type ClaudeProfile = "textProcessing" | "healthCheck";

// Расширение интерфейса Window для временного хранения данных импорта
declare global {
  interface Window {
    tempFormTranslations?: Map<string, string>;
  }
}

// КРИТИЧНО: Экспорт пустого объекта чтобы файл считался модулем
export {};
