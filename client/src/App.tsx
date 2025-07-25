import React from "react";
import type { AppMode, FlashcardNew } from "./types";

// Импорт всех UI компонентов (существующая архитектура)
import Header from "./components/Header";
import ModeSelector from "./components/ModeSelector";
import Footer from "./components/Footer";
import TextInputView from "./components/TextInputView";
import FlashcardsView from "./components/FlashcardsView";
import ReadingView from "./components/ReadingView";
import TranslationView from "./components/TranslationView";
import EditView from "./components/EditView";

// Импорт всех кастомных хуков (существующая архитектура)
import { useProcessing } from "./hooks/useProcessing";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useFileOperations } from "./hooks/useFileOperations";

// НОВЫЕ ИМПОРТЫ - интеграция с модульной retry архитектурой
import { ErrorType } from "./utils/error-handler";

// Интерфейс для APIStatusBar с поддержкой retry queue
interface APIStatusBarProps {
  flashcards: FlashcardNew[];
  retryQueue?: {
    queue: any[];
    stats: any;
    isProcessing: boolean;
  };
  onRetryProcessing?: () => Promise<any>;
}

// ОБНОВЛЕННЫЙ APIStatusBar с полной интеграцией retry queue
const APIStatusBar: React.FC<APIStatusBarProps> = ({
  flashcards,
  retryQueue,
  onRetryProcessing,
  error,
  processingProgress,
}) => {
  // Анализ карточек с ошибками (для обратной совместимости со старой системой)
  const cardsNeedingReprocessing = flashcards.filter(
    card => (card as any).needsReprocessing === true
  );

  // Приоритет отдаем retry queue если доступен, иначе fallback на старую логику
  const totalProblems = retryQueue ? retryQueue.queue.length : cardsNeedingReprocessing.length;
  // Показываем если есть проблемы ИЛИ есть ошибка
  if (totalProblems === 0 && !error) {
    return null; // Не показываем статус-бар если нет проблем
  }

  // Анализ типов ошибок из retry queue
  const problemTypes = retryQueue
    ? retryQueue.queue.map(item => item.errorInfo?.type).filter(Boolean)
    : [];

  const hasApiOverload = problemTypes.includes(ErrorType.API_OVERLOADED);
  const hasRateLimit = problemTypes.includes(ErrorType.RATE_LIMITED);
  const hasNetworkErrors =
    problemTypes.includes(ErrorType.NETWORK_ERROR) ||
    problemTypes.includes(ErrorType.PROXY_UNAVAILABLE);
  const hasAuthErrors =
    problemTypes.includes(ErrorType.AUTHENTICATION) ||
    problemTypes.includes(ErrorType.INSUFFICIENT_QUOTA);

  const getMessage = () => {
    if (hasAuthErrors) return "🔑 Проблемы с аутентификацией API";
    if (hasApiOverload) return "🔴 Claude API временно перегружен";
    if (hasRateLimit) return "🟡 Превышен лимит запросов";
    if (hasNetworkErrors) return "🌐 Проблемы с соединением";
    return `🔄 ${totalProblems} чанков требуют повторной обработки`;
  };

  const getRecommendation = () => {
    if (hasAuthErrors) return "Проверьте API ключ в настройках сервера";
    if (hasApiOverload) return "Обычно перегрузка длится 10-30 минут";
    if (hasRateLimit) return "Подождите несколько минут перед повторной попыткой";
    if (hasNetworkErrors) return "Проверьте интернет-соединение и запуск сервера";
    return 'Нажмите "Повторить" для обработки проблемных чанков';
  };

  const getStatusColor = () => {
    if (hasAuthErrors) return "#f44336"; // красный
    if (hasApiOverload) return "#ff5722"; // темно-оранжевый
    if (hasRateLimit) return "#ff9800"; // оранжевый
    if (hasNetworkErrors) return "#2196f3"; // синий
    return "#6A9BCC"; // основной цвет приложения
  };

  const isRetryDisabled = () => {
    // Блокируем retry при критических ошибках
    return hasAuthErrors || retryQueue?.isProcessing;
  };

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.15)",
        padding: "16px",
        borderRadius: "12px",
        margin: "16px 0",
        border: `2px solid ${getStatusColor()}`,
        backdropFilter: "blur(10px)",
      }}
    >
      {/* Основное сообщение об ошибке */}
      <div
        style={{
          marginBottom: "12px",
          fontSize: "16px",
          fontWeight: "bold",
          color: "white",
          fontFamily: "Noto Sans Display, sans-serif",
        }}
      >
        {getMessage()}
        {retryQueue?.isProcessing && (
          <span
            style={{
              marginLeft: "12px",
              color: "#4CAF50",
              fontSize: "14px",
            }}
          >
            🔄 Обработка...
          </span>
        )}
      </div>

      {/* Рекомендация пользователю */}
      <div
        style={{
          fontSize: "14px",
          opacity: 0.9,
          marginBottom: "12px",
          color: "white",
          fontFamily: "Noto Sans Display, sans-serif",
        }}
      >
        {getRecommendation()}
      </div>

      {/* Превью проблемных чанков из retry queue */}
      {retryQueue && retryQueue.queue.length > 0 && (
        <div
          style={{
            fontSize: "12px",
            marginBottom: "12px",
            background: "rgba(0,0,0,0.2)",
            padding: "8px",
            borderRadius: "6px",
          }}
        >
          <div
            style={{
              fontWeight: "bold",
              marginBottom: "6px",
              color: "white",
              fontFamily: "Noto Sans Display, sans-serif",
            }}
          >
            Проблемные чанки:
          </div>
          {retryQueue.queue.slice(0, 3).map((item, index) => (
            <div
              key={item.id}
              style={{
                marginLeft: "8px",
                opacity: 0.8,
                marginBottom: "4px",
                color: "white",
                fontFamily: "Noto Sans Display, sans-serif",
              }}
            >
              • {item.chunk.substring(0, 50)}...
              <span
                style={{
                  marginLeft: "8px",
                  fontSize: "11px",
                  opacity: 0.7,
                }}
              >
                ({item.errorInfo?.userMessage || "ошибка"})
              </span>
            </div>
          ))}
          {retryQueue.queue.length > 3 && (
            <div
              style={{
                marginLeft: "8px",
                opacity: 0.6,
                fontSize: "11px",
                color: "white",
                fontFamily: "Noto Sans Display, sans-serif",
              }}
            >
              ... и еще {retryQueue.queue.length - 3}
            </div>
          )}
        </div>
      )}

      {/* Статистика retry queue (если доступна) */}
      {retryQueue?.stats && (
        <div
          style={{
            fontSize: "12px",
            opacity: 0.7,
            marginBottom: "12px",
            color: "white",
            fontFamily: "Noto Sans Display, sans-serif",
          }}
        >
          Всего в очереди: {retryQueue.stats.totalItems} | Обработано: {retryQueue.stats.processed}{" "}
          | Неудачно: {retryQueue.stats.failed}
        </div>
      )}

      {/* Кнопки управления */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        {/* Основная кнопка retry */}
        <button
          onClick={onRetryProcessing}
          disabled={isRetryDisabled()}
          style={{
            background: isRetryDisabled() ? "#666" : "#4CAF50",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "6px",
            cursor: isRetryDisabled() ? "not-allowed" : "pointer",
            fontSize: "14px",
            fontWeight: "bold",
            transition: "all 0.2s ease",
            opacity: isRetryDisabled() ? 0.6 : 1,
            fontFamily: "Noto Sans Display, sans-serif",
          }}
          title={
            hasAuthErrors
              ? "Исправьте ошибки аутентификации"
              : retryQueue?.isProcessing
                ? "Обработка выполняется"
                : "Повторить обработку проблемных чанков"
          }
        >
          {retryQueue?.isProcessing
            ? "Обработка..."
            : hasAuthErrors
              ? "Исправьте настройки"
              : "Повторить обработку"}
        </button>

        {/* Дополнительная кнопка очистки очереди */}
        {retryQueue && retryQueue.queue.length > 0 && !retryQueue.isProcessing && (
          <button
            onClick={() => retryQueue.clearQueue?.()}
            style={{
              background: "transparent",
              color: "white",
              border: "1px solid rgba(255,255,255,0.3)",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
              transition: "all 0.2s ease",
              fontFamily: "Noto Sans Display, sans-serif",
            }}
            title="Очистить очередь retry"
          >
            Очистить очередь
          </button>
        )}
      </div>
    </div>
  );
};

