/// <reference types="cypress" />

// Основные E2E сценарии приложения

describe("📘 E2E тесты приложения flashcards", () => {
  const url = "http://localhost:5173";

  beforeEach(() => {
    cy.visit(url);
  });

  it("1️⃣ Успешная обработка текста", () => {
    cy.intercept("POST", "/proxy/claude", { fixture: "success.json" }).as("claude");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claude");
    cy.get('[data-testid="flashcard"]').should("have.length.at.least", 2);
    cy.get('[data-testid="translation-content"]').should("contain", "Анна встает рано");
  });

  it("2️⃣ Ошибка сети при обработке", () => {
    cy.intercept("POST", "/proxy/claude", { forceNetworkError: true }).as("claudeError");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claudeError");
    cy.contains("🔴").should("be.visible");
    cy.contains("Повторить").should("be.visible");
  });

  it("3️⃣ Успешный Retry", () => {
    cy.intercept("POST", "/proxy/claude", { forceNetworkError: true }).as("firstFail");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@firstFail");
    cy.intercept("POST", "/proxy/claude", { fixture: "success.json" }).as("claudeRetry");
    cy.contains("Повторить").click();
    cy.wait("@claudeRetry");
    cy.get('[data-testid="flashcard"]').should("have.length.at.least", 2);
  });

  it("4️⃣ Удаление и добавление карточки", () => {
    cy.intercept("POST", "/proxy/claude", { fixture: "success.json" }).as("claude");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claude");
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
    cy.intercept("POST", "/proxy/claude", { fixture: "success.json" }).as("claude");
    cy.get('[data-testid="text-input"]').type("Anna pamostas agri.");
    cy.get('[data-testid="process-button"]').click();
    cy.wait("@claude");
    cy.get('[data-testid="export-button"]').click();
    cy.get('[data-testid="clear-button"]').click();
    cy.get('[data-testid="flashcard"]').should("not.exist");
    cy.get('[data-testid="import-button"]').click();
    cy.get('input[type="file"]').selectFile("cypress/fixtures/success.json", { force: true });
    cy.get('[data-testid="flashcard"]').should("have.length.at.least", 2);
  });
});
