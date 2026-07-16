# DeepSeek Markdown Enhancer

A lightweight Chrome / Edge (Manifest V3) extension that adds a Markdown editor with live preview to [chat.deepseek.com](https://chat.deepseek.com).

## Features

- **Expand toggle** — icon button at the top-right of DeepSeek’s input area
- **Custom Markdown editor** — ~3× the original input height, with a live preview pane
- **Reversed shortcuts**
  - `Enter` → newline
  - `Ctrl+Enter` / `⌘+Enter` → send
- **Debounced preview** (500 ms) via a bundled local Markdown parser (no CDN)
- **Formatting toolbar** — code block, table, heading snippets
- **Native submit sync** — copies text into DeepSeek’s textarea, dispatches React-friendly events, then clicks the native send button

## Project structure

```
deepseek-md-enhancer/
├── manifest.json      # MV3 extension config
├── content.js         # UI injection, shortcuts, sync, debounce
├── styles.css         # Isolated .md-enhancer-* styles
├── marked.min.js      # Lightweight local Markdown → HTML parser
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Install (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `deepseek-md-enhancer` folder
5. Visit https://chat.deepseek.com and click the expand (⛶) icon on the chat input

## Install (Edge)

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `deepseek-md-enhancer` folder

## Usage

1. Click the **expand** button on the native input box
2. Write Markdown in the left pane — preview updates after 500 ms idle
3. Use the toolbar to insert code / table / heading snippets
4. Press **Ctrl+Enter** (or **⌘+Enter**) or click **Send**
5. The extension restores the native input after sending (or when you close the editor)

## Technical notes

- Host permission is limited to `https://chat.deepseek.com/*`
- Selectors prefer `textarea[placeholder*="DeepSeek"]` and DOM traversal for the send button so class-name churn is less likely to break the extension
- Injected UI uses the `md-enhancer-*` class prefix for CSS isolation
- `marked.min.js` is a self-contained parser exposing `window.marked.parse()` — no remote script loading

## License

MIT
