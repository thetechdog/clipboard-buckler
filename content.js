if (typeof browser === "undefined") { var browser = chrome; }

(async function () {
  "use strict";
  
  // --- FAST PATH: Check whitelist/blacklist IMMEDIATELY ---
  const st = await browser.storage.local.get(["whitelist", "blacklist"]);
  const wl = st.whitelist || [];
  const bl = st.blacklist || [];
  const host = location.hostname.replace(/^www\./, "").toLowerCase();
  
  const isWhitelisted = wl.some(e => host === e || host.endsWith("." + e));
  const isBlacklisted = bl.some(e => host === e || host.endsWith("." + e));

  // Signal to Main World: Should it install?
  // If whitelisted AND NOT blacklisted -> Disable Interception
  const shouldDisable = isWhitelisted && !isBlacklisted;

  // Post message to Main World
  window.postMessage({ __clipboardBucklerConfig: true, disable: shouldDisable }, "*");

  if (shouldDisable) {
    return; // Stop execution here. Don't set up listeners/UI.
  }
  
  const nativePost = window.postMessage;
  const nativeAdd  = window.addEventListener;
  const nativeRem  = window.removeEventListener;
  const NS = "__clipboardBuckler";

  function post(obj) { try { nativePost.call(window, Object.assign({ [NS]: true }, obj), "*"); } catch (e) {} }
  function postRes(id, allow) { post({ dir: "res", id: id, allow: !!allow }); }

  // ---- storage cache ------------------------------------------------------
  let cache = null;
  browser.storage.onChanged.addListener(function (ch, area) { if (area === "local") cache = null; });
  async function getState() {
    if (cache) return cache;
    const st = await browser.storage.local.get(["whitelist", "blacklist", "lockdown"]);
    cache = { wl: st.whitelist || [], bl: st.blacklist || [], lock: !!st.lockdown };
    return cache;
  }

  function normalizeHost(h) {
    h = String(h || "").trim().toLowerCase();
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    h = h.split(/[\/?#]/)[0];
    h = h.replace(/^www\./, "");
    return /^[a-z0-9.-]+$/.test(h) ? h : "";
  }
  function matches(host, list) {
    return list.some(function (e) { return host === e || host.endsWith("." + e); });
  }
  async function addToList(key, host) {
    host = normalizeHost(host);
    if (!host) return;
    const cur = await browser.storage.local.get(key);
    const arr = Array.isArray(cur[key]) ? cur[key] : [];
    if (arr.indexOf(host) === -1) { arr.push(host); arr.sort(); await browser.storage.local.set({ [key]: arr }); }
    cache = null;
  }

  // ---- request queue: one modal at a time per frame -----------------------
  const queue = [];
  let showing = false;
  function enqueue(req) { queue.push(req); pump(); }

  async function pump() {
    if (showing || !queue.length) return;
    showing = true;
    const req = queue.shift();
    try {
      const s = await getState();
      const host = normalizeHost(req.host);
      const inW = matches(host, s.wl);
      const inB = matches(host, s.bl);
      let decision = null;
      // BLOCKLIST has priority over WHITELIST when a domain appears in both.
      if (s.lock)       decision = (inB || !inW) ? "deny" : "allow"; // lockdown: lists only
      else if (inB)     decision = "deny";                           // blocked takes priority
      else if (inW)     decision = "allow";

      if (decision) { postRes(req.id, decision === "allow"); return; }

      const r = await showDialog(req);
      if (r.persist) await addToList(r.persist, req.host);
      postRes(req.id, r.allow);
    } finally {
      showing = false;
      pump();
    }
  }

  // ---- the modal ----------------------------------------------------------
  const CSS = `
  :host{all:initial;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;
        pointer-events:auto;font-family:system-ui;} 
  .backdrop{position:absolute;inset:0;background:rgba(15,18,22,.45);}
  .card{position:absolute;background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:14px;
        box-shadow:0 18px 50px rgba(0,0,0,.35);padding:18px 18px 16px;max-height:90vh;overflow:auto;}
  .head{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
  .head svg{color:#e8843c;flex:0 0 auto;} 
  .title{font-weight:700;font-size:15px;}
  .host{font-size:12px;color:#57606a;word-break:break-all;}
  .msg{font-size:13.5px;margin:10px 0 8px;line-height:1.45;}
  .msg b{font-weight:600;}
  .preview{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;
           padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; 
           font-size:12.5px;white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto;color:#1f2328;}
  .preview.empty{color:#8b949e;font-style:italic;}
  .count{margin:10px 0 4px;font-size:12px;color:#57606a;display:flex;align-items:center;gap:8px;}
  .bar{flex:1;height:4px;background:#eaeef2;border-radius:3px;overflow:hidden;}
  .bar > i{display:block;height:100%;width:100%;background:#e8843c;transition:width 1s linear;}
  .hint{font-size:11px;color:#8b949e;margin:2px 0 12px;}
  .row{display:flex;gap:8px;flex-wrap:wrap;}
  button{appearance:none;font:inherit;font-size:13px;font-weight:600;cursor:pointer;
         border-radius:8px;padding:8px 14px;border:1px solid #d0d7de;background:#f6f8fa;color:#1f2328;}
  button:hover{background:#eef1f4;}
  button:focus-visible{outline:2px solid #e8843c;outline-offset:2px;}
  button.primary{background:#e8843c;border-color:#e8843c;color:#fff;}
  button.primary:hover{background:#d9752f;}
  @media (prefers-color-scheme:dark){
    .backdrop{background:rgba(0,0,0,.62);}
    .card{background:#161b22;color:#e6edf3;border-color:#30363d;}
    .host,.count{color:#8b949e;}
    .preview{background:#0d1117;border-color:#30363d;color:#e6edf3;}
    .preview.empty{color:#6e7681;}
    .bar{background:#21262d;}
    button{background:#21262d;border-color:#30363d;color:#e6edf3;}
    button:hover{background:#282e36;}
    button.primary{background:#f0883e;border-color:#f0883e;color:#1c2128;}
    button.primary:hover{background:#db6d28;}
    .hint{color:#6e7681;}
  }`;

  const LOCK_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<path fill="currentColor" d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2zm0-6h2v4h-2z"/></svg>';

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    }
    if (kids) for (const c of kids) {
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }

  function showDialog(req) {
    return new Promise(function (resolve) {
      let settled = false, remaining = 30, timer = null, barFill = null, countTxt = null;
      
      // --- STEP 1: CALCULATE CENTER BEFORE TOUCHING ANYTHING ---
      const winWidth = window.innerWidth;
      const winHeight = window.innerHeight;
      const estimatedCardWidth = Math.min(440, winWidth * 0.9);
      const leftPos = (winWidth - estimatedCardWidth) / 2;
      const topPos = (winHeight * 0.15); 
      
      // Save current scroll position
      const scrollY = window.scrollY || window.pageYOffset;
      const scrollX = window.scrollX || window.pageXOffset;
      
      // Save original styles to restore later
      const origBodyOverflow = document.body.style.overflow;
      const origHtmlOverflow = document.documentElement.style.overflow;
      const origBodyPosition = document.body.style.position;
      const origBodyTop = document.body.style.top;
      const origBodyLeft = document.body.style.left;
      const origBodyWidth = document.body.style.width;

      function lockScroll() {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = '-' + scrollY + 'px';
        document.body.style.left = '-' + scrollX + 'px';
        document.body.style.width = '100%';
      }

      function unlockScroll() {
        document.body.style.overflow = origBodyOverflow;
        document.documentElement.style.overflow = origHtmlOverflow;
        document.body.style.position = origBodyPosition;
        document.body.style.top = origBodyTop;
        document.body.style.left = origBodyLeft;
        document.body.style.width = origBodyWidth;
        window.scrollTo(scrollX, scrollY);
      }

      function finish(allow, persist) {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        nativeRem.call(window, "keydown", onKey, true);
        
        unlockScroll(); 
        hostEl.remove();
        
        resolve({ allow: !!allow, persist: persist || null });
      }

      // Define buttons array FIRST so it exists before handlers run
      const btnNo = el("button", { class: "primary", text: "No", onclick: function () { finish(false, null); } });
      const btnYes = el("button", { text: "Yes", onclick: function () { finish(true, null); } });
      const btnAlways = el("button", { text: "Always", onclick: function () { finish(true, "whitelist"); } });
      const btnNever = el("button", { text: "Never", onclick: function () { finish(false, "blacklist"); } });
      
      const buttons = [btnNo, btnYes, btnAlways, btnNever];
      let currentFocusIdx = 0; // Start at No

      function moveFocus(direction) {
        currentFocusIdx += direction;
        if (currentFocusIdx < 0) currentFocusIdx = buttons.length - 1;
        if (currentFocusIdx >= buttons.length) currentFocusIdx = 0;
        buttons[currentFocusIdx].focus();
      }

      function onKey(e) {
        if (e.key === "Escape") { 
          e.preventDefault(); 
          finish(false, null); 
          return; 
        }

        if (["ArrowRight", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          moveFocus(1);
          return;
        }
        
        if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
          e.preventDefault();
          moveFocus(-1);
          return;
        }

        if (e.key === "Tab") {
             e.preventDefault();
             moveFocus(e.shiftKey ? -1 : 1);
        }
      }

      const hostEl = el("clipboard-buckler-root", { style: "all:initial" });
      const root = hostEl.attachShadow({ mode: "open" }); 
      root.appendChild(el("style", { text: CSS }));

      // Apply theme
      try {
        if (matchMedia("(prefers-color-scheme: dark)").matches) {
          hostEl.dataset.theme = "dark";
        } else {
          hostEl.dataset.theme = "light";
        }
      } catch (e) {
        hostEl.dataset.theme = "light";
      }

      const head = el("div", { class: "head" }, [
        el("span", { html: LOCK_SVG }),
        el("div", {}, [
          el("div", { class: "title", text: "Clipboard Buckler" }),
          el("div", { class: "host", text: req.host || location.hostname })
        ])
      ]);

      const previewText = (req.preview || "").slice(0, 600);
      const previewNode = el("div", {
        class: "preview" + (previewText ? "" : " empty"),
        text: previewText || "(no readable text – e.g. an image or rich content)"
      });

      barFill = el("i");
      countTxt = el("span", { text: "Auto-deny in 30s" });
      const count = el("div", { class: "count" }, [el("div", { class: "bar" }, [barFill]), countTxt]);

      const card = el("div", { 
        class: "card", 
        role: "dialog", 
        "aria-modal": "true", 
        "aria-label": "Clipboard access request",
        style: `left:${leftPos}px; top:${topPos}px; width:${estimatedCardWidth}px;`,
        tabindex: "-1" 
      }, [
        head, el("div", { class: "msg", text: "" }), previewNode, count,
        el("div", { class: "hint", text: "Use Arrow Keys to navigate · Enter to select · Esc to Deny" }),
        el("div", { class: "row" }, buttons) 
      ]);
      
      const msg = card.querySelector(".msg");
      msg.appendChild(document.createTextNode("“"));
      msg.appendChild(el("b", { text: req.host || location.hostname }));
      msg.appendChild(document.createTextNode("” is trying to copy the following to your clipboard:"));

      root.appendChild(el("div", { class: "backdrop" }, [card]));

      // Mount & Lock Scroll
      (function mount() {
        if (document.documentElement) {
          document.documentElement.appendChild(hostEl);
          lockScroll();
          
          setTimeout(() => {
              if(!settled) {
                  currentFocusIdx = 0;
                  buttons[0].focus();
              }
          }, 0);
        } else {
          setTimeout(mount, 10); 
        }
      })();

      nativeAdd.call(window, "keydown", onKey, true);

      timer = setInterval(function () {
        remaining -= 1;
        if (countTxt) countTxt.textContent = "Auto-deny in " + Math.max(remaining, 0) + "s";
        if (barFill)  barFill.style.width = (remaining / 30 * 100) + "%";
        if (remaining <= 0) finish(false, null);
      }, 1000);
    });
  }

  nativeAdd.call(window, "message", function (ev) {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d[NS] !== true || d.dir !== "req") return;
    enqueue(d);
  }, true);

  post({ dir: "ready" });
})();
