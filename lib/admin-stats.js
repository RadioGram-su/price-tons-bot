function isAdmin(userId, adminChatId) {
  if (!adminChatId) return false;
  return String(userId) === String(adminChatId);
}

function touchActivity(user) {
  const now = new Date().toISOString();
  if (!user.createdAt) user.createdAt = now;
  user.lastSeen = now;
}

function shouldPersistActivity(user, minMs = 300000) {
  if (!user._activitySavedAt) return true;
  return Date.now() - user._activitySavedAt >= minMs;
}

function markActivitySaved(user) {
  user._activitySavedAt = Date.now();
}

function activeSince(users, days) {
  const cutoff = Date.now() - days * 86400000;
  return Object.values(users || {}).filter(
    (u) => u.lastSeen && new Date(u.lastSeen).getTime() >= cutoff
  ).length;
}

function createdSince(users, days) {
  const cutoff = Date.now() - days * 86400000;
  return Object.values(users || {}).filter(
    (u) => u.createdAt && new Date(u.createdAt).getTime() >= cutoff
  ).length;
}

function buildAdminStats({ title, users, extraLines = [] }) {
  const total = Object.keys(users || {}).length;
  return [
    `📊 **${title}**`,
    "",
    `👥 Всего: **${total}**`,
    `🟢 Активны сегодня (1д): **${activeSince(users, 1)}**`,
    `🟢 Активны 7д: **${activeSince(users, 7)}**`,
    `🆕 Новых 7д: **${createdSince(users, 7)}**`,
    ...extraLines
  ].join("\n");
}

module.exports = {
  isAdmin,
  touchActivity,
  shouldPersistActivity,
  markActivitySaved,
  buildAdminStats,
  activeSince,
  createdSince
};
