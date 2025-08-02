import React from "react";
import { fetchBatchResults } from "../claude-batch";

const BatchResultRetriever: React.FC = () => {
  const [batchId, setBatchId] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = React.useState<string>("");

  const handleFetch = async () => {
    if (!batchId.trim()) return;
    setStatus("loading");
    try {
      const outputs = await fetchBatchResults(batchId.trim());
      setResult(outputs.join("\n"));
      setStatus("done");
    } catch (e) {
      console.error(e);
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
      {status === "done" && (
        <div className="mt-4">
          <textarea
            className="w-full h-40 border rounded p-2 text-gray-900"
            value={result}
            readOnly
          />
          <button
            onClick={() => {
              const blob = new Blob([result], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `batch_${batchId}.json`;
              a.click();
            }}
            className="mt-2 px-4 py-2 bg-gray-700 text-white rounded"
          >
            Экспортировать
          </button>
        </div>
      )}
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
