const fs = require("fs");
const path = require("path");

function backupState(statePath, dataDir) {
  try {
    if (!fs.existsSync(statePath)) return;
    const backupPath = path.join(dataDir, `state.backup.${Date.now()}.json`);
    fs.copyFileSync(statePath, backupPath);
    const files = fs.readdirSync(dataDir)
      .filter((f) => f.startsWith("state.backup."))
      .sort()
      .reverse();
    for (const old of files.slice(5)) {
      fs.unlinkSync(path.join(dataDir, old));
    }
  } catch (error) {
    console.error("Backup error:", error.message);
  }
}

module.exports = { backupState };
