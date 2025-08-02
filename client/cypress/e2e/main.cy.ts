/// <reference types="cypress" />

// Основные E2E сценарии приложения

describe("📘 E2E тесты приложения flashcards", () => {
  const url = "http://localhost:5173";

  beforeEach(() => {
    cy.visit(url);
  });

  afterEach(() => {
    cy.get("body").then(() => {
      const summary = {
        timestamp: new Date().toISOString(),
        input: "Anna pamostas agri.",
        translation: Cypress.$('[data-testid="translation-content"]').text(),
        hasError: Cypress.$('[data-testid="api-status-bar"]').length > 0,
        cardsGenerated: Cypress.$('[data-testid="flashcard"]').length,
        mode:
          Cypress.$('[data-testid="mode-flashcards"]').attr("aria-selected") === "true"
            ? "flashcards"
            : "unknown",
      };
      return cy.task("saveSummary", summary);
    });
  });

  it("1️⃣ Успешная обработка текста", () => {
    cy.intercept("OPTIONS", "http://localhost:3001/api/claude", {
      statusCode: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    }).as("preflight");
    cy.intercept("POST", "http://localhost:3001/api/claude", {
      fixture: "api-claude-success.json",
      headers: {
        "access-control-allow-origin": "*",
      },
    }).as("claude");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claude");
    cy.get('[data-testid="mode-flashcards"]', { timeout: 30000 }).should("not.be.disabled").click();
    cy.get('[data-testid="flashcard"]', { timeout: 30000 }).should("have.length.greaterThan", 0);
    cy.get('[data-testid="mode-translation"]').click();
    cy.get('[data-testid="translation-content"]', { timeout: 30000 }).should(
      "contain",
      "Анна встает рано"
    );
  });

  it("2️⃣ Ошибка сети при обработке", () => {
    cy.intercept("OPTIONS", "http://localhost:3001/api/claude", {
      statusCode: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    }).as("preflightError");
    cy.intercept("POST", "http://localhost:3001/api/claude", {
      forceNetworkError: true,
    }).as("claudeError");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claudeError");
    cy.get('[data-testid="api-status-bar"]', { timeout: 30000 }).should("be.visible");
    cy.contains(/Проблемы с соединением|Ошибка сети|Прокси сервер недоступен/i, {
      timeout: 30000,
    }).should("be.visible");
    cy.contains(/Повторить|Перезапустить/i, { timeout: 30000 }).should("be.visible");
  });

  it("3️⃣ Успешный Retry", () => {
    cy.intercept("OPTIONS", "http://localhost:3001/api/claude", {
      statusCode: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    }).as("preflightFail");
    cy.intercept("POST", "http://localhost:3001/api/claude", {
      forceNetworkError: true,
    }).as("firstFail");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@firstFail");
    cy.get('[data-testid="api-status-bar"]', { timeout: 30000 }).should("be.visible");
    cy.contains(/Проблемы с соединением|Ошибка сети|Прокси сервер недоступен/i, {
      timeout: 30000,
    }).should("be.visible");
    cy.contains(/Повторить|Перезапустить/i, { timeout: 30000 }).should("be.visible");
    cy.intercept("OPTIONS", "http://localhost:3001/api/claude", {
      statusCode: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    }).as("preflightRetry");
    cy.intercept("POST", "http://localhost:3001/api/claude", {
      fixture: "api-claude-success.json",
      headers: {
        "access-control-allow-origin": "*",
      },
    }).as("claudeRetry");
    cy.contains(/Повторить|Перезапустить/i).click();
    cy.wait("@claudeRetry");
    cy.get('[data-testid="mode-flashcards"]', { timeout: 30000 }).should("not.be.disabled").click();
    cy.get('[data-testid="flashcard"]', { timeout: 30000 }).should("have.length.greaterThan", 0);
  });

  it("4️⃣ Удаление и добавление карточки", () => {
    cy.intercept("OPTIONS", "http://localhost:3001/api/claude", {
      statusCode: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    }).as("preflight4");
    cy.intercept("POST", "http://localhost:3001/api/claude", {
      fixture: "api-claude-success.json",
      headers: { "access-control-allow-origin": "*" },
    }).as("claude");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claude");
    cy.get('[data-testid="mode-flashcards"]', { timeout: 15000 }).should("not.be.disabled").click();
    cy.get('[data-testid="flashcard"]').first().click();
    cy.get('[data-testid="next-button"]').click();
    // Переходим в режим редактирования
    cy.get('[data-testid="mode-edit"]').click();
    cy.get('[data-testid="delete-card-button"]').first().click();
    cy.get('[data-testid^="card-row-"]').should("have.length.lessThan", 2);
    cy.get('[data-testid="add-card-button"]').click();
    cy.get('[data-testid^="card-row-"]').should("have.length.at.least", 1);
  });

  it("5️⃣ Экспорт и импорт карточек", () => {
    cy.intercept("OPTIONS", "http://localhost:3001/api/claude", {
      statusCode: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    }).as("preflight5");
    cy.intercept("POST", "http://localhost:3001/api/claude", {
      fixture: "api-claude-success.json",
      headers: { "access-control-allow-origin": "*" },
    }).as("claude");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claude");
    cy.get('[data-testid="export-button"]', { timeout: 30000 }).should("not.be.disabled").click();
    cy.get('[data-testid="clear-button"]').click();
    cy.get('[data-testid="flashcard"]').should("not.exist");
    cy.on("window:alert", txt => {
      expect(txt).to.match(/Imported \d+ flashcards/);
    });
    cy.get('[data-testid="import-file-input"]').selectFile("cypress/fixtures/success.json", {
      force: true,
    });
    cy.get('[data-testid="mode-flashcards"]', { timeout: 30000 }).should("not.be.disabled").click();
    cy.get('[data-testid="flashcard"]', { timeout: 15000 }).should("have.length.greaterThan", 0);
  });
});
