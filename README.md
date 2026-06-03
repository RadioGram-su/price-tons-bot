# Price Tons Bot · @Price_Tons_bot

Telegram-бот: цены jetton'ов на **STON.fi**, **DeDust**, **Tonco** + алерты и дайджест. **Бесплатно.**

## Возможности

### Цены
- `/price NOT` — STON + DeDust + Tonco, спред, ликвидность, объём, FDV, CEX (CoinGecko)
- `/grm` — быстрый доступ к GRM (ex-Gram)
- `/top` — топ рост/падение за день
- `/compare NOT DOGS` — сравнение двух токенов
- `/spread NOT` — спред между DEX + алерт
- `/exportwatchlist` — экспорт тикеров дайджеста
- `/new` — популярные jetton'ы на STON (не «новые листинги»)
- Inline: `@Price_Tons_bot NOT` в любом чате
- Кнопки: обновить, алерт, дайджест, **проверить контракт**, гайды, Radio Gram
- **⚠️ Рейтинг риска** (ликвидность, спред, объём, метки STON)
- Sparkline 7д (текст)

### Алерты (`/add`)
- Цена выше/ниже USD
- Рост / падение / резко ±20% (шаблоны в один клик)
- **↔️ Спред DEX** — расхождение STON/DeDust/Tonco
- **🕵️ Памп/час** + авто-предупреждение ≥200%/час
- Объём ↑, ликвидность ↓, новый пул, кит (движение между тиками)
- **🌙 Тихие часы** 23:00–08:00 — алерты копятся до утра
- **Картинки алертов** (рост / падение / памп) + ироничный тон
- Повтор: **один раз · раз в день · снова**
- `/alertbatch` — пакет ±20% для всего дайджеста

### База знаний
- `/guide` — гайды «как не слить на мемах», алерты, рейтинг риска

### Дайджест
- `/watch NOT, GRM, DOGS` — импорт через запятую
- Утро + вечер (настраивается); тихий день (<0.5%) — без спама
- «С прошлого визита» при `/start`
- День / неделя / max / min / объём / ликвидность
- Еженедельный отчёт (воскресенье)

### Прочее
- `/settings` — часовой пояс, время дайджеста, RU/EN
- `/ref` — рефералка (+2 слота дайджеста, +1 алерт за друга)
- Клавиатура **NOT · GRM · DOGS** — цена в один тап
- Онбординг NOT / GRM при первом `/start`
- Webhook (`USE_WEBHOOK=1` + `PUBLIC_BASE_URL`)
- Бэкап state, мониторинг API (ADMIN_CHAT_ID)
- Автопост в канал при движении GRM (`CHANNEL_ID`)

## Запуск

```bash
export TELEGRAM_BOT_TOKEN=...
npm run bot:jetton-alert
```

## Env

| Переменная | Default | Описание |
|------------|---------|----------|
| `TELEGRAM_BOT_TOKEN` | — | Токен бота |
| `BOT_USERNAME` | Price_Tons_bot | Username |
| `PORT` | 8789 | HTTP / webhook |
| `USE_WEBHOOK` | false | Webhook режим |
| `PUBLIC_BASE_URL` | — | URL для webhook |
| `ALERT_LIMIT` | 5 | Алертов (база) |
| `BIG_MOVE_PCT` | 20 | Порог «резкого» движения |
| `REFERRAL_ALERT_BONUS` | 1 | +алерт за реферала |
| `QUIET_HOURS_START` | 23 | Тихие часы |
| `QUIET_HOURS_END` | 8 | Конец тихих часов |
| `DIGEST_MIN_DAY_CHANGE_PCT` | 0.5 | Порог «тихого дня» для дайджеста |
| `WATCH_LIMIT` | 5 | База дайджеста |
| `CHANNEL_ID` | — | ID канала для GRM-постов |
| `ADMIN_CHAT_ID` | — | Алерты при падении API |
| `RADIO_GRAM_URL` | player.radiogram.su | Кнопка Radio Gram |

## Деплoy (Bothost)

- Entry: `bot.js`
- `lib/*` (включая risk, knowledge, alert-art, links, tones, markdown, quiet-hours)
- `config/tokens.json` + `config/knowledge.json`
- `assets/alerts/*.png` — картинки алертов
- Volume: `data/` (state, кэш, бэкапы)

⚠️ Не финсовет.
