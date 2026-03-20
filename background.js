// background.js
// Handles keyboard shortcut, browser action click, and data fetching for content script

browser.commands.onCommand.addListener((command) => {
  if (command === "open-quick-commands") {
    openQuickCommands();
  }
});

browser.browserAction.onClicked.addListener(() => {
  openQuickCommands();
});

const DEFAULT_SEARCH_SETTINGS = {
  searchTabs: true,
  searchClosedTabs: true,
  searchBookmarks: true,
  searchCommands: true,
  searchHistory: true,
};

const activeTabByWindowId = new Map();
const fetchDataCache = new Map();
const FETCH_DATA_CACHE_TTL_MS = 1000;
const VEMETRIC_FAVICON_API_BASE_URL = "https://favicon.vemetric.com";

function clearFetchDataCache() {
  fetchDataCache.clear();
}

function getFetchDataCacheKey(query, filter, settings) {
  return JSON.stringify({
    query: String(query || "")
      .trim()
      .toLowerCase(),
    filter: filter || null,
    settings,
  });
}

function cloneResult(result) {
  return {
    ...result,
    icon: Array.isArray(result.icon) ? [...result.icon] : result.icon,
  };
}

function getCachedFetchData(cacheKey) {
  const cachedEntry = fetchDataCache.get(cacheKey);
  if (!cachedEntry) return null;

  if (Date.now() - cachedEntry.timestamp > FETCH_DATA_CACHE_TTL_MS) {
    fetchDataCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.results.map(cloneResult);
}

function setCachedFetchData(cacheKey, results) {
  fetchDataCache.set(cacheKey, {
    timestamp: Date.now(),
    results: results.map(cloneResult),
  });
}

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
    url.startsWith("chrome:") ||
    url.startsWith("resource:")
  );
}

function getResultIconCandidates(url, preferredIconUrl = null) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    const candidates = [];

    if (preferredIconUrl) {
      candidates.push(preferredIconUrl);
    }

    candidates.push(
      `${VEMETRIC_FAVICON_API_BASE_URL}/${encodeURIComponent(parsedUrl.hostname)}?size=32&format=png`,
      `${parsedUrl.origin}/favicon.ico`,
      `${parsedUrl.origin}/favicon.svg`,
    );

    return [...new Set(candidates.filter(Boolean))];
  } catch (_) {
    return null;
  }
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

async function openQuickCommands() {
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
      type: "OPEN_QUICK_COMMANDS",
    });
  } catch (err) {
    console.error("Unable to open Quick Commands overlay:", err);
  }
}

async function closeQuickCommandsInTab(tabId) {
  if (!tabId || tabId < 0) return;

  try {
    await browser.tabs.sendMessage(tabId, {
      type: "CLOSE_QUICK_COMMANDS",
    });
  } catch (_) {
    // Tab does not have the content script injected; nothing to close.
  }
}

browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  clearFetchDataCache();
  const previousTabId = activeTabByWindowId.get(windowId);
  activeTabByWindowId.set(windowId, tabId);

  if (previousTabId && previousTabId !== tabId) {
    await closeQuickCommandsInTab(previousTabId);
  }
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  clearFetchDataCache();
  if (activeTabByWindowId.get(removeInfo.windowId) === tabId) {
    activeTabByWindowId.delete(removeInfo.windowId);
  }
});

browser.tabs.onCreated.addListener(() => {
  clearFetchDataCache();
});

browser.tabs.onUpdated.addListener(() => {
  clearFetchDataCache();
});

browser.tabs.onMoved.addListener(() => {
  clearFetchDataCache();
});

browser.tabs.onAttached.addListener(() => {
  clearFetchDataCache();
});

browser.tabs.onDetached.addListener(() => {
  clearFetchDataCache();
});

browser.bookmarks.onCreated.addListener(() => {
  clearFetchDataCache();
});

browser.bookmarks.onRemoved.addListener(() => {
  clearFetchDataCache();
});

browser.bookmarks.onChanged.addListener(() => {
  clearFetchDataCache();
});

browser.bookmarks.onMoved.addListener(() => {
  clearFetchDataCache();
});

browser.history.onVisited.addListener(() => {
  clearFetchDataCache();
});

