import React from "react";
import { fetchBatchResults } from "../claude-batch";
import type { FlashcardNew } from "../types";
import { saveFormTranslations } from "../utils/cardUtils";
import type { AppState } from "../types";

interface BatchResultRetrieverProps {
  onResults?: (cards: FlashcardNew[]) => void;
  setInputText?: (text: string) => void;
  setTranslationText?: (text: string) => void;
  setFormTranslations?: (map: Map<string, string>) => void;
  setState?: (state: AppState) => void; // ← ДОБАВЬ ЭТУ СТРОКУ
}

const BatchResultRetriever: React.FC<BatchResultRetrieverProps> = ({
  onResults,
  setInputText,
  setTranslationText,
  setFormTranslations, // 🔧 ← вот этого не хватает
  setState, // ← ДОБАВЬ ЗДЕСЬ
}) => {
  const [batchId, setBatchId] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "done" | "error">("idle");

  const handleFetch = async () => {
    if (!batchId.trim()) return;
    setStatus("loading");
    try {
      const cards: FlashcardNew[] = await fetchBatchResults(batchId.trim());

      // Явно устанавливаем visible = true (если не false)
      const fixedCards = cards.map(c => ({ ...c, visible: c.visible !== false }));

      // Восстанавливаем текст для режима чтения
      const combinedInputText = fixedCards
        .map(c => c.contexts?.map(ctx => ctx.original_phrase || "").join(" "))
        .join(" ")
        .trim();

      // Восстанавливаем текст для режима перевода
      const combinedTranslationText = fixedCards
        .map(c => c.contexts?.map(ctx => ctx.phrase_translation || "").join(" "))
        .join(" ")
        .trim();

      // Устанавливаем состояния (если переданы)
      setInputText?.(combinedInputText);
      setTranslationText?.(combinedTranslationText);
      setFormTranslations?.(saveFormTranslations(fixedCards, new Map()));

      // Основной результат (карточки)
      onResults?.(fixedCards);

      // ⬅️ Критически важно для активации UI
      setState?.("ready");

      setStatus("done");
    } catch (e) {
      console.error("Ошибка парсинга batch ответа:", e);
      setStatus("error");
    }
  };

  const history: string[] = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("batchHistory") || "[]");
    } catch {
      return [];
    }
  }, [status]);

  return (
    <div
      className="mt-8 bg-white rounded-3xl p-6 shadow"
      style={{ fontFamily: "Noto Sans Display, sans-serif" }}
    >
      <h3 className="text-lg font-medium mb-4">Получить результаты batch</h3>
      <input
        value={batchId}
        onChange={e => setBatchId(e.target.value)}
        placeholder="Вставьте batch_id"
        className="w-full border rounded p-2 mb-4 text-gray-900"
      />
      <button
        onClick={handleFetch}
        disabled={status === "loading"}
        className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:bg-gray-300"
      >
        {status === "loading" ? "Загрузка..." : "Загрузить"}
      </button>

      {status === "error" && <p className="text-red-500 mt-4">Ошибка загрузки batch</p>}
      {history.length > 0 && (
        <div className="mt-6">
          <h4 className="font-medium mb-2">История:</h4>
          <ul className="text-sm text-gray-700">
            {history.map(id => (
              <li key={id} className="cursor-pointer underline" onClick={() => setBatchId(id)}>
                {id}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default BatchResultRetriever;
