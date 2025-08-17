// client/src/components/BatchResultRetriever.tsx
import React from "react";
import { fetchBatchResults } from "../claude-batch";
import type { FlashcardNew, AppState } from "../types";
import { saveFormTranslations } from "../utils/cardUtils";

/* =============================================================================
 * Типы
 * ============================================================================= */

interface BatchResultRetrieverProps {
  onResults?: (cards: FlashcardNew[]) => void;
  setInputText?: (text: string) => void;
  setTranslationText?: (text: string) => void;
  setFormTranslations?: (map: Map<string, string>) => void;
  setState?: (state: AppState) => void;
}

type AnyPayload =
  | FlashcardNew[]
  | {
      rawCards?: FlashcardNew[];
      mergedCards?: FlashcardNew[];
      cards?: FlashcardNew[];
      flashcards?: FlashcardNew[];
      data?: any;
      result?: any;
    }
  | unknown;

/* =============================================================================
 * Нормализация и хелперы
 * ============================================================================= */

const ensureVisible = (cards: FlashcardNew[]): FlashcardNew[] =>
  (cards || []).map(c => ({ ...c, visible: c.visible !== false }));

const norm = (s: string) =>
  (s ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[«»“”"(){}\[\]—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normKey = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/[.?!…:;]+$/u, "")
    .trim();

const ensureSentenceEnding = (s: string) => (/[.?!…]$/.test(s) ? s : s + ".");

/** Ключ сопоставления предложения (для map’ов) */
const keyForMatch = (s: string) =>
  (s ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.?!…:;]+$/u, "")
    .trim();

/** Частотный выбор канонической строки; при равенстве — более длинная. */
const pickCanonical = (variants: string[], addDot = false): string | "" => {
  const freq = new Map<string, { count: number; original: string }>();
  for (const r of variants || []) {
    const k = normKey(r);
    if (!k) continue;
    const hit = freq.get(k);
    if (hit) {
      hit.count++;
      if (r.length > hit.original.length) hit.original = r;
    } else {
      freq.set(k, { count: 1, original: r });
    }
  }
  if (freq.size === 0) return "";
  let best: { count: number; original: string } | null = null;
  for (const v of freq.values()) {
    if (
      !best ||
      v.count > best.count ||
      (v.count === best.count && v.original.length > best.original.length)
    ) {
      best = { count: v.count, original: v.original };
    }
  }
  const out = best ? best.original : "";
  return out ? (addDot ? ensureSentenceEnding(out) : out) : "";
};

/** Дублируем поля latvian/russian ⇄ original_phrase/phrase_translation для совместимости */
const ensureCtxFields = (cards: FlashcardNew[]) =>
  (cards || []).map(card => {
    const ctxs = Array.isArray(card?.contexts) ? (card.contexts as any[]) : [];
    const patched = ctxs.map(ctx => {
      const lv = ctx.latvian ?? ctx.original_phrase ?? "";
      const ru = ctx.russian ?? ctx.phrase_translation ?? "";
      return {
        ...ctx,
        latvian: lv,
        original_phrase: lv,
        russian: ru,
        phrase_translation: ru,
      };
    });
    return { ...(card as any), contexts: patched } as FlashcardNew;
  });

/* =============================================================================
 * Работа с порядком: «appearance-first, sid-second»
 * ============================================================================= */

/** Собираем карту LV→минимальный sid (если sid присутствует и валиден) */
const buildSidMapFromCards = (cards: FlashcardNew[]) => {
  const map = new Map<string, number>();
  for (const c of cards || []) {
    const ctxs = Array.isArray(c?.contexts) ? (c.contexts as any[]) : [];
    for (const ctx of ctxs) {
      const hasSid = Number.isFinite(ctx?.sid) && Number(ctx.sid) >= 0;
      const lv = ctx.latvian ?? ctx.original_phrase ?? "";
      const k = keyForMatch(lv);
      if (!k) continue;
      if (hasSid) {
        const sid = Number(ctx.sid);
        if (!map.has(k) || sid < (map.get(k) as number)) {
          map.set(k, sid);
        }
      }
    }
  }
  return map;
};

/** Проставляем sid там, где его нет, используя LV→sid */
const patchCardsWithSidByMap = (cards: FlashcardNew[], sidMap: Map<string, number>) =>
  (cards || []).map(card => {
    const ctxs = Array.isArray(card?.contexts) ? (card.contexts as any[]) : [];
    const patched = ctxs.map(ctx => {
      const hasSid = Number.isFinite(ctx?.sid) && Number(ctx.sid) >= 0;
      if (hasSid) return ctx;
      const lv = ctx.latvian ?? ctx.original_phrase ?? "";
      const k = keyForMatch(lv);
      const found = k ? sidMap.get(k) : undefined;
      return Number.isFinite(found) ? { ...ctx, sid: found } : ctx;
    });
    return { ...(card as any), contexts: patched } as FlashcardNew;
  });

/** Строим глобальный порядок по первому появлению LV в rawCards (по порядку массива). */
const buildAppearanceOrder = (cards: FlashcardNew[]) => {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const c of cards || []) {
    const ctxs = Array.isArray(c?.contexts) ? (c.contexts as any[]) : [];
    for (const ctx of ctxs) {
      const lv = norm(ctx.latvian ?? ctx.original_phrase ?? "");
      const k = normKey(lv);
      if (k && !seen.has(k)) {
        seen.add(k);
        order.push(k);
      }
    }
  }
  return order;
};

