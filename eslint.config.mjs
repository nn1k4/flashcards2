import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import { defineConfig } from "eslint/config";
import pluginPrettier from "eslint-plugin-prettier";

export default defineConfig([
  {
    // !!! ИГНОРИРОВАНИЕ ФАЙЛОВ И ДИРЕКТОРИЙ
    // Чтобы ESLint не анализировал артефакты сборки, lock-файлы и кеши:
    // - package.json: конфиг npm
    // - package-lock.json: файл блокировки npm
    // - node_modules/**: зависимости
    // - .next/**: сборка Next.js
    // - venv/**: виртуальное окружение Python
    // - __pycache__/**: кеши Python
    // - .ruff_cache/**: кеши Ruff
    ignores: [
      "package.json",
      "package-lock.json",
      "node_modules/**",
      ".next/**",
      "venv/**",
      "__pycache__/**",
      ".ruff_cache/**",
      "server/package-lock.json",
      "client/src/App1.tsx",
      "client/src/App2.tsx",
      "diff/**",
      "dist/**",
    ],
  },

  {
    // !!! JAVASCRIPT И TYPESCRIPT - РЕКОМЕНДУЕМЫЕ НАСТРОЙКИ
    // - Файлы .js, .mjs, .cjs, .ts, .jsx, .tsx
    // - Базовый конфиг @eslint/js
    // - Глобали браузера (window, document и т.д.)
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // !!! РЕКОМЕНДУЕМАЯ КОНФИГУРАЦИЯ ДЛЯ TYPESCRIPT
  tseslint.configs.recommended,

  {
    // !!! КОНФИГУРАЦИЯ ПЛАГИНА REACT
    // - Файлы React и TSX
    // - Авто-детект версии React
    // - Отключение правила display-name из-за ошибки getAllComments
    files: ["**/*.{js,mjs,cjs,jsx,tsx,ts}"],
    plugins: { react: pluginReact },
    extends: [pluginReact.configs.flat.recommended],
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/display-name": "off",
    },
  },

  {
    // !!! NODE/CommonJS CONFIG-FILES
    // Вместо env: { node: true } (недопустимо в flat config)
    // Используем languageOptions:
    // - globals.node: предоставляет глобальные переменные Node.js (module, require, process и пр.)
    // - parserOptions: задаёт ecmaVersion и sourceType 'script' для CommonJS
    files: ["**/*.config.js"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "script",
      },
    },
  },

  {
    // !!! КОНФИГУРАЦИЯ ДЛЯ JSON
    files: ["**/*.json"],
    plugins: { json },
    language: "json/json",
    extends: ["json/recommended"],
  },

  {
    // !!! КОНФИГУРАЦИЯ ДЛЯ JSONC (JSON с комментариями)
    files: ["**/*.json", "**/*.jsonc", "**/tsconfig*.json"],
    plugins: { json },
    language: "json/jsonc",
    extends: ["json/recommended"],
  },

  {
    // !!! КОНФИГУРАЦИЯ ДЛЯ CSS
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    extends: ["css/recommended"],
    rules: {
      // Отключаем правило для Tailwind CSS директив (@tailwind)
      "css/no-invalid-at-rules": "off",
    },
  },
  {
    files: ["**/*.json5"],
    plugins: { json },
    language: "json/json5",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    extends: ["markdown/recommended"],
  },
  {
    // !!! ИНТЕГРАЦИЯ С PRETTIER (исправленная версия для .mjs)
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      prettier: pluginPrettier,
    },
    rules: {
      // Отключаем правила форматирования ESLint в пользу Prettier
      "prettier/prettier": [
        "error",
        {
          endOfLine: "lf",
        },
      ],
    },
  },
]);
