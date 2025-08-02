// Import commands.ts using ES2015 syntax:
import "./commands";

// Alternatively you can use CommonJS syntax:
// require('./commands');

Cypress.on("window:before:load", win => {
  const originalLog = win.console.log;
  win.console.log = (...args) => {
    originalLog(...args);
    cy.task("logToFile", args.map(String).join(" ")).catch(() => {});
  };
});
