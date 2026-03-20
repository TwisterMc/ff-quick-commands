# Quick Commands for Firefox

A Vivaldi-inspired Quick Commands palette for Firefox. Press **Shift+Cmd+K** (Mac) or **Shift+Ctrl+K** (Windows/Linux) to open it from any page.

---

## Features

| Category        | What it does                                                       |
| --------------- | ------------------------------------------------------------------ |
| **Open Tabs**   | Search and switch to any open tab in the current window            |
| **Closed Tabs** | Reopen recently closed tabs                                        |
| **Bookmarks**   | Search and open any bookmark                                       |
| **History**     | Full-text search your browsing history                             |
| **Commands**    | Browser commands for tabs, navigation, zoom, settings, and windows |

### Filter prefixes (type these to narrow results)

| Prefix      | Alias      | Filters to         |
| ----------- | ---------- | ------------------ |
| `tab:`      | `tb:`      | Open & closed tabs |
| `bookmark:` | `bkm:`     | Bookmarks          |
| `history:`  | `hist:`    | Browsing history   |
| `cmd:`      | `command:` | Browser commands   |

### Keyboard shortcuts in the palette

| Key           | Action                              |
| ------------- | ----------------------------------- |
| `↑` / `↓`     | Navigate results                    |
| `Enter`       | Select / activate                   |
| `Tab`         | Auto-complete URL into search field |
| `Esc`         | Close palette                       |
| Click outside | Close palette                       |

---

## Installation (temporary / development)

1. Open Firefox and go to `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Navigate to this folder and select `manifest.json`
4. The extension is now active — press **Shift+Cmd+K** (or **Shift+Ctrl+K**) on any page

On restricted Firefox pages (`about:*`), use the extension page prompt to open Quick Commands on your most recent normal tab.

For permanent installation, package and submit to [addons.mozilla.org](https://addons.mozilla.org).

---

## Files

```
ff-quick-commands/
├── manifest.json     — Extension metadata, permissions, shortcut
├── background.js     — Shortcut handler, data fetching, command execution
├── content.js        — Overlay UI injected into web pages
├── overlay.css       — Palette styles
├── popup.html/js     — Fallback for about: pages
└── icons/            — Extension icons
```

## Packaging for AMO

```bash
zip -r quick-commands.zip manifest.json background.js content.js overlay.css popup.html popup.js icons/
```

Then submit `quick-commands.zip` at https://addons.mozilla.org/developers/
