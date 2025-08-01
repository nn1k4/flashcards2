# 📘 Latvian Learning Flashcards (Client)

Этот проект реализует клиентскую часть интерактивного приложения для изучения латышского языка через флэшкарточки. Он построен на React + TypeScript и взаимодействует с backend-прокси и API Claude.ai.

---

## ⭐️ Запуск прокси сервера

```bash
cd server
# npm install  # в случае если зависимости еще не были установленны
npm run start
```

После запуска прокси сервер будет доступен по адресу:

```
http://localhost:3001/
```

## ⭐️ Запуск приложения

```bash
cd client
# npm install  # в случае если зависимости еще не были установленны
npm run dev
```

После запуска приложение будет доступно по адресу:

```
http://localhost:5173/
```

---

## 🔬 Тестирование

### ✅ Интеграционные тесты (Jest)

```bash
# Запуск всех unit/integration тестов
npm test -- --silent
```

> ⚠️ Покрытие минимальное. Планируется дополнение.

### 🧪 End-to-End тесты (Cypress)

```bash
# Открыть тесты в GUI-режиме
npm run cypress:open

# Запустить тесты в headless-режиме
npm run cypress:run

# Только тесты, без запуска dev-сервера
npm run cypress:run:only
```

> Сценарии находятся в `client/cypress/e2e/main.cy.ts`

### 📆 Экспорт/Импорт карточек

- `Export` — сохранить `latvian-learning-YYYY-MM-DD.json`
- `Import` — загрузить ранее сохранённый файл

---

## 🪑 Форматирование кода

### 🔧 Автоформатирование

```bash
npm run format           # Всё приложение
npm run format:check     # Только проверка
npm run format:client    # Только клиент
npm run format:server    # Только сервер
```

### 🤦‍♂️ Проверка формата с выводом ошибок

```bash
npm run lint -- --format codeframe         # Всё
npm run lint:client -- --format codeframe  # Только client
npm run lint:server -- --format codeframe  # Только server
```

---

## 🧠 Проверка типов

```bash
npx tsc --noEmit --pretty         # Быстро
npm run type-check                # Одноразовая
npm run type-check:watch          # Watch-режим
```

---

## 📁 Структура проекта

```
|---.gitattributes                              # Настройки Git для управления переносами строк и кодировкой
|---.gitignore                                  # Исключения из контроля версий Git
|---cypress.config.ts                           # Конфигурация Cypress (E2E тестов)
|---index.html                                  # HTML-шаблон для Vite
|---jest.config.js                              # Конфигурация Jest для unit/integration тестов
|---jest.setup.ts                               # Глобальные хуки для Jest

|---client                                      # Основная клиентская часть приложения
|   |---cypress                                 # E2E тесты Cypress
|   |   |---e2e
|   |   |   +---main.cy.ts                      # Основной E2E сценарий
|   |   |---fixtures
|   |   |   +---success.json                    # Моки успешных ответов от API
|   |   +---support
|   |   |   |---commands.ts                     # Кастомные Cypress-команды
|   |   |   +---e2e.ts                          # Инициализация тестовой среды Cypress
|   +---src                                     # Исходный код React-приложения
|   |   |---App.tsx                             # Главный React-компонент приложения
|   |   |---claude.ts                           # Обертка над API Claude.ai
|   |   |---index.css                           # Глобальные стили
|   |   |---main.tsx                            # Точка входа React
|   |   |---components                          # Все React-компоненты UI
|   |   |   |---EditView.tsx                    # Редактирование карточек
|   |   |   |---FlashcardsView.tsx              # Просмотр карточек
|   |   |   |---Footer.tsx                      # Подвал приложения
|   |   |   |---Header.tsx                      # Заголовок/меню
|   |   |   |---ModeSelector.tsx                # Переключатель режимов
|   |   |   |---ReadingView.tsx                 # Режим чтения
|   |   |   |---TextInputView.tsx               # Ввод текста для анализа
|   |   |   +---TranslationView.tsx             # Режим перевода
|   |   |---config
|   |   |   +---index.ts                        # Конфигурационные параметры
|   |   |---hooks                               # Пользовательские React-хуки
|   |   |   |---useFileOperations.ts            # Импорт/экспорт карточек
|   |   |   |---useKeyboardNavigation.ts        # Управление навигацией с клавиатуры
|   |   |   |---useProcessing.ts                # Основная логика обработки текста
|   |   |   +---useRetryQueue.ts                # Очередь повторной отправки
|   |   |---services                            # Слой API и логики
|   |   |   |---ApiClient.ts                    # Общий клиент для API-запросов
|   |   |   |---ProcessingService.ts            # Логика обработки chunk-ов
|   |   |   +---__tests__
|   |   |       +---ProcessingService.test.ts   # Юнит-тесты для сервиса
|   |   |---types
|   |   |   +---index.ts                        # Общие типы TypeScript
|   |   +---utils                               # Вспомогательные функции
|   |       |---cardUtils.ts                    # Работа с карточками
|   |       |---error-handler.ts                # Анализ и типизация ошибок
|   |       |---textUtils.ts                    # Манипуляции с текстом
|   |       +---__tests__
|   |           +---cardUtils.test.ts           # Юнит-тесты утилит

|---cypress                                     # Вспомогательные ресурсы для Cypress
|   |---downloads                               # Файлы, созданные при экспорте
|   |   +---latvian-learning-2025-08-01.json    # Пример экспортированного файла
|   |---fixtures                                # Дополнительные моки API
|   |   |---api-claude-success.json
|   |   +---success.json
|   +---screenshots                             # Скриншоты сбоев Cypress

|---server                                      # Сервер-прокси (Node.js)
|   |---.env                                    # Переменные окружения
|   +---proxy.ts                                # Реализация прокси между клиентом и API

|---test                                        # Общие скрипты и утилиты для тестов
|   +---server.ts                               # Вспомогательный сервер для тестирования
```