// ГЛАВНЫЙ КОМПОНЕНТ ПРИЛОЖЕНИЯ
function App() {
  // Основные состояния приложения
  const [mode, setMode] = React.useState<AppMode>("text");
  const [inputText, setInputText] = React.useState("");

  // ОБНОВЛЕННАЯ интеграция с useProcessing - добавляем retry функциональность
  const {
    state,
    flashcards,
    translationText,
    processingProgress,
    formTranslations,
    processText,
    updateCard,
    toggleCardVisibility,
    deleteCard,
    addNewCard,
    clearAll,
    setFlashcards,
    setTranslationText,
    setState,
    setFormTranslations,
    // НОВЫЕ поля для retry
    processRetryQueue,
    retryQueue,
  } = useProcessing(inputText, setMode);

  // Интеграция клавиатурной навигации (существующая архитектура)
  useKeyboardNavigation(mode, setMode, flashcards, updateCard);

  // Интеграция файловых операций (существующая архитектура)
  const { exportData, importData } = useFileOperations({
    flashcards,
    inputText,
    translationText,
    formTranslations,
    onDataLoad: data => {
      setInputText(data.inputText);
      setFlashcards(data.flashcards as FlashcardNew[]);
      setTranslationText(data.translationText);

      // Восстанавливаем формы переводов если есть в данных
      if (data.formTranslations && Array.isArray(data.formTranslations)) {
        setFormTranslations(new Map(data.formTranslations));
      }

      setState("ready");
      setMode("flashcards");
    },
  });

  // НОВЫЙ обработчик retry с полным контролем процесса
  const [retryInProgress, setRetryInProgress] = React.useState(false);

  const handleRetryProcessing = React.useCallback(async () => {
    if (retryInProgress || !processRetryQueue) {
      console.warn("⚠️ Retry уже выполняется или processRetryQueue недоступен");
      return { processed: 0, successful: 0, failed: 0 };
    }

    try {
      setRetryInProgress(true);
      console.log("🚀 Начинаем retry обработку из App.tsx");

      // Функция для отслеживания прогресса retry
      const progressCallback = (current: number, total: number) => {
        console.log(`📊 Прогресс retry: ${current}/${total}`);
        // Можно добавить отображение прогресса в UI в будущем
      };

      const results = await processRetryQueue(progressCallback);

      console.log("🏁 Retry завершен:", results);

      if (results.successful > 0) {
        // Успешные обработки автоматически обновят карточки через ApiClient события
        console.log(`✅ Успешно обработано ${results.successful} из ${results.processed} чанков`);
      }

      return results;
    } catch (error) {
      console.error("❌ Ошибка при retry:", error);
      return { processed: 0, successful: 0, failed: 0 };
    } finally {
      setRetryInProgress(false);
    }
  }, [processRetryQueue, retryInProgress]);

  const [apiError, setApiError] = React.useState(null);

  // Добавьте useEffect для отслеживания ошибок:
  React.useEffect(() => {
    if (processingProgress.step.includes("🔴") || processingProgress.step.includes("Ошибка")) {
      setApiError(processingProgress.step);
    } else if (processingProgress.step === "ready") {
      setApiError(null);
    }
  }, [processingProgress.step]);

  return (
    <div
      className="min-h-screen p-8"
      style={{
        background: "linear-gradient(135deg, #6A9BCC 0%, #8BB6D6 50%, #A8C8E1 100%)",
      }}
    >
      {/* Заголовок приложения с импортом/экспортом */}
      <Header onImport={importData} onExport={exportData} isProcessed={flashcards.length > 0} />

      {/* Переключатель режимов */}
      <ModeSelector currentMode={mode} onModeChange={setMode} />

      {/* ОБНОВЛЕННЫЙ APIStatusBar с retry queue интеграцией */}
      <APIStatusBar
        flashcards={flashcards}
        retryQueue={retryQueue}
        onRetryProcessing={handleRetryProcessing}
      />
      {/* Основное содержимое - условный рендеринг по режимам */}
      {mode === "text" && (
        <TextInputView
          inputText={inputText}
          setInputText={setInputText}
          onProcessText={processText}
          state={state}
          processingProgress={processingProgress}
        />
      )}

      {mode === "flashcards" && (
        <FlashcardsView flashcards={flashcards.filter(card => card.visible)} />
      )}

      {mode === "reading" && (
        <ReadingView
          inputText={inputText}
          flashcards={flashcards.filter(card => card.visible)}
          formTranslations={formTranslations}
        />
      )}

      {mode === "translation" && <TranslationView translationText={translationText} />}

      {mode === "edit" && (
        <EditView
          flashcards={flashcards}
          onUpdateCard={updateCard}
          onToggleVisibility={toggleCardVisibility}
          onDeleteCard={deleteCard}
          onAddCard={addNewCard}
          onClearAll={clearAll}
        />
      )}

      {/* Футер с уведомлениями и отладочной информацией */}
      <Footer flashcards={flashcards} error={apiError} processingProgress={processingProgress} />
    </div>
  );
}

export default App;
