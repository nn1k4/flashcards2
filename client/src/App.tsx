// client/src/App.tsx
import React from "react";
import type { AppMode, Card, Context } from "./types";

// Импорт всех UI компонентов (существующая архитектура)
import Header from "./components/Header";
import ModeSelector from "./components/ModeSelector";
import Footer from "./components/Footer";
import TextInputView from "./components/TextInputView";
import FlashcardsView from "./components/FlashcardsView";
import ReadingView from "./components/ReadingView";
import TranslationView from "./components/TranslationView";
import EditView from "./components/EditView";
import BatchResultRetriever from "./components/BatchResultRetriever";
import { saveFormTranslations } from "./utils/cardUtils";

// Импорт всех кастомных хуков (существующая архитектура)
import { useProcessing } from "./hooks/useProcessing";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useFileOperations } from "./hooks/useFileOperations";

// НОВЫЕ ИМПОРТЫ - интеграция с модульной retry архитектурой
import { ErrorType } from "./utils/error-handler";
import type { QueueItem, RetryQueueStats } from "./hooks/useRetryQueue";

// ================== ЛОКАЛЬНЫЕ ХЕЛПЕРЫ ДЛЯ ИНТЕГРАЦИИ НОВОЙ СХЕМЫ ==================
// Нормализация токена для сравнения/ключей
const cleanToken = (s: string) =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()\[\]"'`«»]/g, "");

// Построение Map переводов форм из НОВОЙ и СТАРОЙ структур карточек
function deriveFormTranslations(cards: any[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const card of cards || []) {
    const contexts = Array.isArray(card?.contexts) ? card.contexts : [];

    for (const ctx of contexts) {
      // Новая схема: contexts[].forms[] с { form, translation }
      if (Array.isArray(ctx?.forms) && ctx.forms.length > 0) {
        for (const f of ctx.forms) {
          const form = cleanToken(f?.form || "");
          const tr = (f?.translation || "").toString().trim();
          if (form && tr && !map.has(form)) map.set(form, tr);
        }
      }

      // Старая схема: contexts[].text_forms[] + word_form_translations[]
      if (Array.isArray(ctx?.text_forms) && ctx.text_forms.length > 0) {
        const wfts = Array.isArray(ctx?.word_form_translations) ? ctx.word_form_translations : [];
        ctx.text_forms.forEach((t: string, i: number) => {
          const key = cleanToken(t);
          const tr = (wfts[i] || wfts[0] || "").toString().trim();
          if (key && tr && !map.has(key)) map.set(key, tr);
        });
      }
    }
  }

  return map;
}

// ================== API Status Bar (оставляем совместимость) ==================
interface APIStatusBarProps {
  flashcards: Card[];
  retryQueue?: {
    queue: QueueItem[];
    stats: RetryQueueStats;
    isProcessing: boolean;
    clearQueue?: () => void;
  };
  onRetryProcessing?: () => Promise<{ processed: number; successful: number; failed: number }>;
  error?: string | null;
}

