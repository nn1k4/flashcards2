import { ApiClient } from "./ApiClient";
import type { FlashcardNew } from "../types";
import { normalizeCards, mergeCardsByBaseForm, textToCards } from "../utils/cardUtils";
import { analyzeError } from "../utils/error-handler";

export async function processTextOffline({
  text,
  apiClient,
}: {
  text: string;
  apiClient: ApiClient;
}): Promise<{ flashcards: FlashcardNew[]; translationText: string }> {
  try {
    const raw = await apiClient.request(text, { chunkInfo: "offline" });
    const oldCards = textToCards(raw);
    const normalized = normalizeCards(oldCards, text);
    const merged = mergeCardsByBaseForm(normalized);

    const translations = new Set<string>();
    merged.forEach(card => {
      card.contexts.forEach(ctx => {
        const t = ctx.phrase_translation?.trim();
        if (t) translations.add(t);
      });
    });

    return {
      flashcards: merged,
      translationText: Array.from(translations).join(" "),
    };
  } catch (err) {
    const errorInfo = analyzeError(err);
    const errorCard: FlashcardNew = {
      base_form: errorInfo.userMessage,
      base_translation: errorInfo.recommendation,
      contexts: [
        {
          original_phrase: text,
          phrase_translation: errorInfo.recommendation,
          text_forms: [],
          word_form_translations: [],
        },
      ],
      visible: true,
    };
    return { flashcards: [errorCard], translationText: "" };
  }
}