browser.history.onVisitRemoved.addListener(() => {
  clearFetchDataCache();
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (
    changes.searchTabs ||
    changes.searchClosedTabs ||
    changes.searchBookmarks ||
    changes.searchCommands ||
    changes.searchHistory
  ) {
    clearFetchDataCache();
  }
});

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
  const cacheKey = getFetchDataCacheKey(q, filter, settings);
  const cachedResults = getCachedFetchData(cacheKey);

  if (cachedResults) {
    return cachedResults;
  }

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
            icon: getResultIconCandidates(tab.url, tab.favIconUrl),
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
              icon: getResultIconCandidates(t.url, t.favIconUrl),
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
            icon: getResultIconCandidates(bm.url),
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
            icon: getResultIconCandidates(item.url),
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
      const typePriorityDiff =
        getTypeTieBreakPriority(a.type) - getTypeTieBreakPriority(b.type);
      if (typePriorityDiff !== 0) return typePriorityDiff;
      return a._sortIndex - b._sortIndex;
    });

    results.forEach((result) => {
      delete result._score;
      delete result._sortIndex;
    });
  }

  setCachedFetchData(cacheKey, results);

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

function getTypeTieBreakPriority(type) {
  return (
    {
      bookmark: 0,
      tab: 1,
      command: 2,
      history: 3,
      "closed-tab": 4,
    }[type] ?? 5
  );
}

function getBuiltinCommands() {
  return [
    // Tabs
    {
      id: "new-tab",
      label: "New Tab",
      description: "Open a new tab",
    },
    {
      id: "close-tab",
      label: "Close Tab",
      description: "Close the current tab",
    },
    {
      id: "reopen-tab",
      label: "Reopen Closed Tab",
      description: "Restore the last closed tab",
    },
    {
      id: "duplicate-tab",
      label: "Duplicate Tab",
      description: "Duplicate the current tab",
    },
    {
      id: "pin-tab",
      label: "Pin / Unpin Tab",
      description: "Toggle pin on current tab",
    },
    {
      id: "mute-tab",
      label: "Mute / Unmute Tab",
      description: "Toggle mute on current tab",
    },
    {
      id: "next-tab",
      label: "Next Tab",
      description: "Switch to the next tab",
    },
    {
      id: "prev-tab",
      label: "Prev Tab",
      description: "Switch to the previous tab",
    },
    // Navigation
    {
      id: "go-back",
      label: "Go Back",
      description: "Navigate back",
    },
    {
      id: "go-forward",
      label: "Go Forward",
      description: "Navigate forward",
    },
    {
      id: "reload",
      label: "Reload Page",
      description: "Reload the current page",
    },
    {
      id: "hard-reload",
      label: "Hard Reload",
      description: "Bypass cache and reload",
    },
    {
      id: "stop",
      label: "Stop Loading",
      description: "Stop the current page load",
    },
    {
      id: "scroll-top",
      label: "Scroll to Top",
      description: "Jump to top of page",
    },
    {
      id: "scroll-bottom",
      label: "Scroll to Bottom",
      description: "Jump to bottom of page",
    },
    // Page
    {
      id: "zoom-in",
      label: "Zoom In",
      description: "Increase page zoom",
    },
    {
      id: "zoom-out",
      label: "Zoom Out",
      description: "Decrease page zoom",
    },
    {
      id: "zoom-reset",
      label: "Reset Zoom",
      description: "Reset page zoom to 100%",
    },
    {
      id: "fullscreen",
      label: "Toggle Fullscreen",
      description: "Enter or exit fullscreen",
    },
    {
      id: "reader-mode",
      label: "Toggle Reader Mode",
      description: "Enter reader view",
    },
    {
      id: "print-page",
      label: "Print Page",
      description: "Print the current page",
    },
    {
      id: "view-source",
      label: "View Page Source",
      description: "View source code",
    },
    // Tools & UI
    {
      id: "open-quick-commands-settings",
      label: "Quick Commands Settings",
      description: "Open Quick Commands preferences",
    },
    // Window
    {
      id: "new-window",
      label: "New Window",
      description: "Open a new browser window",
    },
    {
      id: "new-private",
      label: "New Private Window",
      description: "Open a private window",
    },
    {
      id: "close-window",
      label: "Close Window",
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
        const targetUrl = String(payload.url);
        const isInternalUrl =
          /^(about:|moz-extension:|chrome:|resource:|view-source:)/i.test(
            targetUrl,
          );

        if (isInternalUrl) {
          await browser.tabs.create({ url: targetUrl });
        } else if (senderTab?.id) {
          await browser.tabs.update(senderTab.id, { url: targetUrl });
        } else {
          await browser.tabs.create({ url: targetUrl });
        }
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
    case "open-quick-commands-settings":
      await browser.runtime.openOptionsPage();
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