// ОБНОВЛЕННЫЙ APIStatusBar с полной интеграцией retry queue
const APIStatusBar: React.FC<APIStatusBarProps> = ({
  flashcards,
  retryQueue,
  onRetryProcessing,
  error,
}) => {
  // Анализ карточек с ошибками (сохраняем обратную совместимость: поле может существовать)
  const cardsNeedingReprocessing = flashcards.filter(
    (card: any) => card?.needsReprocessing === true
  );

  // Приоритет отдаем retry queue если доступен, иначе fallback на старую логику
  const totalProblems = retryQueue ? retryQueue.queue.length : cardsNeedingReprocessing.length;

  // Показываем если есть проблемы ИЛИ есть ошибка
  if (totalProblems === 0 && !error) return null;

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
      data-testid="api-status-bar"
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
          {retryQueue.queue.slice(0, 3).map(item => (
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
            problemTypes.includes(ErrorType.AUTHENTICATION)
              ? "Исправьте ошибки аутентификации"
              : retryQueue?.isProcessing
                ? "Обработка выполняется"
                : "Повторить обработку проблемных чанков"
          }
        >
          {retryQueue?.isProcessing
            ? "Обработка..."
            : problemTypes.includes(ErrorType.AUTHENTICATION)
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

// ================== ГЛАВНЫЙ КОМПОНЕНТ ПРИЛОЖЕНИЯ ==================
function App() {
  // Основные состояния приложения
  const [mode, setMode] = React.useState<AppMode>("text");
  const [inputText, setInputText] = React.useState("");

  // Локальные состояния навигации по карточкам
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);

  // ОБНОВЛЕННАЯ интеграция с useProcessing — теперь flashcards: Card[]
  const {
    state,
    flashcards, // ← Card[]
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
    // retry + batch
    processRetryQueue,
    retryQueue,
    isBatchEnabled,
    setBatchEnabled,
    batchId,
    batchError,
  } = useProcessing(inputText, setMode, setInputText, setCurrentIndex, setFlipped);

  // Колбэки для навигации по карточкам
  const handleIndexChange = React.useCallback((idx: number) => setCurrentIndex(idx), []);
  const handleFlip = React.useCallback((value: boolean) => setFlipped(value), []);

  const handleHideCard = React.useCallback(() => {
    const visible = flashcards.map((c, i) => ({ c, i })).filter(({ c }) => c.visible !== false);
    const item = visible[Math.min(currentIndex, Math.max(visible.length - 1, 0))];
    if (item) toggleCardVisibility(item.i);
  }, [flashcards, currentIndex, toggleCardVisibility]);

  // Полная очистка данных вместе с retry queue
  const handleClearWithRetry = React.useCallback(() => {
    clearAll();
    setCurrentIndex(0);
    setFlipped(false);
    setMode("text");
  }, [clearAll, setMode]);

  // Интеграция клавиатурной навигации
  useKeyboardNavigation({
    mode,
    state,
    flashcards, // Card[]
    currentIndex,
    flipped,
    onIndexChange: handleIndexChange,
    onFlip: handleFlip,
    onHideCard: handleHideCard,
  });

  // Интеграция файловых операций (существующая архитектура)
  const { exportData, importData } = useFileOperations({
    flashcards, // Card[]
    inputText,
    translationText,
    formTranslations,
    onDataLoad: data => {
      setInputText(data.inputText);

      // Восстанавливаем карточки как Card[]
      setFlashcards(data.flashcards as Card[]);

      // Восстанавливаем перевод
      setTranslationText(data.translationText);

      // Восстанавливаем Map переводов форм
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

      const progressCallback = (current: number, total: number) => {
        console.log(`📊 Прогресс retry: ${current}/${total}`);
      };

      const results = await processRetryQueue(progressCallback);
      console.log("🏁 Retry завершен:", results);

      if (results.successful > 0) {
        console.log(`✅ Успешно обработано ${results.successful} из ${results.processed} чанков`);
      }

      setCurrentIndex(0);
      setFlipped(false);
      setMode("flashcards");

      return results;
    } catch (error) {
      console.error("❌ Ошибка при retry:", error);
      return { processed: 0, successful: 0, failed: 0 };
    } finally {
      setRetryInProgress(false);
    }
  }, [processRetryQueue, retryInProgress, setCurrentIndex, setFlipped, setMode]);

  // Типизируем состояние: строка или null
  const [apiError, setApiError] = React.useState<string | null>(null);

  // Следим за progress и состоянием очереди retry
  React.useEffect(() => {
    const step = (processingProgress.step || "").trim();
    const hasExplicitError =
      step.includes("Ошибка") ||
      step.toLowerCase().includes("error") ||
      step.startsWith("🔴") ||
      step.startsWith("🌐");
    const hasProblems = retryQueue?.queue?.length > 0;

    if (hasExplicitError || hasProblems) {
      setApiError(step || "error");
    } else if (step === "ready" || step === "") {
      setApiError(null);
    }
  }, [processingProgress.step, retryQueue?.queue]);

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
      <ModeSelector
        mode={mode}
        onChange={setMode}
        onClear={handleClearWithRetry}
        isProcessed={flashcards.length > 0}
      />

      {/* ОБНОВЛЕННЫЙ APIStatusBar с retry queue интеграцией */}
      <APIStatusBar
        flashcards={flashcards}
        retryQueue={retryQueue}
        onRetryProcessing={handleRetryProcessing}
        error={apiError}
      />

      {/* Основное содержимое - условный рендеринг по режимам */}
      {mode === "text" && (
        <>
          <TextInputView
            inputText={inputText}
            setInputText={setInputText}
            onProcessText={processText}
            state={state}
            processingProgress={processingProgress}
            isBatchEnabled={isBatchEnabled}
            setBatchEnabled={setBatchEnabled}
            batchId={batchId}
            batchError={batchError}
          />

          <BatchResultRetriever
            onResults={(cards: any[]) => {
              console.log("🐞 [App] raw cards:", cards);
              console.log("🐞 [App] first card sample:", cards?.[0]);

              // 📌 Собираем исходный текст и перевод из контекстов (поддержка новой/старой схемы)
              const rebuiltText = Array.from(
                new Set(
                  cards.flatMap((card: any) =>
                    (card?.contexts || [])
                      .map((ctx: any) =>
                        (ctx?.latvian || ctx?.original_phrase || "").toString().trim()
                      )
                      .filter(Boolean)
                  )
                )
              ).join(" ");

              const rebuiltTranslation = Array.from(
                new Set(
                  cards.flatMap((card: any) =>
                    (card?.contexts || [])
                      .map((ctx: any) =>
                        (ctx?.russian || ctx?.phrase_translation || "").toString().trim()
                      )
                      .filter(Boolean)
                  )
                )
              ).join(" ");

              // 📌 Строим Map переводов форм (новая схема) с фолбэком на старую
              const derivedForms = deriveFormTranslations(cards);

              // 🎯 Если по каким-то причинам пришла старая структура (FlashcardOld[]),
              // поддерживаем прежний механизм сохранения:
              const rebuiltFormTranslations =
                derivedForms.size > 0
                  ? derivedForms
                  : saveFormTranslations(cards as any, new Map());

              console.log("✅ [App] rebuiltText:", rebuiltText);
              console.log("✅ [App] rebuiltTranslation:", rebuiltTranslation);

              setInputText(rebuiltText);
              setTranslationText(rebuiltTranslation);
              setFormTranslations(rebuiltFormTranslations);

              // Сохраняем карточки как Card[]
              setFlashcards(cards as Card[]);
              setState("ready");
              setMode("flashcards");
            }}
            setInputText={setInputText}
            setTranslationText={setTranslationText}
            setFormTranslations={setFormTranslations}
          />
        </>
      )}

      {mode === "flashcards" && (
        <FlashcardsView
          // ВАЖНО: у фильтра остаётся та же логика
          flashcards={flashcards.filter(card => card.visible) as unknown as any[]}
          currentIndex={currentIndex}
          flipped={flipped}
          onIndexChange={handleIndexChange}
          onFlip={handleFlip}
          onHideCard={handleHideCard}
        />
      )}

      {mode === "reading" && (
        <ReadingView
          inputText={inputText}
          // Временный каст для совместимости с сигнатурой пропсов компонента
          flashcards={flashcards.filter(card => card.visible) as unknown as any[]}
          formTranslations={formTranslations}
        />
      )}

      {mode === "translation" && <TranslationView translationText={translationText} />}

      {mode === "edit" && (
        <EditView
          // Временный каст для совместимости с сигнатурой пропсов компонента
          flashcards={flashcards as unknown as any[]}
          onCardUpdate={updateCard}
          onToggleVisibility={toggleCardVisibility}
          onDeleteCard={deleteCard}
          onAddCard={addNewCard}
          onClearAll={clearAll}
        />
      )}

      {/* TODO: Footer пока не используется для ошибок, все сообщения идут через APIStatusBar */}
      <Footer
        flashcards={flashcards as any[]}
        error={apiError || undefined}
        processingProgress={processingProgress}
      />
    </div>
  );
}

export default App;
