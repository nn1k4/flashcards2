/** @jest-environment node */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { processTextOffline } from "../ProcessingService";
import { ApiClient } from "../ApiClient";

const server = setupServer();

jest.setTimeout(20000);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const apiClient = new ApiClient({ maxRetries: 2, enableEvents: false });

const sampleResponse = {
  flashcards: [
    {
      front: "pamostas",
      back: "просыпается",
      word_form_translation: "встает",
      base_form: "pamosties",
      base_translation: "вставать",
      original_phrase: "Anna pamostas agri.",
      phrase_translation: "Анна встает рано.",
      text_forms: ["pamostas"],
      visible: true,
    },
    {
      front: "dzimšanas diena",
      back: "день рождения",
      word_form_translation: "день рождения",
      base_form: "dzimšanas diena",
      base_translation: "день рождения",
      original_phrase: "Šodien ir viņas mātes dzimšanas diena.",
      phrase_translation: "Сегодня день рождения ее матери.",
      text_forms: ["dzimšanas", "diena"],
      visible: true,
    },
  ],
};

const inputText = "Anna pamostas agri. Šodien ir viņas mātes dzimšanas diena.";

describe("ProcessingService", () => {
  it("parses successful response", async () => {
    server.use(
      http.post("*", () => {
        return HttpResponse.json({
          content: [{ type: "text", text: JSON.stringify(sampleResponse) }],
        });
      })
    );

    const result = await processTextOffline({ text: inputText, apiClient });
    const baseForms = result.flashcards.map(c => c.base_form);
    expect(baseForms).toEqual(expect.arrayContaining(["pamosties", "dzimšanas diena"]));
    expect(result.translationText).toBe("Анна встает рано. Сегодня день рождения ее матери.");
  });

  it("returns system card on network error", async () => {
    server.use(
      http.post("*", () => {
        return HttpResponse.error();
      })
    );

    const result = await processTextOffline({ text: inputText, apiClient });
    expect(result.flashcards).toHaveLength(1);
    const errCard = result.flashcards[0];
    expect(errCard.base_translation).toMatch(/Проверьте/);
    expect(result.translationText).toBe("");
  });

  it("retries after error and succeeds", async () => {
    let call = 0;
    server.use(
      http.post("*", () => {
        call++;
        if (call === 1) {
          return HttpResponse.error();
        }
        return HttpResponse.json({
          content: [{ type: "text", text: JSON.stringify(sampleResponse) }],
        });
      })
    );

    const result = await processTextOffline({ text: inputText, apiClient });
    expect(result.flashcards.length).toBeGreaterThan(1);
    expect(result.translationText).toBe("Анна встает рано. Сегодня день рождения ее матери.");
  });
});
