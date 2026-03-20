// background.js
// Handles keyboard shortcut, browser action click, and data fetching for content script

browser.commands.onCommand.addListener((command) => {
  if (command === "open-quick-commands") {
    toggleQuickCommands();
  }
});

browser.browserAction.onClicked.addListener(() => {
  toggleQuickCommands();
});

const DEFAULT_SEARCH_SETTINGS = {
  searchTabs: true,
  searchClosedTabs: true,
  searchBookmarks: true,
  searchCommands: true,
  searchHistory: true,
};

async function getSearchSettings() {
  try {
    const stored = await browser.storage.local.get(DEFAULT_SEARCH_SETTINGS);
    return { ...DEFAULT_SEARCH_SETTINGS, ...stored };
  } catch (_) {
    return { ...DEFAULT_SEARCH_SETTINGS };
  }
}

function isRestrictedUrl(url) {
  return (
    !url ||
    url.startsWith("about:") ||
    url.startsWith("moz-extension:") ||
    url.startsWith("chrome:") ||
    url.startsWith("resource:")
  );
}

async function ensureOverlayInjected(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, { type: "PING" });
    return;
  } catch (_) {
    // Not injected yet.
  }

  await browser.tabs.insertCSS(tabId, { file: "overlay.css" });
  await browser.tabs.executeScript(tabId, { file: "content.js" });
}

async function toggleQuickCommands() {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab) return;

  const url = activeTab.url || "";
  if (isRestrictedUrl(url)) {
    // Can't inject into privileged pages; open extension page with fallback action.
    browser.tabs.create({ url: browser.runtime.getURL("popup.html") });
    return;
  }

  try {
    await ensureOverlayInjected(activeTab.id);
    await browser.tabs.sendMessage(activeTab.id, {
      type: "TOGGLE_QUICK_COMMANDS",
    });
  } catch (err) {
    console.error("Unable to open Quick Commands overlay:", err);
  }
}

// Listen for data requests from content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_DATA") {
    fetchData(message.query, message.filter).then(sendResponse);
    return true; // keep channel open for async
  }

  if (message.type === "EXECUTE_COMMAND") {
    executeCommand(message.command, message.payload, sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("Quick Commands execute error:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }
});

async function fetchData(query, filter) {
  const results = [];
  const q = query.trim().toLowerCase();
  const settings = await getSearchSettings();

  try {
    // ── TABS ──────────────────────────────────────────────────────────────
    if (settings.searchTabs && (!filter || filter === "tab")) {
      const tabs = await browser.tabs.query({ currentWindow: true });
      for (const tab of tabs) {
        const title = (tab.title || "").toLowerCase();
        const url = (tab.url || "").toLowerCase();
        if (!q || title.includes(q) || url.includes(q)) {
          results.push({
            type: "tab",
            id: tab.id,
            title: tab.title || tab.url,
            subtitle: tab.url,
            icon: tab.favIconUrl || null,
            windowId: tab.windowId,
          });
        }
      }
    }

    // ── RECENT / CLOSED TABS ──────────────────────────────────────────────
    if (settings.searchClosedTabs && (!filter || filter === "tab")) {
      try {
        const sessions = await browser.sessions.getRecentlyClosed({
          maxResults: 10,
        });
        for (const session of sessions) {
          const t = session.tab;
          if (!t) continue;
          const title = (t.title || "").toLowerCase();
          const url = (t.url || "").toLowerCase();
          if (!q || title.includes(q) || url.includes(q)) {
            results.push({
              type: "closed-tab",
              sessionId: session.tab.sessionId,
              title: t.title || t.url,
              subtitle: t.url,
              icon: t.favIconUrl || null,
            });
          }
        }
      } catch (_) {}
    }

    // ── BOOKMARKS ─────────────────────────────────────────────────────────
    if (settings.searchBookmarks && (!filter || filter === "bookmark")) {
      if (q) {
        const bookmarks = await browser.bookmarks.search(q);
        const bookmarkResults = bookmarks
          .filter((bm) => Boolean(bm.url))
          .map((bm) => ({
            type: "bookmark",
            title: bm.title || bm.url,
            subtitle: bm.url,
            url: bm.url,
            icon: null,
          }));

        bookmarkResults.sort(
          (a, b) => getMatchScore(b, q) - getMatchScore(a, q),
        );
        results.push(...bookmarkResults.slice(0, 15));
      }
    }

    // ── HISTORY ───────────────────────────────────────────────────────────
    if (settings.searchHistory && (!filter || filter === "history")) {
      if (q) {
        const history = await browser.history.search({
          text: q,
          maxResults: 15,
          startTime: 0,
        });
        for (const item of history) {
          results.push({
            type: "history",
            title: item.title || item.url,
            subtitle: item.url,
            url: item.url,
            icon: null,
          });
        }
      }
    }

    // ── COMMANDS ──────────────────────────────────────────────────────────
    if (settings.searchCommands && (!filter || filter === "cmd")) {
      const commands = getBuiltinCommands();
      for (const cmd of commands) {
        const label = cmd.label.toLowerCase();
        if (!q || label.includes(q)) {
          results.push({
            type: "command",
            commandId: cmd.id,
            title: cmd.label,
            subtitle: cmd.description || "",
            icon: null,
            emoji: cmd.emoji,
          });
        }
      }
    }
  } catch (err) {
    console.error("Quick Commands fetch error:", err);
  }

  if (q) {
    results.forEach((result, idx) => {
      result._sortIndex = idx;
      result._score = getMatchScore(result, q);
    });

    results.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return a._sortIndex - b._sortIndex;
    });

    results.forEach((result) => {
      delete result._score;
      delete result._sortIndex;
    });
  }

  return results;
}

