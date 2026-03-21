const DEFAULT_SETTINGS = {
  searchTabs: true,
  searchClosedTabs: true,
  searchBookmarks: true,
  searchCommands: true,
  searchHistory: true,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const statusEl = document.getElementById("status");

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  if (text) {
    setTimeout(() => {
      if (statusEl.textContent === text) {
        statusEl.textContent = "";
      }
    }, 1600);
  }
}

async function loadSettings() {
  const settings = await browser.storage.local.get(DEFAULT_SETTINGS);
  for (const key of SETTING_KEYS) {
    const checkbox = document.getElementById(key);
    if (checkbox) checkbox.checked = Boolean(settings[key]);
  }
}

async function loadCurrentShortcut() {
  try {
    const commands = await browser.commands.getAll();
    const openCommand = commands.find(cmd => cmd.name === "open-quick-commands");
    const shortcutEl = document.getElementById("currentShortcut");
    if (shortcutEl) {
      if (openCommand && openCommand.shortcut) {
        shortcutEl.textContent = openCommand.shortcut;
      } else {
        shortcutEl.textContent = "Not set";
      }
    }
  } catch (err) {
    console.error("Failed to load shortcuts:", err);
    const shortcutEl = document.getElementById("currentShortcut");
    if (shortcutEl) shortcutEl.textContent = "Unable to load";
  }
}

async function saveSettings() {
  const payload = {};
  for (const key of SETTING_KEYS) {
    const checkbox = document.getElementById(key);
    if (checkbox) payload[key] = Boolean(checkbox.checked);
  }
  await browser.storage.local.set(payload);
  setStatus("Saved");
}

function bindEvents() {
  for (const key of SETTING_KEYS) {
    const checkbox = document.getElementById(key);
    if (checkbox) {
      checkbox.addEventListener("change", () => {
        saveSettings().catch((err) => {
          console.error("Failed to save settings:", err);
          setStatus("Could not save settings");
        });
      });
    }
  }

  const customizeBtn = document.getElementById("customizeShortcutBtn");
  if (customizeBtn) {
    customizeBtn.addEventListener("click", () => {
      if (browser.commands.openShortcutSettings) {
        browser.commands.openShortcutSettings().catch((err) => {
          console.error("Failed to open shortcut settings:", err);
        });
      }
    });
  }
}

Promise.all([loadSettings(), loadCurrentShortcut()])
  .then(bindEvents)
  .catch((err) => {
    console.error("Failed to load settings:", err);
    setStatus("Could not load settings");
  });
