const openButton = document.getElementById("open-on-tab");
const statusEl = document.getElementById("status");

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function openOnNormalTab() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const realTab = tabs
    .slice()
    .reverse()
    .find(
      (t) =>
        t.url &&
        !t.url.startsWith("about:") &&
        !t.url.startsWith("moz-extension:"),
    );

  if (!realTab) {
    setStatus("No normal tab found in this window.");
    return;
  }

  await browser.tabs.update(realTab.id, { active: true });
  await browser.tabs.sendMessage(realTab.id, { type: "TOGGLE_QUICK_COMMANDS" });
  window.close();
}

if (openButton) {
  openButton.addEventListener("click", () => {
    openOnNormalTab().catch((err) => {
      console.error("Quick Commands popup fallback failed:", err);
      setStatus("Couldn't open Quick Commands on that tab.");
    });
  });
}
