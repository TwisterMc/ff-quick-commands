### Filter prefixes (type these to narrow results)

| Prefix      | Alias      | Filters to         |
| ----------- | ---------- | ------------------ |
| `tab:`      | `tb:`      | Open & closed tabs |
| `bookmark:` | `bkm:`     | Bookmarks          |
| `history:`  | `hist:`    | Browsing history   |
| `cmd:`      | `command:` | Browser commands   |

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
├── options.html/js   — User settings page (search source toggles)
├── popup.html/js     — Fallback for about: pages
└── icons/            — Extension icons
```

## Packaging for AMO

```bash
zip -r quick-commands.zip manifest.json background.js content.js overlay.css popup.html popup.js options.html options.js icons/
```

Then submit `quick-commands.zip` at https://addons.mozilla.org/developers/
