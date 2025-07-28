describe("Пример: открытие приложения", () => {
  it("Открывает главную страницу", () => {
    cy.visit("http://localhost:5173");
    cy.contains("Process").should("be.visible");
  });
});
