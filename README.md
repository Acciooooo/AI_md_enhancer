# DeepSeek Markdown Enhancer

A lightweight Chrome / Edge (Manifest V3) extension that adds a Markdown editor with live preview to [chat.deepseek.com](https://chat.deepseek.com).

## Features

- **Expand toggle** — icon button at the top-right of DeepSeek’s input area
- **Custom Markdown editor** — ~3× the original input height, with a live preview pane
- **LaTeX math (KaTeX)** — inline `$E=mc^2$` and block `$$...$$`, bundled offline (no CDN)
- **Reversed shortcuts**
  - `Enter` → newline
  - `Ctrl+Enter` / `⌘+Enter` → send
- **Debounced preview** (500 ms) via bundled Markdown + KaTeX parsers
- **Formatting toolbar** — code block, table, heading snippets
- **Native submit sync** — copies text into DeepSeek’s textarea, dispatches React-friendly events, then clicks the native send button

## Project structure

```
deepseek-md-enhancer/
├── manifest.json
├── content.js
├── styles.css
├── marked.min.js
├── katex/
│   ├── katex.min.js
│   ├── katex.min.css
│   └── fonts/
├── icons/
└── README.md
```

## Math examples

```md
Inline: $E = mc^2$

Block:
$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$
```

`$` inside fenced code blocks is left alone (not rendered as math).

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
- Selectors prefer `textarea[placeholder*="DeepSeek"]` and DOM traversal for the send button
- Injected UI uses the `md-enhancer-*` class prefix for CSS isolation
- `marked.min.js` and `katex/` are bundled locally — no remote script loading
- KaTeX CSS is injected at runtime with `chrome.runtime.getURL` so font files resolve under MV3

## License

MIT
