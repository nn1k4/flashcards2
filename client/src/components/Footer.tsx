import React from "react";
import type { BaseComponentProps } from "../types";

// Интерфейс пропсов для Footer компонента
interface FooterProps extends BaseComponentProps {
  step: string; // текущий шаг обработки или ошибка
  showDebug?: boolean; // показывать ли отладочную информацию
}

// Компонент футера с уведомлениями об ошибках API и состоянии сервера
export const Footer: React.FC<FooterProps> = ({
  step,
  showDebug = false,
  className = "",
  "data-testid": testId,
}) => {
  // Определяем типы ошибок для отображения соответствующих сообщений
  // Безопасная проверка step на undefined перед использованием includes()
  const safeStep = step || "";
  const isOverloaded =
    safeStep === "Overloaded" || safeStep.includes("529") || safeStep.includes("Overloaded");
  const isCreditBalance = safeStep === "credit balance" || safeStep.includes("credit balance");
  const isNoConnection = safeStep === "no connection" || !navigator.onLine;
  const isGeneralError =
    safeStep === "error" && !isOverloaded && !isCreditBalance && !isNoConnection;

  // Если нет ошибок и отладка выключена, не показываем футер
  const hasErrors = isOverloaded || isCreditBalance || isNoConnection || isGeneralError;
  if (!hasErrors && !showDebug) {
    return null;
  }

  return (
    <div className={`mt-4 ${className}`} data-testid={testId}>
      {/* Отладочная информация (только в режиме разработки) */}
      {showDebug && (
        <div
          className="mt-2 text-gray-500 text-sm text-center"
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
        >
          DEBUG шаг: &quot;{step}&quot;
        </div>
      )}

      {/* Уведомления об ошибках */}
      {hasErrors && (
        <footer
          className="mt-4 text-sm text-red-600 text-center max-w-2xl mx-auto"
          style={{ fontFamily: "Noto Sans Display, sans-serif" }}
        >
          {/* Ошибка перегрузки сервера */}
          {isOverloaded && (
            <div className="p-3 bg-red-50 rounded-lg border border-red-200">
              <div className="flex items-center justify-center space-x-2">
                <span className="text-red-500">⚠️</span>
                <span className="font-medium">
                  Сервер перегружен. Пожалуйста, попробуйте позже.
                </span>
              </div>
              <div className="text-xs text-red-400 mt-1">
                Claude API временно недоступен (ошибка 529)
              </div>
            </div>
          )}

          {/* Ошибка низкого баланса */}
          {isCreditBalance && (
            <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
              <div className="flex items-center justify-center space-x-2">
                <span className="text-yellow-500">💳</span>
                <span className="font-medium text-yellow-700">
                  Баланс на API Claude исчерпан. Пожалуйста, пополните или обновите план.
                </span>
              </div>
              <div className="text-xs text-yellow-600 mt-1">
                Перейдите в Plans & Billing для пополнения баланса
              </div>
            </div>
          )}

          {/* Ошибка отсутствия интернет-соединения */}
          {isNoConnection && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-center space-x-2">
                <span className="text-gray-500">🌐</span>
                <span className="font-medium text-gray-700">
                  Нет соединения с интернетом. Проверьте подключение и перезапустите.
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Убедитесь, что интернет работает и повторите попытку
              </div>
            </div>
          )}

          {/* Общая ошибка */}
          {isGeneralError && (
            <div className="p-3 bg-red-50 rounded-lg border border-red-200">
              <div className="flex items-center justify-center space-x-2">
                <span className="text-red-500">❌</span>
                <span className="font-medium">
                  Произошла ошибка при обработке текста. Попробуйте еще раз.
                </span>
              </div>
              <div className="text-xs text-red-400 mt-1">
                Если проблема повторяется, проверьте текст и соединение
              </div>
            </div>
          )}
        </footer>
      )}
    </div>
  );
};

// Экспорт по умолчанию для удобства
export default Footer;
