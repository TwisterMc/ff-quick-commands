// content.js
// Injects and manages the Quick Commands overlay UI

(function () {
  // Prevent double-injection
  if (window.__quickCommandsLoaded) return;
  window.__quickCommandsLoaded = true;

  let overlay = null;
  let input = null;
  let list = null;
  let selectedIndex = -1;
  let currentResults = [];
  let displayedResults = [];
  let debounceTimer = null;
  let previousFocus = null;
  let requestToken = 0;

  // ── MESSAGE LISTENER ─────────────────────────────────────────────────────
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === "PING") {
      return Promise.resolve({ ok: true });
    }

    if (message.type === "OPEN_QUICK_COMMANDS") {
      if (overlay && overlay.classList.contains("qc-visible")) {
        focusSearchInput();
      } else {
        open();
      }
    }

    if (message.type === "CLOSE_QUICK_COMMANDS") {
      if (overlay && overlay.classList.contains("qc-visible")) {
        close();
      }
    }

    if (message.type === "TOGGLE_QUICK_COMMANDS") {
      if (overlay && overlay.classList.contains("qc-visible")) {
        close();
      } else {
        open();
      }
    }
    if (message.type === "PAGE_COMMAND") {
      handlePageCommand(message.cmd);
    }
  });

  // ── OPEN / CLOSE ──────────────────────────────────────────────────────────
  function open() {
    if (!overlay) buildOverlay();
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    overlay.classList.add("qc-visible");
    input.value = "";
    input.setAttribute("aria-expanded", "true");
    focusSearchInput();
    selectedIndex = -1;
    fetchAndRender("");
  }

  function focusSearchInput() {
    input.focus({ preventScroll: true });
    input.select();
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
    });
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("qc-visible");
    input.blur();
    input.setAttribute("aria-expanded", "false");
    currentResults = [];
    displayedResults = [];
    selectedIndex = -1;
    input.removeAttribute("aria-activedescendant");
    if (list) list.innerHTML = "";

    if (previousFocus) {
      previousFocus.focus();
      previousFocus = null;
    }
  }

  // ── BUILD DOM ─────────────────────────────────────────────────────────────
  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.id = "qc-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Quick Commands");

    const modal = document.createElement("div");
    modal.id = "qc-modal";

    // Header
    const header = document.createElement("div");
    header.id = "qc-header";

    const searchIcon = document.createElement("span");
    searchIcon.id = "qc-search-icon";
    searchIcon.appendChild(createIconSvg("search"));

    input = document.createElement("input");
    input.id = "qc-input";
    input.type = "text";
    input.placeholder = "Search tabs, bookmarks, history, commands…";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "qc-list");

    const hint = document.createElement("span");
    hint.id = "qc-hint";
    hint.appendChild(buildKbd("↑"));
    hint.appendChild(buildKbd("↓"));
    hint.appendChild(document.createTextNode(" navigate  "));
    hint.appendChild(buildKbd("↵"));
    hint.appendChild(document.createTextNode(" select  "));
    hint.appendChild(buildKbd("esc"));
    hint.appendChild(document.createTextNode(" close"));

    header.appendChild(searchIcon);
    header.appendChild(input);
    header.appendChild(hint);

    // Filter chips
    const chips = document.createElement("div");
    chips.id = "qc-chips";
    const filters = [
      { label: "All", value: "" },
      { label: "Tabs", value: "tab:" },
      { label: "Bookmarks", value: "bookmark:" },
      { label: "History", value: "history:" },
      { label: "Commands", value: "cmd:" },
    ];
    filters.forEach(({ label, value }) => {
      const chip = document.createElement("button");
      chip.className = "qc-chip" + (value === "" ? " qc-chip-active" : "");
      chip.textContent = label;
      chip.dataset.filter = value;
      chip.addEventListener("click", () => {
        chips
          .querySelectorAll(".qc-chip[data-filter]")
          .forEach((c) => c.classList.remove("qc-chip-active"));
        chip.classList.add("qc-chip-active");
        const currentText = input.value.replace(
          /^(tab:|bookmark:|history:|cmd:|bkm:|tb:|command:)\s*/i,
          "",
        );
        input.value = value + currentText;
        input.focus();
        fetchAndRender(input.value);
      });
      chips.appendChild(chip);
    });

    const settingsChip = document.createElement("button");
    settingsChip.className = "qc-chip qc-chip-settings";
    settingsChip.type = "button";
    settingsChip.setAttribute("aria-label", "Open Quick Commands Settings");
    settingsChip.title = "Quick Commands Settings";

    const settingsIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    settingsIcon.setAttribute("viewBox", "0 0 24 24");
    settingsIcon.setAttribute("aria-hidden", "true");
    settingsIcon.classList.add("qc-settings-icon");

    const settingsPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    settingsPath.setAttribute(
      "d",
      "M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.18 7.18 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94c0 .32.02.63.05.94L2.83 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z",
    );

    settingsIcon.appendChild(settingsPath);
    settingsChip.appendChild(settingsIcon);

    settingsChip.addEventListener("click", async () => {
      try {
        await browser.runtime.sendMessage({
          type: "EXECUTE_COMMAND",
          command: "open-quick-commands-settings",
          payload: {},
        });
      } finally {
        close();
      }
    });
    chips.appendChild(settingsChip);

    // Results list
    list = document.createElement("ul");
    list.id = "qc-list";
    list.setAttribute("role", "listbox");

    modal.appendChild(header);
    modal.appendChild(chips);
    modal.appendChild(list);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // ── EVENTS ───────────────────────────────────────────────────────────
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchAndRender(input.value), 120);

      // Sync chip highlights based on typed prefix
      const val = input.value.toLowerCase();
      chips.querySelectorAll(".qc-chip[data-filter]").forEach((c) => {
        const f = c.dataset.filter.toLowerCase();
        c.classList.toggle(
          "qc-chip-active",
          f === "" ? !detectPrefix(val) : val.startsWith(f),
        );
      });
    });

    input.addEventListener("keydown", handleKeydown);

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay?.classList.contains("qc-visible")) {
        e.preventDefault();
        close();
      }
    });
  }

  function buildKbd(label) {
    const kbd = document.createElement("kbd");
    kbd.textContent = label;
    return kbd;
  }

  function detectPrefix(val) {
    return /^(tab:|bookmark:|history:|cmd:|bkm:|tb:|command:)/i.test(val);
  }

  // ── KEYBOARD NAVIGATION ───────────────────────────────────────────────────
  function handleKeydown(e) {
    const items = list.querySelectorAll(".qc-item");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && displayedResults[selectedIndex]) {
        activateResult(displayedResults[selectedIndex]);
      }
    } else if (e.key === "Tab") {
      // Auto-complete selected item
      e.preventDefault();
      if (selectedIndex >= 0 && displayedResults[selectedIndex]) {
        const r = displayedResults[selectedIndex];
        if (r.type === "tab" || r.type === "history" || r.type === "bookmark") {
          input.value = r.subtitle || "";
          fetchAndRender(input.value);
        }
      }
    }
  }

  function updateSelection(items) {
    items.forEach((el, i) => {
      el.classList.toggle("qc-selected", i === selectedIndex);
      el.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
      if (i === selectedIndex) el.scrollIntoView({ block: "nearest" });
    });

    const activeItem = selectedIndex >= 0 ? items[selectedIndex] : null;
    if (activeItem) {
      input.setAttribute("aria-activedescendant", activeItem.id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  // ── FETCH & RENDER ────────────────────────────────────────────────────────
  async function fetchAndRender(rawQuery) {
    const token = ++requestToken;
    const { query, filter } = parseQuery(rawQuery);
    let results = [];

    try {
      results = await browser.runtime.sendMessage({
        type: "FETCH_DATA",
        query,
        filter,
      });
    } catch (_) {
      results = [];
    }

    if (token !== requestToken) return;

    currentResults = results || [];
    selectedIndex = currentResults.length > 0 ? 0 : -1;
    renderResults(currentResults, query);
  }

  function parseQuery(raw) {
    const prefixes = {
      "tab:": "tab",
      "tb:": "tab",
      "bookmark:": "bookmark",
      "bkm:": "bookmark",
      "history:": "history",
      "hist:": "history",
      "cmd:": "cmd",
      "command:": "cmd",
    };
    const lower = raw.toLowerCase();
    for (const [prefix, filter] of Object.entries(prefixes)) {
      if (lower.startsWith(prefix)) {
        return { query: raw.slice(prefix.length).trim(), filter };
      }
    }
    return { query: raw.trim(), filter: null };
  }

  function renderResults(results, query) {
    list.innerHTML = "";
    selectedIndex = -1;
    displayedResults = [];

    if (!results.length) {
      const empty = document.createElement("li");
      empty.className = "qc-empty";
      empty.textContent = query
        ? "No results found"
        : "Start typing to search…";
      list.appendChild(empty);
      return;
    }

    const bestResult = results[0];

    // Group by type
    const groups = groupResults(results);
    for (const [groupLabel, items] of groups) {
      if (!items.length) {
        continue;
      }

      const groupHeader = document.createElement("li");
      groupHeader.className = "qc-group-header";
      groupHeader.textContent = groupLabel;
      list.appendChild(groupHeader);

      items.forEach((result) => {
        const displayIndex = displayedResults.length;
        displayedResults.push(result);
        const li = buildResultItem(result, query, displayIndex);
        list.appendChild(li);
      });
    }

    const bestDisplayedIndex = displayedResults.indexOf(bestResult);
    selectedIndex = bestDisplayedIndex >= 0 ? bestDisplayedIndex : 0;

    const items = list.querySelectorAll(".qc-item");
    updateSelection(items);
  }

  function groupResults(results) {
    const groups = new Map([
      ["Bookmarks", []],
      ["Tabs", []],
      ["Commands", []],
      ["History", []],
      ["Recently Closed Tabs", []],
    ]);

    for (const r of results) {
      const label = groupLabelForType(r.type);
      if (!groups.has(label)) {
        groups.set(label, []);
      }
      groups.get(label).push(r);
    }

    return groups;
  }

  function groupLabelForType(type) {
    return (
      {
        tab: "Tabs",
        "closed-tab": "Recently Closed Tabs",
        bookmark: "Bookmarks",
        history: "History",
        command: "Commands",
      }[type] || "Other"
    );
  }

  function buildResultItem(result, query, displayIndex) {
    const li = document.createElement("li");
    li.className = "qc-item";
    li.setAttribute("role", "option");
    li.id = `qc-option-${displayIndex}`;
    li.setAttribute("aria-selected", "false");

    // Icon / Favicon
    const iconEl = document.createElement("span");
    iconEl.className = "qc-item-icon";
    if (result.icon) {
      const img = document.createElement("img");
      img.src = result.icon;
      img.width = 16;
      img.height = 16;
      img.onerror = () => {
        iconEl.replaceChildren(createIconSvg(iconNameForType(result.type)));
      };
      iconEl.appendChild(img);
    } else {
      iconEl.appendChild(createIconSvg(iconNameForType(result.type)));
    }

    const text = document.createElement("span");
    text.className = "qc-item-text";

    const title = document.createElement("span");
    title.className = "qc-item-title";
    title.innerHTML = highlight(result.title || "", query);

    const subtitle = document.createElement("span");
    subtitle.className = "qc-item-subtitle";
    subtitle.textContent = truncate(result.subtitle || "", 70);

    text.appendChild(title);
    text.appendChild(subtitle);

    const badge = document.createElement("span");
    badge.className = "qc-item-badge";
    badge.textContent = badgeLabel(result.type);

    li.appendChild(iconEl);
    li.appendChild(text);
    li.appendChild(badge);

    li.addEventListener("mouseenter", () => {
      selectedIndex = displayIndex;
      updateSelection(list.querySelectorAll(".qc-item"));
    });

    li.addEventListener("click", () => activateResult(result));

    return li;
  }

  function iconNameForType(type) {
    return (
      {
        tab: "tab",
        "closed-tab": "closed-tab",
        bookmark: "bookmark",
        history: "history",
        command: "command",
      }[type] || "dot"
    );
  }

  function createIconSvg(iconName) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("qc-icon-svg");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", iconPath(iconName));
    svg.appendChild(path);

    return svg;
  }

  function iconPath(iconName) {
    const paths = {
      search:
        "M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.24a1 1 0 1 1-1.41 1.41l-4.24-4.24A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z",
      tab: "M4 5a2 2 0 0 1 2-2h4.7c.53 0 1.04.21 1.41.59l1.3 1.3c.19.19.44.3.71.3H18a2 2 0 0 1 2 2v1H4V5zm0 5h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9z",
      "closed-tab":
        "M12 4a8 8 0 1 1-7.75 10h2.06A6 6 0 1 0 12 6V3l4 3.5-4 3.5V8a4 4 0 1 0 3.87 5h2.03A6 6 0 1 1 12 8.09V4z",
      bookmark: "M6 3a2 2 0 0 0-2 2v16l8-4 8 4V5a2 2 0 0 0-2-2H6z",
      history:
        "M12 4a8 8 0 1 1-7.75 10H2l3.25-3.25L8.5 14H6.31A6 6 0 1 0 12 6v2l4-3.5L12 1v3zm-1 4h2v5h4v2h-6V8z",
      command: "M13 2 4 14h6l-1 8 9-12h-6l1-8z",
      dot: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
    };

    return paths[iconName] || paths.dot;
  }

  function badgeLabel(type) {
    return (
      {
        tab: "Tab",
        "closed-tab": "Closed",
        bookmark: "Bookmark",
        history: "History",
        command: "Command",
      }[type] || ""
    );
  }

  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQ = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(
      new RegExp(`(${escapedQ})`, "gi"),
      "<mark>$1</mark>",
    );
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function truncate(str, max) {
    return str.length > max ? "…" + str.slice(str.length - max + 1) : str;
  }

  // ── ACTIVATE RESULT ───────────────────────────────────────────────────────
  async function activateResult(result) {
    close();

    if (result.type === "tab") {
      await browser.runtime.sendMessage({
        type: "EXECUTE_COMMAND",
        command: "__switch-tab__",
        payload: { tabId: result.id, windowId: result.windowId },
      });
    } else if (result.type === "closed-tab") {
      await browser.runtime.sendMessage({
        type: "EXECUTE_COMMAND",
        command: "__restore-session__",
        payload: { sessionId: result.sessionId },
      });
    } else if (result.type === "bookmark" || result.type === "history") {
      await browser.runtime.sendMessage({
        type: "EXECUTE_COMMAND",
        command: "__open-url__",
        payload: { url: result.url },
      });
    } else if (result.type === "command") {
      await browser.runtime.sendMessage({
        type: "EXECUTE_COMMAND",
        command: result.commandId,
        payload: {},
      });
    }
  }

  // ── PAGE COMMANDS (received from background) ──────────────────────────────
  function handlePageCommand(cmd) {
    switch (cmd) {
      case "back":
        window.history.back();
        break;
      case "forward":
        window.history.forward();
        break;
      case "stop":
        window.stop();
        break;
      case "scrollTop":
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "scrollBottom":
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
        break;
      case "fullscreen":
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen();
        break;
      case "print":
        window.print();
        break;
    }
  }
})();
