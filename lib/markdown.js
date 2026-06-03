/** Экранирование для Telegram parse_mode Markdown (legacy) */
function escapeMd(text) {
  return String(text ?? "").replace(/([_*`\[])/g, "\\$1");
}

module.exports = { escapeMd };
