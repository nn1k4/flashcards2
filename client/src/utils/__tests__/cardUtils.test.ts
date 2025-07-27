import {
  normalizeCards,
  mergeCardsByBaseForm,
  saveFormTranslations,
  findTranslationForText,
} from "../cardUtils";
import type { FlashcardOld, FlashcardNew } from "../../types";

describe("normalizeCards", () => {
  it("retains phrase_translation when present", () => {
    const cards: FlashcardOld[] = [
      {
        front: "skrien",
        back: "runs",
        word_form_translation: "runs",
        base_form: "skriet",
        base_translation: "to run",
        original_phrase: "Viņš skrien",
        phrase_translation: "He runs",
        text_forms: ["skrien"],
        visible: true,
      },
    ];

    const normalized = normalizeCards(cards, "Viņš skrien");
    expect(normalized[0].phrase_translation).toBe("He runs");
  });
});

describe("mergeCardsByBaseForm", () => {
  it("merges contexts and propagates needsReprocessing", () => {
    const card1: FlashcardOld = {
      front: "skrien",
      back: "runs",
      word_form_translation: "runs",
      base_form: "skriet",
      base_translation: "to run",
      original_phrase: "Viņš skrien",
      phrase_translation: "He runs",
      text_forms: ["skrien"],
      visible: true,
    };

    const card2: FlashcardOld & { needsReprocessing?: boolean } = {
      front: "skrēja",
      back: "ran",
      word_form_translation: "ran",
      base_form: "skriet",
      base_translation: "to run",
      original_phrase: "Viņš skrēja vakar",
      phrase_translation: "He ran yesterday",
      text_forms: ["skrēja"],
      visible: true,
      needsReprocessing: true,
    };

    const merged = mergeCardsByBaseForm([card1, card2]);
    expect(merged).toHaveLength(1);
    expect(merged[0].contexts).toHaveLength(2);
    const phrases = merged[0].contexts.map(c => c.original_phrase);
    expect(phrases).toEqual(expect.arrayContaining(["Viņš skrien", "Viņš skrēja vakar"]));
    const mergedCard = merged[0] as FlashcardNew & {
      needsReprocessing?: boolean;
    };
    expect(mergedCard.needsReprocessing).toBe(true);
  });
});

describe("saveFormTranslations", () => {
  it("uses word_form_translation", () => {
    const card: FlashcardOld = {
      front: "skrien",
      back: "should not use",
      word_form_translation: "бежит",
      base_form: "skriet",
      base_translation: "бежать",
      original_phrase: "Viņš skrien",
      phrase_translation: "Он бежит",
      text_forms: ["skrien"],
      visible: true,
    };

    const map = saveFormTranslations([card], new Map());
    expect(map.get("skrien")).toBe("бежит");
  });
});

describe("findTranslationForText", () => {
  it("returns form translations before base translations", () => {
    const card: FlashcardNew = {
      base_form: "skriet",
      base_translation: "to run",
      contexts: [
        {
          original_phrase: "Viņš skrien",
          phrase_translation: "He runs",
          text_forms: ["skrien"],
          word_form_translations: ["runs"],
        },
      ],
      visible: true,
    };

    const result = findTranslationForText("skrien", [card], "Viņš skrien");
    expect(result).not.toBeNull();
    expect(result?.textForm).toBe("skrien");
    expect(result?.contextTranslation).toBe("He runs");
  });
});
