const failures = { ston: 0, dedust: 0, tonco: 0 };
let lastAlertAt = 0;

function recordApiSuccess(name) {
  failures[name] = 0;
}

function recordApiFailure(name) {
  failures[name] = (failures[name] || 0) + 1;
}

function shouldNotifyAdmin() {
  const total = failures.ston + failures.dedust + failures.tonco;
  if (total < 5) return false;
  if (Date.now() - lastAlertAt < 30 * 60_000) return false;
  lastAlertAt = Date.now();
  return true;
}

function adminAlertMessage() {
  return `⚠️ **Price Tons monitor**\n\nSTON: ${failures.ston} · DeDust: ${failures.dedust} · Tonco: ${failures.tonco}\n\nПроверь API / Bothost.`;
}

module.exports = { recordApiSuccess, recordApiFailure, shouldNotifyAdmin, adminAlertMessage };