function getMatchScore(result, q) {
  const title = String(result.title || "").toLowerCase();
  const subtitle = String(result.subtitle || "").toLowerCase();
  const commandId = String(result.commandId || "").toLowerCase();

  if (!q) return 0;

  if (title === q || subtitle === q || commandId === q) return 1000;
  if (title.startsWith(q)) return 900;
  if (subtitle.startsWith(q) || commandId.startsWith(q)) return 800;
  if (title.split(/\s+/).includes(q)) return 700;
  if (title.includes(q)) return 600;
  if (subtitle.includes(q) || commandId.includes(q)) return 500;
  return 0;
}

function getBuiltinCommands() {
  return [
    // Tabs
    {
      id: "new-tab",
      label: "New Tab",
      emoji: "➕",
      description: "Open a new tab",
    },
    {
      id: "close-tab",
      label: "Close Tab",
      emoji: "✖️",
      description: "Close the current tab",
    },
    {
      id: "reopen-tab",
      label: "Reopen Closed Tab",
      emoji: "↩️",
      description: "Restore the last closed tab",
    },
    {
      id: "duplicate-tab",
      label: "Duplicate Tab",
      emoji: "📋",
      description: "Duplicate the current tab",
    },
    {
      id: "pin-tab",
      label: "Pin / Unpin Tab",
      emoji: "📌",
      description: "Toggle pin on current tab",
    },
    {
      id: "mute-tab",
      label: "Mute / Unmute Tab",
      emoji: "🔇",
      description: "Toggle mute on current tab",
    },
    {
      id: "next-tab",
      label: "Next Tab",
      emoji: "▶️",
      description: "Switch to the next tab",
    },
    {
      id: "prev-tab",
      label: "Prev Tab",
      emoji: "◀️",
      description: "Switch to the previous tab",
    },
    // Navigation
    {
      id: "go-back",
      label: "Go Back",
      emoji: "⬅️",
      description: "Navigate back",
    },
    {
      id: "go-forward",
      label: "Go Forward",
      emoji: "➡️",
      description: "Navigate forward",
    },
    {
      id: "reload",
      label: "Reload Page",
      emoji: "🔄",
      description: "Reload the current page",
    },
    {
      id: "hard-reload",
      label: "Hard Reload",
      emoji: "🔃",
      description: "Bypass cache and reload",
    },
    {
      id: "stop",
      label: "Stop Loading",
      emoji: "⏹️",
      description: "Stop the current page load",
    },
    {
      id: "scroll-top",
      label: "Scroll to Top",
      emoji: "⬆️",
      description: "Jump to top of page",
    },
    {
      id: "scroll-bottom",
      label: "Scroll to Bottom",
      emoji: "⬇️",
      description: "Jump to bottom of page",
    },
    // Page
    {
      id: "zoom-in",
      label: "Zoom In",
      emoji: "🔍",
      description: "Increase page zoom",
    },
    {
      id: "zoom-out",
      label: "Zoom Out",
      emoji: "🔎",
      description: "Decrease page zoom",
    },
    {
      id: "zoom-reset",
      label: "Reset Zoom",
      emoji: "↔️",
      description: "Reset page zoom to 100%",
    },
    {
      id: "fullscreen",
      label: "Toggle Fullscreen",
      emoji: "⛶",
      description: "Enter or exit fullscreen",
    },
    {
      id: "reader-mode",
      label: "Toggle Reader Mode",
      emoji: "📖",
      description: "Enter reader view",
    },
    {
      id: "print-page",
      label: "Print Page",
      emoji: "🖨️",
      description: "Print the current page",
    },
    {
      id: "view-source",
      label: "View Page Source",
      emoji: "📄",
      description: "View source code",
    },
    // Tools & UI
    {
      id: "open-downloads",
      label: "Downloads",
      emoji: "📥",
      description: "Open Downloads panel",
    },
    {
      id: "open-history",
      label: "History",
      emoji: "🕘",
      description: "Open History panel",
    },
    {
      id: "open-bookmarks",
      label: "Bookmarks Manager",
      emoji: "⭐",
      description: "Open Bookmarks library",
    },
    {
      id: "open-extensions",
      label: "Extensions",
      emoji: "🧩",
      description: "Manage extensions",
    },
    {
      id: "open-themes",
      label: "Themes",
      emoji: "🎨",
      description: "Browse Firefox themes",
    },
    {
      id: "open-addons",
      label: "Add-ons Manager",
      emoji: "🔧",
      description: "Open Add-ons Manager",
    },
    {
      id: "open-console",
      label: "Browser Console",
      emoji: "💻",
      description: "Open Browser Console",
    },
    {
      id: "open-settings",
      label: "Settings",
      emoji: "⚙️",
      description: "Open Firefox Settings",
    },
    {
      id: "open-quick-commands-settings",
      label: "Quick Commands Settings",
      emoji: "🛠️",
      description: "Open Quick Commands preferences",
    },
    {
      id: "open-privacy",
      label: "Privacy Settings",
      emoji: "🔒",
      description: "Open Privacy & Security settings",
    },
    {
      id: "open-passwords",
      label: "Passwords",
      emoji: "🔑",
      description: "Open Saved Passwords",
    },
    {
      id: "open-sync",
      label: "Sync Settings",
      emoji: "☁️",
      description: "Open Firefox Sync settings",
    },
    {
      id: "open-tasks",
      label: "Task Manager",
      emoji: "📊",
      description: "Open Firefox Task Manager",
    },
    // Window
    {
      id: "new-window",
      label: "New Window",
      emoji: "🪟",
      description: "Open a new browser window",
    },
    {
      id: "new-private",
      label: "New Private Window",
      emoji: "🕵️",
      description: "Open a private window",
    },
    {
      id: "close-window",
      label: "Close Window",
      emoji: "❌",
      description: "Close this window",
    },
  ];
}

