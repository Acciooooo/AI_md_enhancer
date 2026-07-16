/**
 * Universal AI Markdown Enhancer — content script
 * Uses strategy adapters for DeepSeek / ChatGPT / Claude.
 */
(function () {
  "use strict";

  const NS = "md-enhancer";
  const EXTEND_BTN_CLASS = "my-custom-extension-btn";
  const PREVIEW_DEBOUNCE_MS = 500;
  const HEIGHT_MULTIPLIER = 3;
  /** Wait past React/Next.js hydration before first inject */
  const HYDRATION_SETTLE_MS = 2000;
  const IDLE_CALLBACK_TIMEOUT_MS = 4000;
  /** Debounce MutationObserver bursts (SPA route swaps) */
  const MO_DEBOUNCE_MS = 400;

  /** @type {{
   *   originalInput: HTMLElement | null,
   *   originalContainer: HTMLElement | null,
   *   adapter: ReturnType<typeof resolveAdapter> | null,
   *   expandBtn: HTMLButtonElement | null,
   *   hostRoot: HTMLElement | null,
   *   wrapper: HTMLElement | null,
   *   customTextarea: HTMLTextAreaElement | null,
   *   preview: HTMLElement | null,
   *   submitBtn: HTMLButtonElement | null,
   *   isOpen: boolean,
   *   debounceTimer: number | null,
   *   observer: MutationObserver | null,
   *   moDebounceTimer: number | null,
   *   isInjecting: boolean,
   *   layoutSyncActive: boolean,
   *   onLayoutSync: (() => void) | null,
   *   originalHeight: number
   * }} */
  const state = {
    originalInput: null,
    originalContainer: null,
    adapter: null,
    expandBtn: null,
    hostRoot: null,
    wrapper: null,
    customTextarea: null,
    preview: null,
    submitBtn: null,
    isOpen: false,
    debounceTimer: null,
    observer: null,
    moDebounceTimer: null,
    isInjecting: false,
    layoutSyncActive: false,
    onLayoutSync: null,
    originalHeight: 0,
  };

  /** Track inputs we have bound without mutating host DOM attributes */
  const boundInputs = new WeakSet();

  const SNIPPETS = {
    code:
      "```\n//your code here\n```",
    table:
      "| Header 1 | Header 2 | Header 3 |\n" +
      "| -------- | -------- | -------- |\n" +
      "| Cell 1   | Cell 2   | Cell 3   |\n" +
      "| Cell 4   | Cell 5   | Cell 6   |",
    heading: "### New Heading",
  };

  const siteAdapters = {
    deepseek: {
      id: "deepseek",
      hostPattern: /(^|\.)chat\.deepseek\.com$/i,
      selectors: {
        input: [
          'textarea[placeholder*="DeepSeek" i]',
          'textarea[placeholder*="Message" i]',
          "textarea",
        ],
        container: [
          '[data-testid*="chat-input" i]',
          'form:has(textarea)',
        ],
        submit: [
          'button[aria-label*="send" i]',
          '[role="button"][aria-label*="send" i]',
          ".ds-button",
          ".ds-icon-button",
          "button",
          '[role="button"]',
        ],
      },
    },
    chatgpt: {
      id: "chatgpt",
      hostPattern: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/i,
      layout: {
        buttonPlacement: "outside-right",
        buttonGap: 6,
      },
      selectors: {
        input: [
          'div#prompt-textarea[contenteditable="true"]',
          'div#prompt-textarea.ProseMirror',
          "#prompt-textarea",
          '[contenteditable="true"][data-testid="prompt-textarea"]',
          'div.ProseMirror[contenteditable="true"]',
          'textarea[data-testid="prompt-textarea"]',
          "textarea",
        ],
        container: [
          '[data-testid="composer"]',
          'form:has(#prompt-textarea)',
          "form",
        ],
        submit: [
          'button[data-testid="send-button"]',
          'button[data-testid*="send" i]',
          'button[aria-label*="send" i]',
          'button[aria-label*="Send" i]',
          "button",
        ],
      },
    },
    doubao: {
      id: "doubao",
      hostPattern: /(^|\.)doubao\.com$/i,
      selectors: {
        input: [
          'textarea[data-testid="chat_input_input"]',
          'textarea[data-testid*="chat_input" i]',
          'textarea[placeholder*="问" i]',
          'textarea[placeholder*="输入" i]',
          'textarea[placeholder*="发消息" i]',
          '[contenteditable="true"][role="textbox"]',
          '[class*="chat-input" i] [contenteditable="true"]',
          '[contenteditable="true"]',
          "textarea",
        ],
        container: [
          '[data-testid*="chat_input" i]',
          '[class*="chat-input" i]',
          '[class*="input-area" i]',
          "form",
        ],
        submit: [
          'button[data-testid*="send" i]',
          'button[aria-label*="发送" i]',
          'button[aria-label*="send" i]',
          '[role="button"][aria-label*="发送" i]',
          "button",
          '[role="button"]',
        ],
      },
    },
    kimi: {
      id: "kimi",
      hostPattern: /(^|\.)kimi\.moonshot\.cn$|(^|\.)kimi\.com$/i,
      selectors: {
        input: [
          "div.chat-input-editor",
          '[class*="chat-input-editor" i]',
          '[class*="chat-input" i] [contenteditable="true"]',
          'textarea[placeholder*="尽管问" i]',
          'textarea[placeholder*="Ask" i]',
          'textarea[placeholder*="问" i]',
          'div[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"]',
          "textarea",
        ],
        container: [
          '[class*="chat-input" i]',
          '[class*="composer" i]',
          '[class*="prompt" i]',
          "form",
        ],
        submit: [
          'button[aria-label*="发送" i]',
          'button[aria-label*="send" i]',
          '[class*="send" i]',
          ".segment-actions-content-btn",
          "button[type='submit']",
          "button",
          '[role="button"]',
        ],
      },
    },
    gemini: {
      id: "gemini",
      hostPattern: /(^|\.)gemini\.google\.com$/i,
      layout: {
        mode: "replace-shell",
        shellSelectors: [
          "fieldset.input-area-container",
          ".input-area-container",
        ],
        buttonPlacement: "outside-right",
        buttonGap: 6,
        editorMinHeight: 360,
      },
      selectors: {
        input: [
          'rich-textarea .ql-editor[contenteditable="true"]',
          'rich-textarea [contenteditable="true"]',
          'div.ql-editor[contenteditable="true"]',
          'div[contenteditable="true"][role="textbox"]',
          'textarea[aria-label*="Ask" i]',
          "textarea",
        ],
        container: [
          "fieldset.input-area-container",
          ".input-area-container",
          'div.input-area[data-node-type="input-area"]',
          "input-area-v2",
        ],
        submit: [
          'button[aria-label*="Send message" i]',
          'button[aria-label*="Send" i]',
          'button[aria-label*="发送" i]',
          'button[mattooltip*="Send" i]',
          'button[data-tooltip*="Send" i]',
          ".send-button",
          "button",
        ],
      },
    },
    claude: {
      id: "claude",
      hostPattern: /(^|\.)claude\.ai$/i,
      selectors: {
        input: [
          '[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"][data-placeholder]',
          '[contenteditable="true"]',
          "textarea",
        ],
        container: [
          '[data-testid*="composer" i]',
          "form",
          "main",
        ],
        submit: [
          'button[aria-label*="send" i]',
          'button[aria-label*="发送" i]',
          '[data-testid*="send" i]',
          "button",
          '[role="button"]',
        ],
      },
    },
  };

  /* ─── utilities ─── */

  function debounce(fn, wait) {
    return function debounced(...args) {
      if (state.debounceTimer != null) {
        clearTimeout(state.debounceTimer);
      }
      state.debounceTimer = window.setTimeout(() => {
        state.debounceTimer = null;
        fn.apply(this, args);
      }, wait);
    };
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasExtensionButton() {
    return !!document.querySelector("." + EXTEND_BTN_CLASS);
  }

  function scheduleAfterHydration(fn) {
    const run = () => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(fn, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
      } else {
        fn();
      }
    };
    window.setTimeout(run, HYDRATION_SETTLE_MS);
  }

  function debounceMutationObserver(fn, wait) {
    return function onMutation() {
      if (state.moDebounceTimer != null) {
        clearTimeout(state.moDebounceTimer);
      }
      state.moDebounceTimer = window.setTimeout(() => {
        state.moDebounceTimer = null;
        fn();
      }, wait);
    };
  }

  function resolveAdapter() {
    const host = window.location.hostname;
    for (const key of Object.keys(siteAdapters)) {
      const adapter = siteAdapters[key];
      if (adapter.hostPattern.test(host)) return adapter;
    }
    return siteAdapters.deepseek;
  }

  function isReplaceShellMode(adapter) {
    return adapter?.layout?.mode === "replace-shell";
  }

  function findGeminiShell(input, adapter) {
    if (!input) return null;
    for (const sel of adapter.layout?.shellSelectors || []) {
      const matched = input.closest(sel);
      if (matched instanceof HTMLElement) return matched;
    }
    return (
      input.closest("fieldset.input-area-container") ||
      input.closest(".input-area-container")
    );
  }

  function resolveInjectContainer(input, adapter) {
    if (isReplaceShellMode(adapter)) {
      return findGeminiShell(input, adapter);
    }
    return findInputContainer(input, adapter);
  }

  function isEditorInput(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.closest("." + NS + "-wrapper")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el instanceof HTMLTextAreaElement) return true;
    return el.isContentEditable || el.getAttribute("contenteditable") === "true";
  }

  function findSiteInput(adapter) {
    for (const sel of adapter.selectors.input) {
      const nodes = document.querySelectorAll(sel);
      for (const node of nodes) {
        if (!isEditorInput(node)) continue;
        if (!isVisible(node) && node.offsetParent === null) continue;
        const rect = node.getBoundingClientRect();
        if (rect.top > window.innerHeight * 0.3 || nodes.length === 1) {
          return node;
        }
      }
    }

    // Last resort: largest visible editable element
    let best = null;
    let bestArea = 0;
    const candidates = document.querySelectorAll('textarea, [contenteditable="true"]');
    candidates.forEach((node) => {
      if (!isEditorInput(node)) return;
      const r = node.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = node;
      }
    });
    return best;
  }

  /**
   * Walk up from the input to a sensible shell container.
   * Does NOT mutate host styles (avoids hydration / layout conflicts).
   */
  function findInputContainer(input, adapter) {
    if (!input) return null;

    for (const sel of adapter.selectors.container || []) {
      const matched = input.closest(sel);
      if (matched instanceof HTMLElement) return matched;
    }

    let el = input.parentElement;
    let best = input.parentElement;
    let depth = 0;

    while (el && el !== document.body && depth < 8) {
      const style = window.getComputedStyle(el);
      const hasBorder =
        style.borderTopWidth !== "0px" ||
        style.borderRadius !== "0px" ||
        style.boxShadow !== "none" ||
        style.backgroundColor !== "rgba(0, 0, 0, 0)";

      const buttons = el.querySelectorAll('button, [role="button"]');
      if (hasBorder && buttons.length > 0) {
        best = el;
        break;
      }
      if (el.offsetHeight > 40 && el.offsetHeight < 320) {
        best = el;
      }
      el = el.parentElement;
      depth++;
    }

    return best;
  }

  /**
   * Find the native send control near the textarea.
   */
  function findNativeSubmitButton(input, adapter) {
    if (!input) return null;

    // Walk ancestors looking for an icon / send button
    let root = input.parentElement;
    for (let d = 0; d < 6 && root; d++) {
      const candidates = Array.from(root.querySelectorAll(adapter.selectors.submit.join(", ")));

      // Prefer the rightmost / bottommost interactive control that isn't our UI
      const filtered = candidates.filter((btn) => {
        if (btn.closest("." + NS + "-wrapper")) return false;
        if (btn.classList.contains(EXTEND_BTN_CLASS)) return false;
        if (btn.classList.contains(NS + "-expand-btn")) return false;
        if (!isVisible(btn)) return false;
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
        const title = (btn.getAttribute("title") || "").toLowerCase();
        const text = (btn.textContent || "").trim().toLowerCase();
        // Skip obvious non-send controls
        if (/stop|cancel|upload|attach|file|image|voice|mic|搜索|上传|停止/.test(aria + title + text)) {
          return false;
        }
        return true;
      });

      if (filtered.length) {
        // Prefer elements with send-like labels, else last child (usually send)
        const labeled = filtered.find((btn) => {
          const s =
            ((btn.getAttribute("aria-label") || "") +
              (btn.getAttribute("title") || "") +
              (btn.getAttribute("data-testid") || "") +
              (btn.textContent || "")).toLowerCase();
          return /send|submit|发送|发送消息/.test(s);
        });
        if (labeled) return labeled;

        // Geometric heuristic: rightmost visible button in the container
        filtered.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.right - ra.right || rb.bottom - ra.bottom;
        });
        return filtered[0];
      }
      root = root.parentElement;
    }

    return null;
  }

  function getNativeInputValue(input) {
    if (!input) return "";
    if (input instanceof HTMLTextAreaElement) return input.value || "";
    if (input instanceof HTMLInputElement) return input.value || "";
    if (input.isContentEditable) return input.textContent || "";
    return "";
  }

  /**
   * High-compat sync for textarea / input (React-style controlled components).
   */
  function syncTextareaLikeValue(input, value) {
    const proto =
      input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;

    try {
      const tracker = input._valueTracker;
      if (tracker) tracker.setValue("");
    } catch (_) {
      /* ignore */
    }

    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Process", bubbles: true }));
  }

  /**
   * High-compat sync for contenteditable (Claude / ChatGPT ProseMirror).
   * Prefer execCommand insertText so ProseMirror state updates correctly.
   */
  function syncContentEditableValue(input, value) {
    input.focus();

    try {
      const range = document.createRange();
      range.selectNodeContents(input);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {
      /* ignore selection failure */
    }

    let inserted = false;
    try {
      document.execCommand("selectAll", false, null);
      inserted = document.execCommand("insertText", false, value);
    } catch (_) {
      inserted = false;
    }

    if (!inserted) {
      input.textContent = value;
    }

    input.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: value,
      })
    );
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      })
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Process", bubbles: true }));
  }

  function syncNativeInputValue(input, value) {
    if (!input) return;
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      syncTextareaLikeValue(input, value);
      return;
    }
    if (input.isContentEditable || input.getAttribute("contenteditable") === "true") {
      syncContentEditableValue(input, value);
    }
  }

  /**
   * Inject KaTeX CSS with font URLs rewritten to chrome-extension://…
   * (content-script CSS relative font paths are unreliable in page context).
   */
  function ensureKatexStyles() {
    if (document.getElementById(NS + "-katex-css")) return;
    try {
      const cssUrl = chrome.runtime.getURL("katex/katex.min.css");
      const fontBase = chrome.runtime.getURL("katex/fonts/");
      fetch(cssUrl)
        .then((r) => r.text())
        .then((css) => {
          const style = document.createElement("style");
          style.id = NS + "-katex-css";
          style.textContent = css.replace(/url\(fonts\//g, "url(" + fontBase);
          (document.head || document.documentElement).appendChild(style);
        })
        .catch(() => {
          /* fonts may fall back; math HTML still renders */
        });
    } catch (_) {
      /* ignore if chrome.runtime unavailable */
    }
  }

  function parseMarkdownOnly(src) {
    if (typeof window.marked === "function") {
      return window.marked(src);
    }
    if (window.marked && typeof window.marked.parse === "function") {
      return window.marked.parse(src);
    }
    return "<pre>" + String(src).replace(/</g, "&lt;") + "</pre>";
  }

  function renderTex(tex, displayMode) {
    if (!window.katex || typeof window.katex.renderToString !== "function") {
      const tag = displayMode ? "pre" : "code";
      return (
        "<" +
        tag +
        " class=\"" +
        NS +
        "-math-fallback\">" +
        String(tex).replace(/&/g, "&amp;").replace(/</g, "&lt;") +
        "</" +
        tag +
        ">"
      );
    }
    try {
      return window.katex.renderToString(tex, {
        throwOnError: false,
        displayMode: !!displayMode,
        output: "html",
      });
    } catch (_) {
      return (
        "<code class=\"" +
        NS +
        "-math-error\">" +
        String(tex).replace(/&/g, "&amp;").replace(/</g, "&lt;") +
        "</code>"
      );
    }
  }

  /**
   * Pipeline: protect code → block $$ → inline $ → marked → restore.
   * Supports $...$ (inline) and $$...$$ (display).
   */
  function renderMarkdownWithMath(src) {
    const text = String(src || "");
    const slots = [];

    function stash(html) {
      const key = "%%MDENH" + slots.length + "%%";
      slots.push(html);
      return key;
    }

    // 1) Protect fenced code and inline code so $ inside them is ignored
    let work = text.replace(/```[\s\S]*?```/g, (m) => stash(m));
    work = work.replace(/`[^`\n]+`/g, (m) => stash(m));

    // 2) Block math $$...$$ (non-greedy, multiline)
    work = work.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) =>
      stash(renderTex(tex.trim(), true))
    );

    // 3) Inline math $...$ (no newlines; skip \$ and $$ leftovers)
    work = work.replace(/(^|[^\\$])\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?!\$)/g, (_, pre, tex) =>
      pre + stash(renderTex(tex, false))
    );

    // 4) Unescape \$ → $ for markdown pass aesthetics
    work = work.replace(/\\\$/g, "$");

    // 5) Restore protected code segments as plain text for marked
    //    Math slots stay as placeholders through marked, then become HTML.
    //    Code slots must go through marked, so restore them before marked.
    const mathPlaceholders = [];
    work = work.replace(/%%MDENH(\d+)%%/g, (full, idx) => {
      const i = Number(idx);
      const val = slots[i];
      // Code segments start with ` ; math HTML starts with <
      if (typeof val === "string" && val.charAt(0) === "`") {
        return val;
      }
      const ph = "%%MATH" + mathPlaceholders.length + "%%";
      mathPlaceholders.push(val);
      return ph;
    });

    let html = parseMarkdownOnly(work);

    // 6) Restore KaTeX HTML (escape-safe: placeholders survive marked as text)
    html = html.replace(/%%MATH(\d+)%%/g, (_, idx) => mathPlaceholders[Number(idx)] || "");

    // marked may wrap placeholders in <p> — unwrap pure math paragraphs when needed
    html = html.replace(/<p>\s*(<span class="katex[\s\S]*?<\/span>)\s*<\/p>/g, "$1");
    html = html.replace(
      /<p>\s*(<span class="katex-display[\s\S]*?<\/span>)\s*<\/p>/g,
      "$1"
    );

    return html;
  }

  const updatePreview = debounce(function updatePreviewNow() {
    if (!state.customTextarea || !state.preview) return;
    const html = renderMarkdownWithMath(state.customTextarea.value);
    state.preview.innerHTML = html;
  }, PREVIEW_DEBOUNCE_MS);

  /* ─── DOM construction ─── */

  function createExpandButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = EXTEND_BTN_CLASS + " " + NS + "-expand-btn";
    btn.title = "Open Markdown editor";
    btn.setAttribute("aria-label", "Open Markdown editor");
    btn.setAttribute("data-" + NS, "expand");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 3H5a2 2 0 0 0-2 2v3"/>' +
      '<path d="M16 3h3a2 2 0 0 1 2 2v3"/>' +
      '<path d="M8 21H5a2 2 0 0 1-2-2v-3"/>' +
      '<path d="M16 21h3a2 2 0 0 0 2-2v-3"/>' +
      '<path d="M9 12h6"/>' +
      "</svg>";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleEditor();
    });
    return btn;
  }

  function createEditorWrapper(baseHeight) {
    const wrapper = document.createElement("div");
    wrapper.className = NS + "-wrapper";
    wrapper.setAttribute("data-" + NS, "true");

    const minH = Math.max(Math.round(baseHeight * HEIGHT_MULTIPLIER), 180);

    wrapper.innerHTML =
      '<div class="' + NS + '-header">' +
      '  <h3 class="' + NS + '-title">' +
      '    Markdown Editor <span class="' + NS + '-title-badge">MD</span>' +
      "  </h3>" +
      '  <button type="button" class="' + NS + '-close-btn" title="Close" aria-label="Close Markdown editor">×</button>' +
      "</div>" +
      '<div class="' + NS + '-body">' +
      '  <div class="' + NS + '-editor-pane">' +
      '    <div class="' + NS + '-pane-label">Editor</div>' +
      '    <textarea class="' +
      NS +
      '-textarea" spellcheck="true" placeholder="Write Markdown here…\nEnter = newline · Ctrl/⌘+Enter = send"></textarea>' +
      "  </div>" +
      '  <div class="' + NS + '-preview-pane">' +
      '    <div class="' + NS + '-pane-label">Preview</div>' +
      '    <div class="' + NS + '-preview" aria-live="polite"></div>' +
      "  </div>" +
      "</div>" +
      '<div class="' + NS + '-toolbar" role="toolbar" aria-label="Markdown formatting">' +
      '  <button type="button" class="' + NS + '-tool-btn" data-snippet="code" title="Insert code block">&lt;/&gt;</button>' +
      '  <button type="button" class="' + NS + '-tool-btn" data-snippet="table" title="Insert table">田</button>' +
      '  <button type="button" class="' + NS + '-tool-btn" data-snippet="heading" title="Insert heading">H</button>' +
      "</div>" +
      '<div class="' + NS + '-footer">' +
      '  <p class="' + NS + '-hint"><kbd>Enter</kbd> newline · <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> send</p>' +
      '  <button type="button" class="' + NS + '-submit-btn" title="Send message">' +
      '    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
      "    Send" +
      "  </button>" +
      "</div>";

    const textarea = wrapper.querySelector("." + NS + "-textarea");
    textarea.style.minHeight = minH + "px";

    const preview = wrapper.querySelector("." + NS + "-preview");
    preview.style.minHeight = minH + "px";

    // Close
    wrapper.querySelector("." + NS + "-close-btn").addEventListener("click", (e) => {
      e.preventDefault();
      closeEditor(false);
    });

    // Toolbar inserts
    wrapper.querySelectorAll("." + NS + "-tool-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const key = btn.getAttribute("data-snippet");
        if (key && SNIPPETS[key]) insertAtCursor(SNIPPETS[key]);
      });
    });

    // Typing → debounced preview
    textarea.addEventListener("input", () => {
      updateSubmitEnabled();
      updatePreview();
    });

    // Keyboard: Enter = newline, Ctrl/Cmd+Enter = submit
    textarea.addEventListener("keydown", onEditorKeydown);

    // Submit
    const submitBtn = wrapper.querySelector("." + NS + "-submit-btn");
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      submitMessage();
    });

    return {
      wrapper,
      textarea,
      preview,
      submitBtn,
    };
  }

  function insertAtCursor(snippet) {
    const ta = state.customTextarea;
    if (!ta) return;

    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);

    // Add surrounding newlines when inserting mid-text for blocks
    const needLead = before.length && !before.endsWith("\n");
    const needTrail = after.length && !after.startsWith("\n");
    const text =
      (needLead ? "\n" : "") + snippet + (needTrail ? "\n" : "");

    ta.value = before + text + after;
    const caret = before.length + text.length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    updateSubmitEnabled();
    updatePreview();
  }

  function onEditorKeydown(e) {
    // Ctrl/Cmd + Enter → submit
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      submitMessage();
      return;
    }

    // Plain Enter → newline (default textarea behavior). Prevent DeepSeek
    // page-level listeners from treating it as send.
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Allow default newline insertion; stop bubbling so host UI doesn't send.
      e.stopPropagation();
      if (e.shiftKey) {
        // Also block Shift+Enter from host handlers; still insert newline via default
        e.stopPropagation();
      }
    }

    // Esc closes editor
    if (e.key === "Escape") {
      e.preventDefault();
      closeEditor(true);
    }
  }

  function updateSubmitEnabled() {
    if (!state.submitBtn || !state.customTextarea) return;
    const hasText = state.customTextarea.value.trim().length > 0;
    state.submitBtn.disabled = !hasText;
  }

  /* ─── open / close / submit ─── */

  function openEditor() {
    if (!state.wrapper || !state.originalInput || !state.originalContainer) return;

    // Seed from native value
    state.customTextarea.value = getNativeInputValue(state.originalInput);
    updateSubmitEnabled();
    updatePreview();

    const replaceShell = isReplaceShellMode(state.adapter);
    const editorMin = state.adapter?.layout?.editorMinHeight || 360;

    // Measure again in case layout changed
    const h = state.originalInput.getBoundingClientRect().height || state.originalHeight || 60;
    const minH = replaceShell
      ? Math.max(editorMin, 180)
      : Math.max(Math.round(h * HEIGHT_MULTIPLIER), 180);
    state.customTextarea.style.minHeight = minH + "px";
    state.preview.style.minHeight = minH + "px";

    if (replaceShell) {
      state.wrapper.style.width = "100%";
      state.wrapper.style.maxWidth = "100%";
      state.originalContainer.classList.add(NS + "-gemini-replaced");
      state.wrapper.classList.add(NS + "-gemini-open");
      if (state.hostRoot) {
        state.hostRoot.classList.add(NS + "-gemini-host");
        state.hostRoot.removeAttribute("aria-hidden");
      }
    } else {
      state.wrapper.style.width = "";
      state.wrapper.style.maxWidth = "";
    }

    state.wrapper.classList.add("is-open");
    state.expandBtn?.classList.add("is-active");
    state.isOpen = true;

    hideOriginalInput(true);
    positionExpandButton();

    // Focus custom editor
    requestAnimationFrame(() => {
      state.customTextarea?.focus();
      const len = state.customTextarea?.value.length || 0;
      state.customTextarea?.setSelectionRange(len, len);
    });
  }

  function closeEditor(syncBack) {
    if (!state.wrapper) return;

    if (syncBack && state.customTextarea && state.originalInput) {
      syncNativeInputValue(state.originalInput, state.customTextarea.value);
    }

    state.wrapper.classList.remove("is-open");
    state.wrapper.classList.remove(NS + "-gemini-open");
    state.expandBtn?.classList.remove("is-active");
    state.originalContainer?.classList.remove(NS + "-gemini-replaced");
    if (state.hostRoot) {
      state.hostRoot.classList.remove(NS + "-gemini-host");
      state.hostRoot.setAttribute("aria-hidden", "true");
    }
    state.isOpen = false;
    hideOriginalInput(false);

    // Force Gemini to recompute absolute shell position after host collapses.
    if (isReplaceShellMode(state.adapter) && state.originalContainer) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        positionExpandButton();
      });
    }

    if (state.debounceTimer != null) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  }

  function toggleEditor() {
    if (state.isOpen) closeEditor(true);
    else openEditor();
  }

  function hideOriginalInput(hide) {
    const ta = state.originalInput;
    const container = state.originalContainer;
    if (!ta || !container) return;

    if (hide) {
      Array.from(container.children).forEach((child) => {
        if (child === state.hostRoot) return;
        if (child.classList.contains(EXTEND_BTN_CLASS)) return;
        if (child.classList.contains(NS + "-expand-btn")) return;
        child.classList.add(NS + "-hide-original");
      });
      if (!isReplaceShellMode(state.adapter) && !ta.classList.contains(EXTEND_BTN_CLASS)) {
        ta.classList.add(NS + "-hide-original");
      }
    } else {
      container.querySelectorAll("." + NS + "-hide-original").forEach((el) => {
        el.classList.remove(NS + "-hide-original");
      });
      ta.classList.remove(NS + "-hide-original");
    }
  }

  function submitMessage() {
    if (!state.customTextarea || !state.originalInput) return;
    const text = state.customTextarea.value;
    if (!text.trim()) return;

    syncNativeInputValue(state.originalInput, text);
    hideOriginalInput(false);

    const nativeBtn = findNativeSubmitButton(state.originalInput, state.adapter);
    const clickSend = () => {
      if (nativeBtn) {
        nativeBtn.click();
      } else {
        state.originalInput.focus();
        state.originalInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
          })
        );
      }
    };

    requestAnimationFrame(() => {
      clickSend();
      state.customTextarea.value = "";
      if (state.preview) state.preview.innerHTML = "";
      closeEditor(false);
    });
  }

  /* ─── safe injection / lifecycle ─── */

  function positionExpandButton() {
    const btn = state.expandBtn;
    const container = state.originalContainer;
    if (!btn || !container || !container.isConnected) return;

    const rect = container.getBoundingClientRect();
    const size = 30;
    const outsideRight = state.adapter?.layout?.buttonPlacement === "outside-right";
    const gap = outsideRight
      ? (state.adapter?.layout?.buttonGap ?? 6)
      : 8;

    if (rect.width <= 0 || rect.height <= 0) {
      btn.style.display = "none";
      return;
    }

    btn.style.display = "";
    if (outsideRight) {
      // Place button just outside the dialog/composer on the right, vertically centered.
      const top = rect.top + Math.max((rect.height - size) / 2, 2);
      let left = rect.right + gap;
      if (left + size > window.innerWidth - 4) {
        left = Math.max(rect.right - size - 4, 4);
      }
      btn.style.top = Math.round(top) + "px";
      btn.style.left = Math.round(left) + "px";
    } else {
      btn.style.top = Math.round(rect.top + gap) + "px";
      btn.style.left = Math.round(rect.right - size - gap) + "px";
    }
  }

  function startLayoutSync() {
    if (state.layoutSyncActive) return;
    state.layoutSyncActive = true;
    state.onLayoutSync = () => positionExpandButton();
    window.addEventListener("scroll", state.onLayoutSync, true);
    window.addEventListener("resize", state.onLayoutSync);
  }

  function stopLayoutSync() {
    if (!state.layoutSyncActive || !state.onLayoutSync) return;
    window.removeEventListener("scroll", state.onLayoutSync, true);
    window.removeEventListener("resize", state.onLayoutSync);
    state.layoutSyncActive = false;
    state.onLayoutSync = null;
  }

  /**
   * Host root: Gemini mounts inside shell; others mount as sibling after container.
   */
  function ensureHostRoot(container, adapter) {
    if (!container) return null;

    if (isReplaceShellMode(adapter)) {
      let host = Array.from(container.children).find(
        (c) => c instanceof HTMLElement && c.classList.contains(NS + "-host")
      );
      if (host instanceof HTMLElement) return host;

      host = document.createElement("div");
      // Do NOT add gemini-host here — that class enables min-height and would
      // stretch Gemini's absolute-positioned shell on inject (layout jump).
      host.className = NS + "-host";
      host.setAttribute("data-" + NS, "host");
      host.setAttribute("aria-hidden", "true");
      container.appendChild(host);
      return host;
    }

    if (!container.parentElement) return null;

    const parent = container.parentElement;
    let host = container.nextElementSibling;
    if (host instanceof HTMLElement && host.classList.contains(NS + "-host")) {
      return host;
    }

    host = document.createElement("div");
    host.className = NS + "-host";
    host.setAttribute("data-" + NS, "host");
    parent.insertBefore(host, container.nextSibling);
    return host;
  }

  function injectUI(input, adapter) {
    if (!input || state.isInjecting) return false;

    // Idempotent: skip if our button already exists anywhere in the document
    if (hasExtensionButton() && state.expandBtn?.isConnected) return true;
    if (hasExtensionButton()) {
      const orphan = document.querySelector("." + EXTEND_BTN_CLASS);
      if (orphan && orphan !== state.expandBtn) orphan.remove();
    }

    const container = resolveInjectContainer(input, adapter);
    if (!container) return false;

    const host = ensureHostRoot(container, adapter);
    if (!host) return false;

    // Collapsed Gemini host must never stretch the shell.
    if (isReplaceShellMode(adapter) && !state.isOpen) {
      host.classList.remove(NS + "-gemini-host");
      host.setAttribute("aria-hidden", "true");
      container.classList.remove(NS + "-gemini-replaced");
    }

    // Editor already mounted for this host
    if (host.querySelector("." + NS + "-wrapper") && state.expandBtn?.isConnected) {
      boundInputs.add(input);
      state.originalInput = input;
      state.originalContainer = container;
      state.adapter = adapter;
      state.hostRoot = host;
      positionExpandButton();
      return true;
    }

    state.isInjecting = true;
    try {
      state.originalInput = input;
      state.originalContainer = container;
      state.adapter = adapter;
      state.hostRoot = host;
      state.originalHeight = input.getBoundingClientRect().height || 60;

      const expandBtn = createExpandButton();
      const built = createEditorWrapper(state.originalHeight);

      state.expandBtn = expandBtn;
      state.wrapper = built.wrapper;
      state.customTextarea = built.textarea;
      state.preview = built.preview;
      state.submitBtn = built.submitBtn;

      // Float button on <body> — fully outside React-managed subtrees
      document.body.appendChild(expandBtn);
      host.appendChild(built.wrapper);

      boundInputs.add(input);
      startLayoutSync();
      positionExpandButton();
      updateSubmitEnabled();
      return true;
    } finally {
      state.isInjecting = false;
    }
  }

  function tryInject() {
    if (state.isInjecting || state.isOpen) return false;

    // Stale binding after SPA destroyed the composer
    if (
      (state.originalInput && !state.originalInput.isConnected) ||
      (state.originalContainer && !state.originalContainer.isConnected)
    ) {
      teardownUI(false);
    }

    if (hasExtensionButton() && state.expandBtn?.isConnected && state.originalInput?.isConnected) {
      positionExpandButton();
      return true;
    }

    const adapter = state.adapter || resolveAdapter();
    const input = findSiteInput(adapter);
    if (!input) return false;

    return injectUI(input, adapter);
  }

  function teardownUI(removeHost) {
    if (state.debounceTimer != null) clearTimeout(state.debounceTimer);
    stopLayoutSync();
    state.expandBtn?.remove();
    state.originalContainer?.classList.remove(NS + "-gemini-replaced");
    state.wrapper?.classList.remove(NS + "-gemini-open");
    state.hostRoot?.classList.remove(NS + "-gemini-host");
    if (removeHost !== false) {
      state.hostRoot?.remove();
    } else if (state.wrapper) {
      state.wrapper.remove();
    }
    state.originalInput = null;
    state.originalContainer = null;
    state.hostRoot = null;
    state.expandBtn = null;
    state.wrapper = null;
    state.customTextarea = null;
    state.preview = null;
    state.submitBtn = null;
    state.isOpen = false;
    state.debounceTimer = null;
  }

  function onDomMutation() {
    if (state.isInjecting) return;

    if (
      (state.originalInput && !state.originalInput.isConnected) ||
      (state.originalContainer && !state.originalContainer.isConnected)
    ) {
      teardownUI(false);
    }

    if (!hasExtensionButton() || !state.expandBtn?.isConnected) {
      tryInject();
      return;
    }

    if (
      (state.originalInput && !state.originalInput.isConnected) ||
      (state.originalContainer && !state.originalContainer.isConnected)
    ) {
      teardownUI(false);
      tryInject();
      return;
    }

    positionExpandButton();
  }

  function startMutationObserver() {
    if (state.observer) return;

    const handler = debounceMutationObserver(onDomMutation, MO_DEBOUNCE_MS);
    state.observer = new MutationObserver(handler);

    const root = document.body || document.documentElement;
    state.observer.observe(root, {
      childList: true,
      subtree: true,
    });

    handler();
  }

  function init() {
    ensureKatexStyles();
    state.adapter = resolveAdapter();

    scheduleAfterHydration(() => {
      tryInject();
      startMutationObserver();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
