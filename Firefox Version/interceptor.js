/* Clipboard Buckler – main-world clipboard interceptor.
   Waits for config from content.js before patching APIs to avoid interference on trusted sites. */
(function () {
  "use strict";
  
  let installed = false;
  let configReceived = false;
  let shouldInstall = true; // Default to installing unless told otherwise

  // Listen for config from Isolated World (content.js)
  window.addEventListener("message", function(ev) {
    if (ev.source !== window) return;
    const d = ev.data;
    if (d && d.__clipboardBucklerConfig) {
      configReceived = true;
      if (d.disable === true) {
        shouldInstall = false;
      }
      // Once received, try to install if appropriate
      tryInstall();
    }
  }, true);

  function tryInstall() {
    if (installed || !configReceived) return;
    if (!shouldInstall) return; // Site is whitelisted, do nothing
    
    installed = true;
    window.__cbBucklerInstalled = true;

    // Capture natives BEFORE a page can tamper with them.
    const nativePost   = window.postMessage;
    const nativeAdd    = window.addEventListener;
    const NS = "__clipboardBuckler";

    let ready = false;          // has the isolated script announced itself?
    let seq = 0;
    const pending = new Map();  // id -> onDecision(allow:boolean)
    const outbox  = [];         // requests queued until ready

    function post(obj) {
      try { nativePost.call(window, Object.assign({ [NS]: true }, obj), "*"); }
      catch (e) { /* ignore */ }
    }

    // Best-effort capture of what execCommand('copy') would copy.
    function captureSelectionText() {
      try {
        const ae = document.activeElement;
        if (ae && (ae.tagName === "TEXTAREA" ||
                   (ae.tagName === "INPUT" &&
                    /^(text|search|url|tel|password|email|number|)$/.test(ae.type || "")))) {
          const v = ae.value || "";
          const s = ae.selectionStart, e = ae.selectionEnd;
          if (typeof s === "number" && typeof e === "number" && e > s) return v.substring(s, e);
          if (v) return v;
        }
      } catch (err) { /* ignore */ }
      try { const sel = window.getSelection(); if (sel) return sel.toString(); } catch (err) { /* ignore */ }
      return "";
    }

    function requestCopy(kind, preview, onDecision) {
      const id = ++seq;
      pending.set(id, onDecision);
      const msg = {
        dir: "req",
        id,
        host: location.hostname,
        kind,
        preview: String(preview == null ? "" : preview).slice(0, 2000)
      };
      if (ready) post(msg); else outbox.push(msg);
    }

    nativeAdd.call(window, "message", function (ev) {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d[NS] !== true) return;
      if (d.dir === "ready") {
        ready = true;
        while (outbox.length) post(outbox.shift());
        return;
      }
      if (d.dir === "res") {
        const cb = pending.get(d.id);
        if (cb) { pending.delete(d.id); cb(!!d.allow); }
      }
    }, true);

    // ---- Patch the modern async Clipboard API -------------------------------
    const clip = navigator.clipboard;
    const nativeWriteText = clip && typeof clip.writeText === "function" ? clip.writeText : null;
    const nativeWrite     = clip && typeof clip.write     === "function" ? clip.write     : null;

    if (nativeWriteText) {
      clip.writeText = function (text) {
        // Unfocused document => the real API would reject; don't nag the user.
        if (!document.hasFocus()) return nativeWriteText.call(clip, text);
        return new Promise(function (resolve, reject) {
          requestCopy("writeText", text, function (allow) {
            if (allow) nativeWriteText.call(clip, text).then(resolve, reject);
            else reject(new DOMException("Clipboard write blocked by Clipboard Buckler.", "NotAllowedError"));
          });
        });
      };
    }

    if (nativeWrite) {
      clip.write = function (items) {
        if (!document.hasFocus()) return nativeWrite.call(clip, items);
        let preview = "";
        try {
          const t = (items && items[0] && items[0].types) ? items[0].types : [];
          preview = "[clipboard item: " + (t.join(", ") || "unknown") + "]";
        } catch (e) { preview = "[clipboard item]"; }
        return new Promise(function (resolve, reject) {
          requestCopy("write", preview, function (allow) {
            if (allow) nativeWrite.call(clip, items).then(resolve, reject);
            else reject(new DOMException("Clipboard write blocked by Clipboard Buckler.", "NotAllowedError"));
          });
        });
      };
    }

    // ---- Patch the legacy execCommand('copy') -------------------------------
    const nativeExec = typeof document.execCommand === "function" ? document.execCommand : null;
    if (nativeExec) {
      document.execCommand = function (command) {
        const args = Array.prototype.slice.call(arguments, 1);
        if (String(command).toLowerCase() === "copy") {
          if (!document.hasFocus()) return nativeExec.apply(document, arguments);
          const text = captureSelectionText();
          requestCopy("execCommand", text, function (allow) {
            // Transient activation has expired by the time the user answers,
            // so fulfil an allowed legacy copy through the modern API instead.
            if (allow && nativeWriteText) { try { nativeWriteText.call(clip, text).catch(function () {}); } catch (e) {} }
          });
          return true; // optimistic: the site thinks it copied; we silently drop it on deny
        }
        return nativeExec.apply(document, arguments);
      };
    }
  }

  // Fallback: If config never arrives (e.g., content script failed), install anyway after short delay
  setTimeout(() => {
    if (!configReceived) {
      shouldInstall = true;
      tryInstall();
    }
  }, 100);

})();