async function executeCommand(commandId, payload, senderTab) {
  switch (commandId) {
    case "__switch-tab__":
      if (payload?.tabId) {
        await browser.tabs.update(payload.tabId, { active: true });
      }
      if (payload?.windowId) {
        await browser.windows.update(payload.windowId, { focused: true });
      }
      break;
    case "__open-url__":
      if (payload?.url) {
        await browser.tabs.update(senderTab.id, { url: payload.url });
      }
      break;
    case "__restore-session__":
      if (payload?.sessionId) {
        await browser.sessions.restore(payload.sessionId);
      }
      break;
    case "new-tab":
      browser.tabs.create({});
      break;
    case "close-tab":
      if (senderTab) browser.tabs.remove(senderTab.id);
      break;
    case "reopen-tab": {
      const sessions = await browser.sessions.getRecentlyClosed({
        maxResults: 1,
      });
      if (sessions[0]?.tab) browser.sessions.restore(sessions[0].tab.sessionId);
      break;
    }
    case "duplicate-tab":
      if (senderTab) browser.tabs.duplicate(senderTab.id);
      break;
    case "pin-tab":
      if (senderTab)
        browser.tabs.update(senderTab.id, { pinned: !senderTab.pinned });
      break;
    case "mute-tab":
      if (senderTab)
        browser.tabs.update(senderTab.id, {
          muted: !senderTab.mutedInfo?.muted,
        });
      break;
    case "next-tab": {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const idx = tabs.findIndex((t) => t.active);
      const next = tabs[(idx + 1) % tabs.length];
      browser.tabs.update(next.id, { active: true });
      break;
    }
    case "prev-tab": {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const idx = tabs.findIndex((t) => t.active);
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      browser.tabs.update(prev.id, { active: true });
      break;
    }
    case "go-back":
      if (senderTab) browser.tabs.goBack(senderTab.id);
      break;
    case "go-forward":
      if (senderTab) browser.tabs.goForward(senderTab.id);
      break;
    case "reload":
      browser.tabs.reload(senderTab.id, { bypassCache: false });
      break;
    case "hard-reload":
      browser.tabs.reload(senderTab.id, { bypassCache: true });
      break;
    case "stop":
      browser.tabs.sendMessage(senderTab.id, {
        type: "PAGE_COMMAND",
        cmd: "stop",
      });
      break;
    case "scroll-top":
      browser.tabs.sendMessage(senderTab.id, {
        type: "PAGE_COMMAND",
        cmd: "scrollTop",
      });
      break;
    case "scroll-bottom":
      browser.tabs.sendMessage(senderTab.id, {
        type: "PAGE_COMMAND",
        cmd: "scrollBottom",
      });
      break;
    case "zoom-in": {
      const [t] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const z = await browser.tabs.getZoom(t.id);
      browser.tabs.setZoom(t.id, Math.min(z + 0.1, 3));
      break;
    }
    case "zoom-out": {
      const [t] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const z = await browser.tabs.getZoom(t.id);
      browser.tabs.setZoom(t.id, Math.max(z - 0.1, 0.3));
      break;
    }
    case "zoom-reset": {
      const [t] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      browser.tabs.setZoom(t.id, 1);
      break;
    }
    case "fullscreen":
      if (senderTab)
        browser.tabs.sendMessage(senderTab.id, {
          type: "PAGE_COMMAND",
          cmd: "fullscreen",
        });
      break;
    case "reader-mode":
      if (senderTab) browser.tabs.toggleReaderMode(senderTab.id);
      break;
    case "print-page":
      if (senderTab)
        browser.tabs.sendMessage(senderTab.id, {
          type: "PAGE_COMMAND",
          cmd: "print",
        });
      break;
    case "view-source":
      browser.tabs.create({ url: "view-source:" + senderTab.url });
      break;
    case "open-downloads":
      browser.tabs.create({ url: "about:downloads" });
      break;
    case "open-history":
      browser.tabs.create({ url: "about:history" });
      break;
    case "open-bookmarks":
      browser.tabs.create({ url: "about:bookmarks" });
      break;
    case "open-extensions":
      browser.tabs.create({ url: "about:addons" });
      break;
    case "open-themes":
      browser.tabs.create({ url: "about:addons" }); // themes are in addons
      break;
    case "open-addons":
      browser.tabs.create({ url: "about:addons" });
      break;
    case "open-console":
      browser.tabs.create({ url: "about:debugging" });
      break;
    case "open-settings":
      browser.tabs.create({ url: "about:preferences" });
      break;
    case "open-quick-commands-settings":
      await browser.runtime.openOptionsPage();
      break;
    case "open-privacy":
      browser.tabs.create({ url: "about:preferences#privacy" });
      break;
    case "open-passwords":
      browser.tabs.create({ url: "about:logins" });
      break;
    case "open-sync":
      browser.tabs.create({ url: "about:preferences#sync" });
      break;
    case "open-tasks":
      browser.tabs.create({ url: "about:performance" });
      break;
    case "new-window":
      browser.windows.create({});
      break;
    case "new-private":
      browser.windows.create({ incognito: true });
      break;
    case "close-window":
      if (senderTab) browser.windows.remove(senderTab.windowId);
      break;
    default:
      break;
  }
}
