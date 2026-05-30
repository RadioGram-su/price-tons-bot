# Price Tons Bot · @Price_Tons_bot

Telegram-бот: цены и алерты jetton'ов на **STON.fi** и **DeDust** (TON). **Полностью бесплатно.**

## Возможности

- `/price NOT` — цена на STON.fi и DeDust
- `/add` — алерт: выше/ниже USD, рост/падение на %
- `/list` — список алертов
- Проверка цен каждую минуту

## Запуск

```bash
export TELEGRAM_BOT_TOKEN=your_token
npm run bot:jetton-alert
```

Локально из папки бота:

```bash
cd bots/jetton-alert-bot
npm start
```

## Self-test (без Telegram)

```bash
npm run bot:jetton-alert:self-test
```

## Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `TELEGRAM_BOT_TOKEN` | — | Токен от @BotFather |
| `PORT` | `8789` | Health-check сервер |
| `BOT_USERNAME` | `Price_Tons_bot` | Username бота (для логов) |
| `ALERT_LIMIT` | `5` | Алертов на пользователя |
| `CHECK_INTERVAL_MS` | `60000` | Интервал проверки |
| `BOT_DATA_DIR` | `./data` | Папка state и кэша |

## Деплой (Bothost / VPS)

- Entry: `bot.js`
- `TELEGRAM_BOT_TOKEN`, `PORT=8080`
- Volume для `data/` (state + кэш jetton'ов)

⚠️ Не финансовый совет. Цены с DEX могут отличаться от бирж.

Telegram: [@Price_Tons_bot](https://t.me/Price_Tons_bot)