/** Восстанавливаем LV/RU по *appearance order*, тай-брейкер — минимальный sid */
const buildTextsAppearanceFirst = (cards: FlashcardNew[]) => {
  type Cell = { lv: string[]; ru: string[]; minSid: number | null; firstIndex: number };
  const byKey = new Map<string, Cell>();
  const order = buildAppearanceOrder(cards);

  // Заполняем коллекции по ключу
  let idx = 0;
  for (const c of cards || []) {
    const ctxs = Array.isArray(c?.contexts) ? (c.contexts as any[]) : [];
    for (const ctx of ctxs) {
      const lv = norm(ctx.latvian ?? ctx.original_phrase ?? "");
      const ru = norm(ctx.russian ?? ctx.phrase_translation ?? "");
      if (!lv && !ru) continue;
      const k = normKey(lv);
      if (!k) continue;
      const sid = Number.isFinite(ctx?.sid) && Number(ctx.sid) >= 0 ? Number(ctx.sid) : null;

      const cell = byKey.get(k) || {
        lv: [],
        ru: [],
        minSid: sid,
        firstIndex: order.indexOf(k), // первый индекс появления
      };
      if (lv) cell.lv.push(lv);
      if (ru) cell.ru.push(ru);
      if (sid !== null) {
        cell.minSid = cell.minSid === null ? sid : Math.min(cell.minSid as number, sid);
      }
      byKey.set(k, cell);
      idx++;
    }
  }

  // Сортируем ключи по appearance order, при равенстве — по minSid, затем лексикографически.
  const keys = Array.from(byKey.keys());
  keys.sort((a, b) => {
    const ca = byKey.get(a)!;
    const cb = byKey.get(b)!;
    if (ca.firstIndex !== cb.firstIndex) return ca.firstIndex - cb.firstIndex;
    const sa = ca.minSid ?? Number.POSITIVE_INFINITY;
    const sb = cb.minSid ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });

  const lvParts: string[] = [];
  const ruParts: string[] = [];
  for (const k of keys) {
    const cell = byKey.get(k)!;
    const lvCanon = pickCanonical(cell.lv, false);
    const ruCanon = pickCanonical(cell.ru, true);
    if (lvCanon) lvParts.push(lvCanon);
    if (ruCanon) ruParts.push(ruCanon);
  }

  return {
    lvText: lvParts.join(" "),
    ruText: ruParts.join(" "),
  };
};

/* =============================================================================
 * Разбор payload из fetchBatchResults
 * ============================================================================= */

