// Import commands.ts using ES2015 syntax:
import "./commands";

// Alternatively you can use CommonJS syntax:
// require('./commands');

declare global {
  interface Window {
    __browserLogs?: string[];
  }
}

Cypress.on("window:before:load", win => {
  const logs: string[] = [];
  win.__browserLogs = logs;
  const originalLog = win.console.log;
  win.console.log = (...args) => {
    logs.push(args.map(String).join(" "));
    originalLog(...args);
  };
});

afterEach(() => {
  cy.window().then(win => {
    const logs = win.__browserLogs || [];
    if (logs.length) {
      cy.task("logToFile", logs.join("\n"));
    }
    win.__browserLogs = [];
  });
});
