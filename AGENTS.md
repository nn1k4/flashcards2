# AGENTS.md

## 🚀 Цель проекта

Это приложение помогает русскоязычным пользователям изучать латышский язык через интерактивные карточки, автоматический перевод и чтение с подсказками. Подробнее см. [trs.md](./doc/trs.md)

---

## 🧪 Как запустить и отлаживать проект

### 🔧 Установка и запуск

#### 1. Запуск прокси-сервера (`Claude API Proxy`)

```bash
cd server              # Переход в папку сервера
npm install            # Установка зависимостей (однократно)
npm run start          # Запуск прокси сервера
```

После запуска вы увидите:

```
🚀 ===== ПРОКСИ СЕРВЕР ЗАПУЩЕН =====
🌐 Слушает порт: 3001
🏥 Health check: http://localhost:3001/health
🧪 Test endpoint: http://localhost:3001/api/claude/test
```

---

#### 2. Запуск клиентского приложения

```bash
cd client              # Переход в папку клиента
npm install            # Установка зависимостей (однократно)
npm run dev            # Запуск клиента в режиме разработки
```

После запуска в консоли:

```
  ➜  Local:   http://localhost:5173/
```

Затем откройте в браузере:
[http://localhost:5173/](http://localhost:5173/)

---

### 🐞 Отладка

#### Ошибки отслеживаются:

- В **консоли браузера** (DevTools > Console)
- В **консоли сервера** — содержит запросы, ошибки и статус `Claude API`

---

## 🧹 Проверка кода (ESLint)

### Установка format/lint зависимостей (однократно)

```bash
npm install -D eslint-formatter-codeframe eslint-config-prettier eslint-plugin-prettier
```

### Команды анализа:

```bash
npm run lint -- --format codeframe          # Весь проект
npm run lint:client -- --format codeframe   # Только клиент
npm run lint:server -- --format codeframe   # Только сервер
npm run lint:fix                            # С автоисправлением
```

---

## 🎨 Автоформатирование кода (Prettier)

```bash
npm run format              # Форматировать весь проект
npm run format:check        # Проверить без изменений
npm run format:client       # Только клиент
npm run format:server       # Только сервер
```

---

## 🔄 Комбинированные команды

```bash
npm run lint-and-format     # Сначала форматирует, затем проверяет
npm run fix-all             # Форматирует и исправляет простые ошибки
```

---

## 🧠 Дополнительная информация

- Проект использует **Claude API** с прокси на `localhost:3001`.
- Все компоненты React находятся в `client/src/components`
- Бизнес-логика разделена по хукам (`hooks/`) и сервисам (`services/`)
- Повторные обработки и ошибки управляются через `retry queue` (см. `useRetryQueue.ts`)
- Центральная логика API в `ApiClient.ts`, `error-handler.ts`, `callClaude`

---

## 📌 Полезные ссылки

- Claude API: [https://docs.anthropic.com/](https://docs.anthropic.com/)
- Rate Limits: [cursor-ide.com](https://www.cursor-ide.com/blog/claude-api-429-error-fix-en)
- Retry Strategy: [TODO2.txt](./doc/TODO2.txt), [TODO3.txt](./doc/TODO3.txt)
