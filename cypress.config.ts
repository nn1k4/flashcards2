import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    specPattern: "client/cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
    supportFile: "client/cypress/support/e2e.ts",
    baseUrl: "http://localhost:5173",
    chromeWebSecurity: false,
    experimentalFetchPolyfill: true,
  },
});
