/**
 * MAIN-world helpers for sites (e.g. Kimi/Lexical) where content-script
 * DOM writes are ignored and page CSP blocks inline <script> injection.
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "md-enhancer-lexical-sync") return;

  const tabId = _sender.tab?.id;
  if (tabId == null) {
    sendResponse({ ok: false, error: "no-tab" });
    return true;
  }

  chrome.scripting
    .executeScript({
      target: { tabId },
      world: "MAIN",
      args: [msg.attr, msg.stateJSON, msg.value],
      func: (attr, stateJSON, value) => {
        try {
          const el = document.querySelector("[" + attr + "]");
          if (!el) return { ok: false, error: "no-target" };
          el.removeAttribute(attr);

          function findEditor(node) {
            let n = node;
            while (n) {
              if (n.__lexicalEditor) return n.__lexicalEditor;
              n = n.parentElement;
            }
            if (node && node.querySelectorAll) {
              const all = node.querySelectorAll("*");
              for (let i = 0; i < all.length; i++) {
                if (all[i].__lexicalEditor) return all[i].__lexicalEditor;
              }
            }
            return null;
          }

          const editor = findEditor(el);
          if (
            editor &&
            typeof editor.parseEditorState === "function" &&
            typeof editor.setEditorState === "function"
          ) {
            editor.setEditorState(editor.parseEditorState(stateJSON));
            // DOM may lag one frame; Lexical state is source of truth
            return { ok: true, via: "setEditorState" };
          }

          el.focus();
          try {
            document.execCommand("selectAll", false, null);
            document.execCommand("delete", false, null);
          } catch (_) {
            /* ignore */
          }

          let ok = false;
          try {
            ok = !!document.execCommand("insertText", false, value);
          } catch (_) {
            ok = false;
          }

          if (!ok || !(el.innerText || "").trim()) {
            try {
              const dt = new DataTransfer();
              dt.setData("text/plain", value);
              const html = String(value)
                .split("\n")
                .map(
                  (l) =>
                    "<p>" +
                    String(l).replace(/&/g, "&amp;").replace(/</g, "&lt;") +
                    "</p>"
                )
                .join("");
              dt.setData("text/html", html);
              const evt = new Event("paste", {
                bubbles: true,
                cancelable: true,
                composed: true,
              });
              Object.defineProperty(evt, "clipboardData", { value: dt });
              el.dispatchEvent(evt);
              ok = true;
            } catch (_) {
              ok = false;
            }
          }

          const text = (el.innerText || el.textContent || "").replace(/\u200b/g, "").trim();
          return { ok: ok && text.length > 0, via: "dom" };
        } catch (err) {
          return { ok: false, error: String(err && err.message ? err.message : err) };
        }
      },
    })
    .then((results) => {
      const result = results && results[0] && results[0].result;
      sendResponse(result || { ok: false, error: "no-result" });
    })
    .catch((err) => {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    });

  return true; // async sendResponse
});