function parsePayload(payload: AnyPayload) {
  let raw: FlashcardNew[] | null = null;
  let merged: FlashcardNew[] | null = null;

  const take = (x: any): FlashcardNew[] | null => (Array.isArray(x) ? (x as FlashcardNew[]) : null);

  if (Array.isArray(payload)) {
    raw = payload as FlashcardNew[];
  } else if (payload && typeof payload === "object") {
    const obj: any = payload;
    raw = take(obj.rawCards) ?? take(obj.cards) ?? take(obj.flashcards) ?? null;
    merged = take(obj.mergedCards) ?? null;

    if (!raw && obj?.data) {
      raw = take(obj.data.rawCards) ?? take(obj.data.cards) ?? take(obj.data.flashcards) ?? null;
      merged = merged ?? take(obj.data.mergedCards);
    }
    if (!raw && obj?.result) {
      raw =
        take(obj.result.rawCards) ?? take(obj.result.cards) ?? take(obj.result.flashcards) ?? null;
      merged = merged ?? take(obj.result.mergedCards);
    }
  }

  return {
    forOrder: raw ?? merged ?? [],
    forDisplay: merged ?? raw ?? [],
    debugShape:
      payload && typeof payload === "object"
        ? `object keys: ${Object.keys(payload as any).join(", ")}`
        : `type: ${typeof payload}`,
  };
}

/* =============================================================================
 * Компонент
 * ============================================================================= */

const BatchResultRetriever: React.FC<BatchResultRetrieverProps> = ({
  onResults,
  setInputText,
  setTranslationText,
  setFormTranslations,
  setState,
}) => {
  const [batchId, setBatchId] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [debugShape, setDebugShape] = React.useState<string | null>(null);

  const handleFetch = async () => {
    setStatus("loading");
    setErrorMsg(null);
    setDebugShape(null);

    try {
      const id = batchId.trim();
      if (!id) {
        setStatus("idle");
        return;
      }

      const payload = (await fetchBatchResults(id)) as AnyPayload;
      const { forOrder, forDisplay, debugShape } = parsePayload(payload);
      setDebugShape(debugShape);

      // 1) видимость + выравнивание полей контекста
      const orderCards = ensureCtxFields(ensureVisible(forOrder));
      const displayCards = ensureCtxFields(ensureVisible(forDisplay));

      // 2) строим карту LV→minSid по raw
      const sidMap = buildSidMapFromCards(orderCards);

      // 3) патчим merged сид-ами, чтобы и внешняя пересборка по sid шла корректно
      const uiCards = patchCardsWithSidByMap(displayCards, sidMap);

      // 4) тексты — строго по порядку появления в raw (sid — тай-брейкер)
      const { lvText, ruText } = buildTextsAppearanceFirst(orderCards);

      // 5) формы — из raw
      const formsMap = saveFormTranslations(orderCards as any, new Map<string, string>());

      // 6) проброс в приложение
      setInputText?.(lvText);
      setTranslationText?.(ruText);
      setFormTranslations?.(formsMap);
      onResults?.(uiCards);
      setState?.("ready");

      // 7) история
      try {
        const history = JSON.parse(localStorage.getItem("batchHistory") || "[]");
        const next = Array.isArray(history) ? history : [];
        if (!next.includes(id)) next.unshift(id);
        localStorage.setItem("batchHistory", JSON.stringify(next.slice(0, 20)));
      } catch {
        /* noop */
      }

      setStatus("done");
    } catch (e: any) {
      console.error("Ошибка парсинга batch ответа:", e);
      setErrorMsg(String(e?.message || e));
      setStatus("error");
    }
  };

  const history: string[] = React.useMemo(() => {
    try {
      const raw = localStorage.getItem("batchHistory") || "[]";
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
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

      {status === "error" && (
        <div className="text-red-600 mt-4 text-sm">
          <p>Ошибка загрузки batch: {errorMsg || "Неизвестная ошибка"}</p>
          {debugShape && <p className="opacity-80 mt-1">Форма ответа: {debugShape}</p>}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <h4 className="font-medium mb-2">История:</h4>
          <ul className="text-sm text-gray-700">
            {history.map(id => (
              <li
                key={id}
                className="cursor-pointer underline"
                onClick={() => setBatchId(id)}
                title="Подставить этот batch_id"
              >
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
