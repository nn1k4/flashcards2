import { defineConfig } from "cypress";
import fs from "fs";
import path from "path";

export default defineConfig({
  e2e: {
    specPattern: "client/cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
    supportFile: "client/cypress/support/e2e.ts",
    baseUrl: "http://localhost:5173",
    chromeWebSecurity: false,
    experimentalFetchPolyfill: true,
    setupNodeEvents(on) {
      const logsDir = "client/cypress/logs";
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "_");
      const browserLogFile = path.join(logsDir, `browser_log_${timestamp}.txt`);
      const summaryFile = path.join(logsDir, `test_summary_${timestamp}.json`);

      on("task", {
        logToFile(message: string) {
          fs.appendFileSync(browserLogFile, message + "\n");
          return null;
        },
        saveSummary(summary: unknown) {
          fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
          return null;
        },
      });
    },
  },
});
