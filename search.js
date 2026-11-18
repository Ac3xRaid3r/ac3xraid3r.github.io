/* search.js — sitewide Ctrl+K search.
 * On load: injects a trigger button into the sticky header, injects its CSS,
 * creates a hidden modal, and binds Ctrl/Cmd+K. On first open: fetches
 * search-index.json and keeps it in memory.
 * Pure client-side; no deps. */
(function () {
  "use strict";

  var STYLES = (
    /* Compact icon pill at every viewport width. The Ctrl+K hint lives */
    /* in the button tooltip so the nav keeps all the horizontal room. */
    ".search-trigger{display:inline-flex;align-items:center;justify-content:center;" +
    "flex:none;color:var(--muted);background:var(--panel-2);" +
    "border:1px solid var(--line);border-radius:999px;padding:7px 8px;" +
    "cursor:pointer;transition:border-color .16s ease,color .16s ease;}" +
    ".search-trigger:hover,.search-trigger:focus-visible{color:var(--signal);" +
    "border-color:var(--signal-line);outline:none}" +
    ".search-trigger .st-ico{width:14px;height:14px;flex:none}" +
    ".sm-root{position:fixed;inset:0;z-index:100;display:none;align-items:flex-start;" +
    "justify-content:center;padding:max(60px,10vh) 16px 16px;background:rgba(0,0,0,.72);" +
    "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:sm-fade .14s ease-out}" +
    ".sm-root.is-open{display:flex}" +
    "@keyframes sm-fade{from{opacity:0}to{opacity:1}}" +
    ".sm-modal{width:100%;max-width:640px;background:var(--panel);border:1px solid var(--line);" +
    "border-radius:14px;overflow:hidden;display:flex;flex-direction:column;" +
    "max-height:min(70vh,620px);box-shadow:0 20px 60px rgba(0,0,0,.6)}" +
    ".sm-head{display:flex;align-items:center;gap:10px;padding:14px 16px;" +
    "border-bottom:1px solid var(--line-soft)}" +
    ".sm-head svg{width:16px;height:16px;color:var(--muted);flex:none}" +
    ".sm-input{flex:1;background:transparent;border:0;outline:none;color:var(--fg);" +
    "font-family:var(--f-mono);font-size:15px;padding:2px 0;min-width:0}" +
    ".sm-input::placeholder{color:var(--muted-2)}" +
    ".sm-esc{font-family:var(--f-mono);font-size:10.5px;color:var(--muted-2);" +
    "background:var(--ink-2);border:1px solid var(--line-soft);border-radius:4px;padding:2px 6px;flex:none}" +
    ".sm-body{overflow-y:auto;overscroll-behavior:contain;padding:6px 0 10px}" +
    ".sm-sec{padding:10px 16px 2px;font-family:var(--f-mono);font-size:10.5px;color:var(--signal);" +
    "text-transform:uppercase;letter-spacing:.06em}" +
    ".sm-hit{display:block;padding:10px 16px;border-left:2px solid transparent;cursor:pointer;" +
    "text-decoration:none;color:inherit;transition:background .1s ease,border-color .1s ease}" +
    ".sm-hit:hover,.sm-hit.is-active{background:var(--panel-2);border-left-color:var(--signal)}" +
    ".sm-hit .sm-title{font-family:var(--f-display);font-size:14.5px;color:var(--fg);margin:0 0 2px}" +
    ".sm-hit .sm-sub{font-family:var(--f-mono);font-size:11.5px;color:var(--muted);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".sm-hit .sm-sub .sm-sep{color:var(--muted-2);margin:0 6px}" +
    ".sm-hit mark{background:var(--signal-soft);color:var(--signal);padding:0 1px;border-radius:2px}" +
    ".sm-empty{padding:24px 16px;text-align:center;font-family:var(--f-mono);font-size:13px;color:var(--muted)}" +
    ".sm-foot{display:flex;gap:16px;padding:9px 16px;border-top:1px solid var(--line-soft);" +
    "font-family:var(--f-mono);font-size:10.5px;color:var(--muted-2)}" +
    ".sm-foot kbd{font-family:inherit;background:var(--ink-2);border:1px solid var(--line-soft);" +
    "border-radius:4px;padding:1px 5px;color:var(--fg-dim);margin-right:4px}" +
    "@media (max-width:480px){.sm-foot{display:none}}"
  );

  // ---- Inject styles + trigger ----
  function injectStylesAndTrigger() {
    var style = document.createElement("style");
    style.id = "search-style";
    style.textContent = STYLES;
    document.head.appendChild(style);

    var bar = document.querySelector("header.site .bar");
    if (!bar) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-trigger";
    btn.setAttribute("aria-label", "Search the site (Ctrl K)");
    btn.setAttribute("title", "Search (Ctrl K)");
    btn.innerHTML =
      '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>' +
      "</svg>";
    btn.addEventListener("click", openModal);

    // Insert as the middle flex child so it sits between brand and nav.
    var nav = bar.querySelector("nav.top");
    if (nav) bar.insertBefore(btn, nav);
    else bar.appendChild(btn);
  }

  // ---- Modal ----
  var modal = null;
  var input = null;
  var body = null;
  var results = [];
  var activeIndex = 0;
  var indexData = null;
  var indexPromise = null;

  function buildModal() {
    modal = document.createElement("div");
    modal.className = "sm-root";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Search");
    modal.innerHTML =
      '<div class="sm-modal" role="document">' +
      '<div class="sm-head">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
      '<input class="sm-input" type="text" placeholder="Search pages and sections..." spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Search">' +
      '<span class="sm-esc">esc</span>' +
      "</div>" +
      '<div class="sm-body" role="listbox"></div>' +
      '<div class="sm-foot">' +
      "<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>" +
      "<span><kbd>↵</kbd> open</span>" +
      "<span><kbd>esc</kbd> close</span>" +
      "</div>" +
      "</div>";
    document.body.appendChild(modal);
    input = modal.querySelector(".sm-input");
    body = modal.querySelector(".sm-body");

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeyNav);
  }

  function openModal() {
    if (!modal) buildModal();
    modal.classList.add("is-open");
    input.value = "";
    activeIndex = 0;
    renderResults("");
    loadIndex();
    setTimeout(function () { input.focus(); }, 0);
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  // ---- Index loading ----
  function loadIndex() {
    if (indexData || indexPromise) return;
    indexPromise = fetch("search-index.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { indexData = data || []; renderResults(input.value.trim()); })
      .catch(function () { indexData = []; renderResults(input.value.trim()); });
  }

  // ---- Search ----
  function onInput() { activeIndex = 0; renderResults(input.value.trim()); }

  function search(q) {
    if (!indexData || !q) return [];
    var needle = q.toLowerCase();
    var terms = needle.split(/\s+/).filter(Boolean);
    var hits = [];
    for (var i = 0; i < indexData.length; i++) {
      var page = indexData[i];
      var pageTitle = page.title.toLowerCase();
      var pageSection = (page.section || "").toLowerCase();
      // Score the page itself.
      var pageScore = scoreString(pageTitle, needle, terms) * 2
                    + scoreString(pageSection, needle, terms);
      if (pageScore > 0) {
        hits.push({
          url: page.url,
          title: page.title,
          sub: page.section || "",
          anchor: "",
          score: pageScore + 100, // page-level hits rank first
        });
      }
      // Score each heading.
      if (page.headings) {
        for (var j = 0; j < page.headings.length; j++) {
          var h = page.headings[j];
          var ht = h.text.toLowerCase();
          var hs = scoreString(ht, needle, terms);
          if (hs > 0) {
            hits.push({
              url: page.url,
              title: page.title,
              sub: h.text,
              anchor: h.id,
              score: hs + 20,
            });
          }
        }
      }
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, 30);
  }

  function scoreString(hay, needle, terms) {
    var score = 0;
    if (hay.indexOf(needle) !== -1) {
      score += 50;
      if (hay.indexOf(needle) === 0) score += 50;
      if (hay === needle) score += 100;
    }
    // All term bonus
    var allMatch = terms.every(function (t) { return hay.indexOf(t) !== -1; });
    if (allMatch) score += 20;
    return score;
  }

  function renderResults(q) {
    results = search(q);
    if (!q) {
      body.innerHTML = '<div class="sm-empty">Start typing to search pages and sections.</div>';
      return;
    }
    if (!indexData) {
      body.innerHTML = '<div class="sm-empty">Loading…</div>';
      return;
    }
    if (!results.length) {
      body.innerHTML = '<div class="sm-empty">No results for “' + escapeHtml(q) + '”</div>';
      return;
    }
    var out = "";
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var href = r.anchor ? (r.url + "#" + r.anchor) : r.url;
      var cls = "sm-hit" + (i === activeIndex ? " is-active" : "");
      out +=
        '<a class="' + cls + '" href="' + href + '" data-i="' + i + '">' +
        '<p class="sm-title">' + highlight(r.title, q) + '</p>' +
        '<p class="sm-sub">' +
          '<span>' + highlight(r.sub || r.url, q) + '</span>' +
          (r.sub ? '<span class="sm-sep">•</span><span>' + escapeHtml(r.url) + '</span>' : '') +
        '</p>' +
        '</a>';
    }
    body.innerHTML = out;
    // Hover syncs the active index.
    body.querySelectorAll(".sm-hit").forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        activeIndex = parseInt(el.getAttribute("data-i"), 10) || 0;
        updateActive();
      });
    });
  }

  function updateActive() {
    var hits = body.querySelectorAll(".sm-hit");
    hits.forEach(function (el, i) {
      el.classList.toggle("is-active", i === activeIndex);
    });
    var cur = hits[activeIndex];
    if (cur) {
      var r = cur.getBoundingClientRect();
      var pr = body.getBoundingClientRect();
      if (r.top < pr.top) body.scrollTop -= pr.top - r.top + 4;
      else if (r.bottom > pr.bottom) body.scrollTop += r.bottom - pr.bottom + 4;
    }
  }

  function onKeyNav(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!results.length) return;
      activeIndex = (activeIndex + 1) % results.length;
      updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      activeIndex = (activeIndex - 1 + results.length) % results.length;
      updateActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      var r = results[activeIndex];
      if (r) window.location.href = r.anchor ? (r.url + "#" + r.anchor) : r.url;
    }
  }

  // ---- Highlighting ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function highlight(text, q) {
    var esc = escapeHtml(text);
    if (!q) return esc;
    try {
      var terms = q.split(/\s+/).filter(Boolean).map(function (t) {
        return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      });
      if (!terms.length) return esc;
      var re = new RegExp("(" + terms.join("|") + ")", "gi");
      return esc.replace(re, "<mark>$1</mark>");
    } catch (_) { return esc; }
  }

  // ---- Global keyboard binding ----
  function onGlobalKey(e) {
    var openRoot = modal && modal.classList.contains("is-open");
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (openRoot) closeModal(); else openModal();
    } else if (e.key === "Escape" && openRoot) {
      e.preventDefault();
      closeModal();
    } else if (e.key === "/" && !openRoot) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
      e.preventDefault();
      openModal();
    }
  }

  // ---- Boot ----
  function boot() {
    injectStylesAndTrigger();
    document.addEventListener("keydown", onGlobalKey);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
