// Централизованные типы данных для приложения изучения латышского языка

// ===================== НОВЫЕ ТИПЫ КАРТОЧЕК (v3) =====================
// Единица изучения: отдельное слово или фраза
export type Unit = "word" | "phrase";

// Встреченная форма в контексте и её перевод
export interface FormEntry {
  form: string; // точная форма из текста (слово/словосочетание)
  translation: string; // перевод этой формы
}

// Контекст появления: LV предложение/фраза и его RU перевод + формы
export interface Context {
  latvian: string; // исходная фраза/предложение (lv)
  russian: string; // перевод фразы/предложения (ru)
  forms: FormEntry[]; // реально встретившиеся формы (1..N)
}

// Унифицированная карточка
export interface Card {
  unit: Unit; // 'word' | 'phrase'
  base_form: string; // лемма или каноническая фраза
  base_translation?: string; // общий перевод (fallback на "спинку")
  contexts: Context[]; // все контексты появления
  visible: boolean; // совместимость с UI
}

// ===================== ВРЕМЕННЫЙ СОВМЕСТИМЫЙ СЛОЙ =====================
// ВАЖНО: Эти типы будут удалены после завершения этапов 2–8.
// Нужны, чтобы на Этапе 1 сборка оставалась зелёной,
// пока остальной код еще импортирует старые имена.

/** @deprecated Используйте Card. Временный алиас для совместимости. */
export type FlashcardNew = Card;

/**
 * @deprecated Исторический формат (старые поля).
 * Оставлены опциональными, чтобы не падала типизация кода,
 * который пока читает original_phrase/phrase_translation/text_forms и т.п.
 */
export interface FlashcardOld {
  // Исторические поля верхнего уровня (встречаются в коде/импортах):
  front?: string;
  back?: string;
  base_form?: string;
  base_translation?: string;
  word_form_translation?: string;
  item_type?: "word" | "phrase";
  visible?: boolean;

  // Старый формат контекстов:
  original_phrase?: string;
  phrase_translation?: string;
  text_forms?: string[];
  word_form_translations?: string[];

  // Переход: допускаем новые поля, чтобы миграция шла мягко
  contexts?: Array<{
    original_phrase?: string;
    phrase_translation?: string;
    text_forms?: string[];
    word_form_translations?: string[];
    latvian?: string;
    russian?: string;
    forms?: Array<{ form: string; translation: string }>;
  }>;

  [key: string]: unknown;
}

// =====================================================================

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
