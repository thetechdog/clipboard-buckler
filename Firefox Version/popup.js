if (typeof browser === "undefined") { var browser = chrome; }

(function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };

  // ---------- theme toggle -------------------------------------------------
  async function loadThemePreference() {
    const st = await browser.storage.local.get(["themePref"]);
    return st.themePref || "auto"; // "auto" | "light" | "dark"
  }

  function detectSystemTheme() {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  async function applyTheme(pref) {
    const effective = pref === "auto" ? detectSystemTheme() : pref;
    document.documentElement.dataset.theme = effective;
    $("#themeBtn").textContent = effective === "dark" ? "☽" : "🌣";
    $("#themeBtn").title = pref === "auto" 
      ? `Theme: Auto (currently ${effective})` 
      : `Theme: ${pref.charAt(0).toUpperCase() + pref.slice(1)} (click for Auto)`;
  }

  async function cycleTheme() {
    const current = await loadThemePreference();
    const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
    await browser.storage.local.set({ themePref: next });
    await applyTheme(next);
  }

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async function () {
    const pref = await loadThemePreference();
    if (pref === "auto") await applyTheme(pref);
  });

  (async function initTheme() {
    const pref = await loadThemePreference();
    await applyTheme(pref);
  })();

  // ---------- helpers ------------------------------------------------------
  function normalizeHost(h) {
    h = String(h || "").trim().toLowerCase();
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    h = h.split(/[\/?#]/)[0];
    h = h.replace(/^www\./, "");
    return /^[a-z0-9.-]+$/.test(h) ? h : "";
  }

  function renderList(ul, arr, key) {
    ul.textContent = "";
    if (!arr.length) {
      const li = document.createElement("li");
      li.className = "empty"; li.textContent = "— empty —";
      ul.appendChild(li); return;
    }
    arr.forEach(function (host) {
      const li = document.createElement("li");
      const sp = document.createElement("span"); sp.textContent = host;
      const btn = document.createElement("button"); btn.textContent = "×"; btn.title = "Remove " + host;
      btn.addEventListener("click", function () { remove(key, host); });
      li.appendChild(sp); li.appendChild(btn); ul.appendChild(li);
    });
  }

  async function load() {
    const st = await browser.storage.local.get(["whitelist", "blacklist", "lockdown"]);
    const wl = st.whitelist || [], bl = st.blacklist || [];
    renderList($("#wlList"), wl, "whitelist");
    renderList($("#blList"), bl, "blacklist");
    $("#wlCount").textContent = wl.length ? "(" + wl.length + ")" : "";
    $("#blCount").textContent = bl.length ? "(" + bl.length + ")" : "";
    $("#lockdown").checked = !!st.lockdown;
  }

  async function add(key, inputEl) {
    const host = normalizeHost(inputEl.value);
    if (!host) { inputEl.value = ""; return; }
    const cur = await browser.storage.local.get(key);
    const arr = Array.isArray(cur[key]) ? cur[key] : [];
    if (arr.indexOf(host) === -1) { arr.push(host); arr.sort(); await browser.storage.local.set({ [key]: arr }); }
    inputEl.value = ""; load();
  }

  async function remove(key, host) {
    const cur = await browser.storage.local.get(key);
    let arr = Array.isArray(cur[key]) ? cur[key] : [];
    arr = arr.filter(function (x) { return x !== host; });
    await browser.storage.local.set({ [key]: arr });
    load();
  }

  // ---------- Add Current Domain Logic -------------------------------------
  async function getCurrentDomain() {
    try {
      // Query the active tab in the current window
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) {
        console.warn("No active tab found.");
        return null;
      }
      const url = tabs[0].url;
      // Safety check: Ensure we don't try to whitelist internal browser pages
      // e.g., about:blank, chrome://settings, moz-extension://...
      if (!url || url.startsWith("about:") || url.startsWith("chrome://") || url.startsWith("moz-extension://") || url.startsWith("chrome-extension://") || url.startsWith("edge://") || url.startsWith("file://") || url.startsWith("opera://") || url.startsWith("vivaldi://") || url.startsWith("brave://") || url.startsWith("internet://") || url.startsWith("whale://")) {
        return -1;
      }
      return normalizeHost(url);
    } catch (e) {
      console.error("Failed to get current tab:", e);
      return null;
    }
  }

  async function addCurrentTo(key) {
    const host = await getCurrentDomain();
    if (host === -1) {
      alert("You cannot add internal browser pages to the lists.");
      return;
    }
    else if (!host) { 
      alert("Could not determine a valid web domain from the current tab."); 
      return; 
    }
    
    const cur = await browser.storage.local.get(key);
    const arr = Array.isArray(cur[key]) ? cur[key] : [];
    if (arr.indexOf(host) === -1) { 
      arr.push(host); 
      arr.sort(); 
      await browser.storage.local.set({ [key]: arr }); 
      load();
    } else {
      // Optional: Provide feedback if already present
      // alert(`"${host}" is already in the ${key}.`);
    }
  }

  // ---------- CSV/TXT Export / Import -----------------------------------------
  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function exportTxt() {
    const st = await browser.storage.local.get(["whitelist", "blacklist"]);
    const wl = st.whitelist || [], bl = st.blacklist || [];
    const max = Math.max(wl.length, bl.length);
    const lines = ["type,domain"];
    for (let i = 0; i < max; i++) {
      if (wl[i] != null) lines.push("allow," + csvCell(wl[i]));
      if (bl[i] != null) lines.push("block," + csvCell(bl[i]));
    }
    download("clipboard-buckler.txt", lines.join("\r\n") + "\r\n");
  }

  // Parse Text directly with Validation
  function parseAndValidateText(text) {
    if (!text || !text.trim()) {
      throw new Error("The text area is empty.");
    }

    const rows = []; 
    let field = "", row = [], q = false;
    
    // Simple CSV parser loop
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { 
          if (text[i + 1] === '"') { field += '"'; i++; } 
          else q = false; 
        }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r') { /* swallow */ }
      else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }

    // Filter empty lines
    const validRows = rows.filter(r => r.some(x => String(x).trim() !== ""));
    
    if (validRows.length === 0) {
      throw new Error("No valid data rows found.");
    }

    // Check Header
    const firstRow = validRows[0];
    const hasHeader = (/^(type|kind)$/i.test(String(firstRow[0]).trim()));
    const startIndex = hasHeader ? 1 : 0;

    const addWL = new Set(), addBL = new Set();
    let invalidLines = 0;

    for (let i = startIndex; i < validRows.length; i++) {
      const r = validRows[i];
      if (r.length < 2) {
        invalidLines++;
        continue;
      }
      
      const type = String(r[0] || "").trim().toLowerCase();
      const domRaw = r[1];
      const dom = normalizeHost(domRaw);

      if (!dom) {
        invalidLines++;
        continue;
      }

      if (type === "allow" || type === "w" || type === "whitelist") addWL.add(dom);
      else if (type === "block" || type === "b" || type === "blacklist") addBL.add(dom);
      else {
        invalidLines++; // Unknown type
      }
    }

    if (addWL.size === 0 && addBL.size === 0) {
      throw new Error("No valid entries found. Expected format: 'allow,domain' or 'block,domain'.");
    }

    return { addWL, addBL, invalidLines };
  }

  async function processImport(text) {
    const errorDiv = $("#importError");
    errorDiv.style.display = "none";
    errorDiv.textContent = "";

    try {
      const result = parseAndValidateText(text);
      
      // Merge with existing storage
      const cur = await browser.storage.local.get(["whitelist", "blacklist"]);
      const wlSet = new Set((cur.whitelist || []).map(normalizeHost).filter(Boolean));
      const blSet = new Set((cur.blacklist || []).map(normalizeHost).filter(Boolean));
      
      result.addWL.forEach(d => wlSet.add(d));   
      result.addBL.forEach(d => blSet.add(d));

      await browser.storage.local.set({
        whitelist: [...wlSet].sort(),
        blacklist: [...blSet].sort()
      });
      
      load();
      closeModal();
      
      let msg = `Successfully imported ${result.addWL.size + result.addBL.size} entries.`;
      if (result.invalidLines > 0) {
        msg += `\n(${result.invalidLines} invalid lines were skipped.)`;
      }
      alert(msg);

    } catch (e) {
      errorDiv.textContent = e.message;
      errorDiv.style.display = "block";
    }
  }

  // Modal Controls
  function openModal() {
    $("#csvTextarea").value = "";
    $("#importError").style.display = "none";
    $("#importModal").classList.add("active");
    $("#csvTextarea").focus();
  }

  function closeModal() {
    $("#importModal").classList.remove("active");
  }

  // ---------- wiring -------------------------------------------------------
  $("#wlAdd").addEventListener("click", function () { add("whitelist", $("#wlInput")); });
  $("#blAdd").addEventListener("click", function () { add("blacklist", $("#blInput")); });
  $("#wlInput").addEventListener("keydown", function (e) { if (e.key === "Enter") add("whitelist", e.target); });
  $("#blInput").addEventListener("keydown", function (e) { if (e.key === "Enter") add("blacklist", e.target); });
  $("#lockdown").addEventListener("change", async function (e) { await browser.storage.local.set({ lockdown: e.target.checked }); });

  $("#themeBtn").addEventListener("click", cycleTheme);
  $("#wlAddCurrent").addEventListener("click", function() { addCurrentTo("whitelist"); });
  $("#blAddCurrent").addEventListener("click", function() { addCurrentTo("blacklist"); });

  $("#csvBtn").addEventListener("click", function () {
    const choice = confirm("OK = EXPORT current lists to a TXT file.\nCancel = IMPORT / MERGE from a TXT file.");
    if (choice) exportTxt();
    else openModal();
  });

  $("#cancelImportBtn").addEventListener("click", closeModal);
  $("#confirmImportBtn").addEventListener("click", function() {
    const text = $("#csvTextarea").value;
    processImport(text);
  });

  browser.storage.onChanged.addListener(function (ch, area) { if (area === "local") load(); });
  load();
})();