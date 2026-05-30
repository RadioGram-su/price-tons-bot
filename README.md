# Habit Tracker Bot

Telegram-бот для отказа от вредных привычек: **курение**, **алкоголь**, свои привычки.

## Возможности

- Счётчик дней и streak
- Экономия денег и «не потреблено» (сигареты / порции)
- Мотивация **несколько раз в день** (утро, день, после обеда, вечер)
- Кнопка **SOS /urge** — помощь при сильном желании
- Здоровые **замены** привычки
- Честная запись **срыва** без стыда
- Настройка часового пояса и слотов напоминаний

## Быстрый старт

1. Создай бота через [@BotFather](https://t.me/BotFather)
2. Скопируй токен в переменную окружения:

```bash
set TELEGRAM_BOT_TOKEN=123456:ABC...
```

3. Запуск локально:

```bash
npm run bot:habit-tracker
```

4. Self-test (без Telegram):

```bash
npm run bot:habit-tracker:self-test
```

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `TELEGRAM_BOT_TOKEN` | Токен бота | обязательно |
| `PORT` | HTTP-порт для Render | `8788` |
| `PUBLIC_BASE_URL` | URL сервиса (Render) | — |
| `BOT_STATE_PATH` | Путь к state.json | `data/state.json` |
| `BOT_DATA_DIR` / `DATA_DIR` | Папка для state (Bothost: `/app/data`) | `data` |
| `BOT_CONFIG_DIR` | Папка с motivation/replacements | `config` |
| `REMINDER_MORNING` | Час утреннего напоминания | `9` |
| `REMINDER_MIDDAY` | Час дневного | `13` |
| `REMINDER_AFTERNOON` | Час после обеда | `17` |
| `REMINDER_EVENING` | Час вечернего | `20` |

## Деплой на Bothost

Bothost монтирует **пустой volume** на `/app/data` — файлы мотивации должны лежать в **`config/`**, не в `data/`:

```
bot.js
config/
  motivation.json
  replacements.json
data/          ← только state.json (создаётся ботом)
```

Env на Bothost:
- `TELEGRAM_BOT_TOKEN`
- `PORT=8080`
- Главный файл: `bot.js`

## Деплой на Render

1. **New Web Service** → репозиторий GitHub
2. **Build Command:** `npm install` (или пусто)
3. **Start Command:** `node bots/habit-tracker-bot/bot.js`
4. **Environment:**
   - `TELEGRAM_BOT_TOKEN`
   - `PORT=10000`
   - `PUBLIC_BASE_URL=https://your-service.onrender.com`

> Не запускай бота локально и на Render одновременно с одним токеном.

## Команды бота

| Команда | Действие |
|---------|----------|
| `/start` | Главное меню |
| `/stats` | Прогресс, дни, экономия |
| `/motivation` | Мотивация сейчас |
| `/urge` | SOS при сильном желании |
| `/add` | Добавить привычку |
| `/habits` | Список привычек |
| `/relapse` | Записать срыв |
| `/settings` | Напоминания и часовой пояс |
| `/help` | Справка |

## Данные

- `data/motivation.json` — тексты мотивации по типам и времени суток
- `data/replacements.json` — идеи замены привычки
- `data/state.json` — пользователи (в `.gitignore`)

## Монетизация (идеи)

- Premium: больше напоминаний, персональные цели, экспорт статистики
- Партнёрки: приложения медитации, фитнес, дelivery полезной еды
- Донат через CloudTips

## Дисклеймер

Бот — поддерживающий инструмент, **не заменяет** врача или нарколога. При тяжёлой зависимости обращайтесь к специалистам.
