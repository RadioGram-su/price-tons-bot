const { QUIET_HOURS_START, QUIET_HOURS_END } = require("./config");

function isQuietHours(localHour, enabled = true) {
  if (!enabled) return false;
  const start = QUIET_HOURS_START;
  const end = QUIET_HOURS_END;
  if (start < end) return localHour >= start && localHour < end;
  return localHour >= start || localHour < end;
}

module.exports = { isQuietHours };
