/**
 * DeepSeek Markdown Enhancer — content script
 * Injects a Markdown editor into https://chat.deepseek.com
 */
(function () {
  "use strict";

  const NS = "md-enhancer";
  const PREVIEW_DEBOUNCE_MS = 500;
  const HEIGHT_MULTIPLIER = 3;
  const INIT_RETRY_MS = 800;
  const MAX_INIT_ATTEMPTS = 60;

  /** @type {{
   *   originalTextarea: HTMLTextAreaElement | null,
   *   originalContainer: HTMLElement | null,
   *   expandBtn: HTMLButtonElement | null,
   *   wrapper: HTMLElement | null,
   *   customTextarea: HTMLTextAreaElement | null,
   *   preview: HTMLElement | null,
   *   submitBtn: HTMLButtonElement | null,
   *   isOpen: boolean,
   *   debounceTimer: number | null,
   *   observer: MutationObserver | null,
   *   originalHeight: number
   * }} */
  const state = {
    originalTextarea: null,
    originalContainer: null,
    expandBtn: null,
    wrapper: null,
    customTextarea: null,
    preview: null,
    submitBtn: null,
    isOpen: false,
    debounceTimer: null,
    observer: null,
    originalHeight: 0,
  };

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

  /**
   * Find DeepSeek's chat input using robust, attribute-first selectors.
   */
  function findChatTextarea() {
    const selectors = [
      'textarea[placeholder*="DeepSeek" i]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="发消息" i]',
      'textarea[placeholder*="发送" i]',
      'textarea[placeholder*="输入" i]',
      "textarea",
    ];

    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const node of nodes) {
        if (!(node instanceof HTMLTextAreaElement)) continue;
        // Prefer large, visible chat inputs near the bottom of the viewport
        if (!isVisible(node) && node.offsetParent === null) continue;
        if (node.closest("." + NS + "-wrapper")) continue;
        if (node.getAttribute("aria-hidden") === "true") continue;
        // Heuristic: chat box is usually near the bottom
        const rect = node.getBoundingClientRect();
        if (rect.top > window.innerHeight * 0.35 || nodes.length === 1) {
          return node;
        }
      }
    }

    // Last resort: largest visible textarea
    let best = null;
    let bestArea = 0;
    document.querySelectorAll("textarea").forEach((ta) => {
      if (ta.closest("." + NS + "-wrapper")) return;
      const r = ta.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = ta;
      }
    });
    return best;
  }

  /**
   * Walk up from the textarea to a sensible input "shell" container.
   */
  function findInputContainer(textarea) {
    if (!textarea) return null;

    let el = textarea.parentElement;
    let best = textarea.parentElement;
    let depth = 0;

    while (el && el !== document.body && depth < 8) {
      const style = window.getComputedStyle(el);
      const hasBorder =
        style.borderTopWidth !== "0px" ||
        style.borderRadius !== "0px" ||
        style.boxShadow !== "none" ||
        style.backgroundColor !== "rgba(0, 0, 0, 0)";

      // Prefer a relatively tight wrapper that still contains action buttons
      const buttons = el.querySelectorAll(
        'button, [role="button"], .ds-button, .ds-icon-button'
      );
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

    // Ensure we can position the expand button
    if (best && window.getComputedStyle(best).position === "static") {
      best.style.position = "relative";
    }
    return best;
  }

  /**
   * Find the native send control near the textarea.
   */
  function findNativeSubmitButton(textarea) {
    if (!textarea) return null;

    // Walk ancestors looking for an icon / send button
    let root = textarea.parentElement;
    for (let d = 0; d < 6 && root; d++) {
      const candidates = Array.from(
        root.querySelectorAll('button, [role="button"], .ds-button, .ds-icon-button')
      );

      // Prefer the rightmost / bottommost interactive control that isn't our UI
      const filtered = candidates.filter((btn) => {
        if (btn.closest("." + NS + "-wrapper")) return false;
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

  /**
   * Sync text into DeepSeek's React-controlled textarea.
   */
  function setNativeTextareaValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (setter) {
      setter.call(textarea, value);
    } else {
      textarea.value = value;
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    // Some frameworks listen on keyboard events after programmatic fills
    try {
      const tracker = textarea._valueTracker;
      if (tracker) tracker.setValue("");
    } catch (_) {
      /* ignore */
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
    btn.className = NS + "-expand-btn";
    btn.title = "Open Markdown editor";
    btn.setAttribute("aria-label", "Open Markdown editor");
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
    if (!state.wrapper || !state.originalTextarea || !state.originalContainer) return;

    // Seed from native value
    state.customTextarea.value = state.originalTextarea.value || "";
    updateSubmitEnabled();
    updatePreview();

    // Measure again in case layout changed
    const h = state.originalTextarea.getBoundingClientRect().height || state.originalHeight || 60;
    const minH = Math.max(Math.round(h * HEIGHT_MULTIPLIER), 180);
    state.customTextarea.style.minHeight = minH + "px";
    state.preview.style.minHeight = minH + "px";

    state.wrapper.classList.add("is-open");
    state.expandBtn?.classList.add("is-active");
    state.isOpen = true;

    // Hide original input row (but keep wrapper mounted so we can still find submit)
    hideOriginalInput(true);

    // Focus custom editor
    requestAnimationFrame(() => {
      state.customTextarea?.focus();
      const len = state.customTextarea?.value.length || 0;
      state.customTextarea?.setSelectionRange(len, len);
    });
  }

  function closeEditor(syncBack) {
    if (!state.wrapper) return;

    if (syncBack && state.customTextarea && state.originalTextarea) {
      setNativeTextareaValue(state.originalTextarea, state.customTextarea.value);
    }

    state.wrapper.classList.remove("is-open");
    state.expandBtn?.classList.remove("is-active");
    state.isOpen = false;
    hideOriginalInput(false);

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
    const ta = state.originalTextarea;
    const container = state.originalContainer;
    if (!ta || !container) return;

    // Prefer hiding only the textarea + typical sibling action row visuals
    // while leaving our expand button visible.
    if (hide) {
      // Hide original input shell / action rows; keep expand button visible
      Array.from(container.children).forEach((child) => {
        if (child === state.wrapper || child === state.expandBtn) return;
        if (child.classList.contains(NS + "-expand-btn")) return;
        child.classList.add(NS + "-hide-original");
      });
      ta.classList.add(NS + "-hide-original");
    } else {
      container.querySelectorAll("." + NS + "-hide-original").forEach((el) => {
        el.classList.remove(NS + "-hide-original");
      });
      ta.classList.remove(NS + "-hide-original");
    }
  }

  function submitMessage() {
    if (!state.customTextarea || !state.originalTextarea) return;
    const text = state.customTextarea.value;
    if (!text.trim()) return;

    // 1) Copy into native textarea with React-compatible events
    setNativeTextareaValue(state.originalTextarea, text);

    // 2) Reveal native UI briefly so submit button is clickable / visible
    hideOriginalInput(false);

    // 3) Click native submit
    const nativeBtn = findNativeSubmitButton(state.originalTextarea);
    const clickSend = () => {
      if (nativeBtn) {
        nativeBtn.click();
      } else {
        // Fallback: synthesize Enter on the native textarea (DeepSeek default send)
        state.originalTextarea.focus();
        state.originalTextarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
          })
        );
      }
    };

    // Allow React to process the value before clicking
    requestAnimationFrame(() => {
      clickSend();
      // 4) Tear down custom editor
      state.customTextarea.value = "";
      if (state.preview) state.preview.innerHTML = "";
      closeEditor(false);
    });
  }

  /* ─── injection / lifecycle ─── */

  function injectUI(textarea) {
    if (!textarea || textarea.dataset[NS + "Bound"]) return false;

    const container = findInputContainer(textarea);
    if (!container) return false;

    // Avoid double-inject
    if (container.querySelector("." + NS + "-wrapper")) {
      textarea.dataset[NS + "Bound"] = "1";
      return true;
    }

    state.originalTextarea = textarea;
    state.originalContainer = container;
    state.originalHeight = textarea.getBoundingClientRect().height || 60;

    const expandBtn = createExpandButton();
    const built = createEditorWrapper(state.originalHeight);

    state.expandBtn = expandBtn;
    state.wrapper = built.wrapper;
    state.customTextarea = built.textarea;
    state.preview = built.preview;
    state.submitBtn = built.submitBtn;

    // Mount expand button on the original container (top-right)
    container.appendChild(expandBtn);

    // Mount editor after the input container
    if (container.parentElement) {
      container.parentElement.insertBefore(built.wrapper, container.nextSibling);
    } else {
      container.appendChild(built.wrapper);
    }

    textarea.dataset[NS + "Bound"] = "1";
    updateSubmitEnabled();
    return true;
  }

  function tryInit() {
    // Re-bind if SPA navigated away and recreated the input
    if (state.originalTextarea && !state.originalTextarea.isConnected) {
      teardown();
    }

    const ta = findChatTextarea();
    if (!ta) return false;
    return injectUI(ta);
  }

  function teardown() {
    if (state.debounceTimer != null) clearTimeout(state.debounceTimer);
    state.wrapper?.remove();
    state.expandBtn?.remove();
    state.originalTextarea = null;
    state.originalContainer = null;
    state.expandBtn = null;
    state.wrapper = null;
    state.customTextarea = null;
    state.preview = null;
    state.submitBtn = null;
    state.isOpen = false;
    state.debounceTimer = null;
  }

  function start() {
    ensureKatexStyles();

    let attempts = 0;

    const boot = () => {
      if (tryInit()) return;
      attempts++;
      if (attempts < MAX_INIT_ATTEMPTS) {
        setTimeout(boot, INIT_RETRY_MS);
      }
    };

    boot();

    // DeepSeek is an SPA — re-inject when the chat shell re-renders
    state.observer = new MutationObserver(() => {
      if (!document.querySelector("." + NS + "-wrapper")) {
        tryInit();
      } else if (state.originalTextarea && !state.originalTextarea.isConnected) {
        teardown();
        tryInit();
      }
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
