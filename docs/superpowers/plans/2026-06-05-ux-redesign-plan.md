# UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite index.html with a clean, minimal UX combining Compact browse mode and Stepped review mode, with Light/Dark theme toggle.

**Architecture:** Single-file SPA (index.html) with embedded CSS + JS. Two-mode state machine (browse/review). CSS custom properties for theming. JS module pattern under `window.CJ` namespace. All API endpoints, SM-2, and data model stay unchanged.

**Tech Stack:** Vanilla JS, CSS custom properties, no frameworks or dependencies.

---

### Task 1: HTML Structure — Two-Mode Shell

**File:**
- Modify: `index.html` (full rewrite of the `<body>` inner HTML)

- [ ] **Step 1: Write the new HTML body scaffold**

Replace the entire `<body>` content with the two-mode shell:

```html
<div class="tp" id="themePicker">
  <button class="tp-btn active" data-theme="light">☀️</button>
  <button class="tp-btn" data-theme="dark">🌙</button>
</div>

<div class="toast" id="toast"></div>

<div class="app" id="app">
  <!-- BROWSE MODE -->
  <div id="modeBrowse">
    <header class="hd">
      <h1>✏️ Coding Journal <span class="bdg" id="dueBadge">0 due</span></h1>
      <span class="date" id="todayDate"></span>
    </header>

    <div class="st" id="stats">
      <div class="sc"><div class="n" id="statTotal">0</div><div class="l">Total</div></div>
      <div class="sc"><div class="n" id="statDue">0</div><div class="l">Due</div></div>
      <div class="sc"><div class="n" id="statMastered">0</div><div class="l">Mastered</div></div>
      <div class="sc"><div class="n" id="statStreak">0</div><div class="l">Streak</div></div>
    </div>

    <div class="tb" id="tabs">
      <button class="tb-btn active" data-tab="due">Due <span class="tbc" id="tDue">0</span></button>
      <button class="tb-btn" data-tab="all">All <span class="tbc" id="tAll">0</span></button>
      <button class="tb-btn" data-tab="mastered">Mastered <span class="tbc" id="tMastered">0</span></button>
      <button class="tb-btn new-btn" data-tab="add">+ New</button>
    </div>

    <div id="reviewPrompt" class="rp hidden">
      <div class="rp-title">📝 <span id="rpCount">0</span> card(s) due</div>
      <div class="rp-sub" id="rpNext">Next: </div>
      <button class="btn-p" id="rpStart">Review Now →</button>
    </div>

    <div id="content"></div>
  </div>

  <!-- REVIEW MODE -->
  <div id="modeReview" class="hidden">
    <div class="rv-hd">
      <button class="rv-back" id="rvBack">←</button>
      <div class="rv-title">Review</div>
      <div class="rv-step" id="rvStep">1 / 1</div>
    </div>
    <div class="rv-progress"><div class="rv-fill" id="rvFill"></div></div>

    <!-- Step 1: Question -->
    <div class="rv-card" id="rvQuestion">
      <div class="rv-q" id="rvQTitle"></div>
      <div class="rv-meta" id="rvQMeta"></div>
      <div class="rv-hint">Think about the approach, then rate your recall:</div>
      <div class="rv-ratings" id="rvRatings">
        <button class="rv-r" data-q="1">1<br><span class="rv-rl">Forgot</span></button>
        <button class="rv-r" data-q="2">2<br><span class="rv-rl">Vague</span></button>
        <button class="rv-r" data-q="3">3<br><span class="rv-rl">Fair</span></button>
        <button class="rv-r" data-q="4">4<br><span class="rv-rl">Good</span></button>
        <button class="rv-r" data-q="5">5<br><span class="rv-rl">Perfect</span></button>
      </div>
    </div>

    <!-- Step 2: Reveal -->
    <div class="rv-card hidden" id="rvReveal">
      <div class="rv-q-small" id="rvRevealTitle"></div>
      <div class="sl">Your code</div>
      <pre class="cb" id="rvCode"></pre>
      <div class="sl">My thinking</div>
      <div class="nb" id="rvMyThinking"></div>
      <div class="sl">Right thinking</div>
      <div class="nb" id="rvRightThinking"></div>
      <div class="rv-result" id="rvResult"></div>
      <div class="rv-actions">
        <button class="btn-p" id="rvNext">Next Card →</button>
        <button class="btn-g" id="rvEnd">End Session</button>
      </div>
    </div>

    <!-- Step 3: Complete -->
    <div class="rv-card hidden" id="rvComplete">
      <div class="rv-q" style="text-align:center">🎉 Session Complete!</div>
      <div class="rv-hint" style="text-align:center">Great work. Stats have been updated.</div>
      <button class="btn-p" id="rvDone" style="margin:16px auto 0;display:block">Done</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "ux: scaffold two-mode HTML shell"
```

---

### Task 2: CSS — Browse Mode + Light Theme

**File:**
- Modify: `index.html` (replace the `<style>` block)

- [ ] **Step 1: Write the CSS custom properties and base styles**

Replace everything inside `<style>` with:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--f:'Inter',system-ui,sans-serif;--r:12px;--rs:8px;--rl:16px}
body{font-family:var(--f);-webkit-font-smoothing:antialiased;transition:background .3s,color .3s;min-height:100vh;line-height:1.5}
button{border:none;cursor:pointer;font-family:var(--f);font-size:inherit}
input,textarea,select{font-family:var(--f);font-size:inherit}
.hidden{display:none!important}

/* Light theme (default) */
.light{background:#faf9f7;color:#1c1c1e}
.light .bdg{background:#ece8e2;color:#75644e}
.light .sc{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.light .sc .n{color:#1c1c1e}
.light .sc:nth-child(1) .n{color:#2563eb}
.light .sc:nth-child(2) .n{color:#d97706}
.light .sc:nth-child(3) .n{color:#059669}
.light .sc:nth-child(4) .n{color:#7c3aed}
.light .tb{background:#eae7e2}
.light .tb-btn{color:#75644e}
.light .tb-btn.active{background:#fff;color:#1c1c1e;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.light .tb-btn.new-btn{background:#1c1c1e;color:#fff}
.light .tbc{background:rgba(0,0,0,.08);color:inherit}
.light .cd{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04),0 0 0 1px rgba(0,0,0,.02)}
.light .tg{background:#eeeaf2;color:#5b4e6b}
.light .df{background:#fef3c7;color:#92400e}
.light .cb{background:#f5f3f1;color:#1e1e1e;border:1px solid #eeece8}
.light .nb{background:#faf9f7;border:1px solid #eeece8;color:#333}
.light .rp{background:#f1efec;border:1px solid #e6e2dc}
.light .rv-card{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.light .rv-hd{background:rgba(250,249,247,.85);border-bottom:1px solid rgba(0,0,0,.06)}
.light .rv-r{background:#f4f2ef;color:#555}
.light .rv-r:hover{background:#eae7e2}
.light .rv-r.selected{background:#1c1c1e;color:#fff}
.light .btn-p{background:#1c1c1e;color:#fff}
.light .btn-g{color:#555;border:1px solid #e0ddd8}
.light .btn-g:hover{background:#eae7e2}
.light .rv-progress{background:#eae7e2}
.light .rv-fill{background:#1c1c1e}

/* Dark theme */
.dark{background:#14141c;color:#ddd9e3}
.dark .bdg{background:#252533;color:#b0a8c0}
.dark .sc{background:#1c1c28;border:1px solid #262636}
.dark .sc .n{color:#e6e2ee}
.dark .sc:nth-child(1) .n{color:#7aa2f7}
.dark .sc:nth-child(2) .n{color:#e0af68}
.dark .sc:nth-child(3) .n{color:#9ece6a}
.dark .sc:nth-child(4) .n{color:#bb9af7}
.dark .tb{background:#1c1c28}
.dark .tb-btn{color:#9a94a6}
.dark .tb-btn.active{background:#262636;color:#e6e2ee}
.dark .tb-btn.new-btn{background:#7aa2f7;color:#0f0f16}
.dark .tbc{background:rgba(255,255,255,.1);color:inherit}
.dark .cd{background:#1c1c28;border:1px solid #262636}
.dark .tg{background:#262636;color:#c0b8d0}
.dark .df{background:#2d281a;color:#e0af68}
.dark .cb{background:#111118;color:#d4d0dc;border:1px solid #262636}
.dark .nb{background:#181822;border:1px solid #262636;color:#c8c4d0}
.dark .rp{background:#181822;border:1px solid #262636}
.dark .rv-card{background:#1c1c28;border:1px solid #262636}
.dark .rv-hd{background:rgba(20,20,28,.85);border-bottom:1px solid rgba(255,255,255,.05)}
.dark .rv-r{background:#262636;color:#bbb4c8;border:1px solid #30304a}
.dark .rv-r:hover{background:#30304a}
.dark .rv-r.selected{background:#7aa2f7;color:#0f0f16}
.dark .btn-p{background:#7aa2f7;color:#0f0f16}
.dark .btn-g{color:#999;border:1px solid #262636}
.dark .btn-g:hover{background:#262636}
.dark .rv-progress{background:#1c1c28}
.dark .rv-fill{background:#7aa2f7}
```

- [ ] **Step 2: Write layout CSS (shared across themes)**

```css
/* Theme picker */
.tp{position:fixed;top:12px;right:16px;z-index:100;display:flex;gap:4px;padding:3px;border-radius:10px;transition:background .3s}
.light .tp{background:#eae7e2}
.dark .tp{background:#1c1c28}
.tp-btn{width:30px;height:30px;border-radius:7px;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.light .tp-btn{color:#75644e}
.light .tp-btn.active{background:#fff;color:#1c1c1e;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.dark .tp-btn{color:#9a94a6}
.dark .tp-btn.active{background:#262636;color:#e6e2ee}

/* Layout */
.app{max-width:680px;margin:0 auto;padding:20px 20px 48px}

/* Header */
.hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-top:4px}
.hd h1{font-size:17px;font-weight:650;display:flex;align-items:center;gap:6px}
.bdg{font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;text-transform:uppercase;letter-spacing:.03em}
.date{font-size:11px;opacity:.5}

/* Stats */
.st{display:flex;gap:6px;margin-bottom:16px}
.sc{flex:1;padding:10px 12px;border-radius:var(--rs);min-width:0}
.sc .n{font-size:18px;font-weight:700;line-height:1.2}
.sc .l{font-size:10px;opacity:.55;margin-top:1px}

/* Tabs */
.tb{display:flex;gap:2px;margin-bottom:12px}
.tb-btn{flex:1;padding:6px 0;text-align:center;font-size:11px;font-weight:600;border-radius:6px;transition:all .15s}
.tb-btn.new-btn{flex:0 0 auto;padding:6px 12px;margin-left:auto;border-radius:12px;font-size:10px}
.tbc{display:inline-block;font-size:9px;padding:0 5px;border-radius:6px;margin-left:3px;font-weight:700}

/* Review prompt */
.rp{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:var(--rs);margin-bottom:14px}
.rp-title{font-size:13px;font-weight:600;flex:1}
.rp-sub{font-size:11px;opacity:.6}
.btn-p{display:inline-block;padding:8px 18px;border-radius:var(--rs);font-size:12px;font-weight:600}
.rp .btn-p{flex-shrink:0}

/* Card */
.cd{padding:12px 14px;margin-bottom:8px;border-radius:var(--rs);cursor:pointer;transition:all .15s}
.cd:hover{opacity:.85}
.cd .tt{font-size:13px;font-weight:600;margin-bottom:4px;line-height:1.4}
.cd .cm{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px}
.tg{font-size:9px;padding:1px 6px;border-radius:8px;font-weight:500}
.df{font-size:9px;padding:1px 6px;border-radius:8px;font-weight:600}
.cd .cf{font-size:10px;display:flex;gap:10px;opacity:.65}
.cd .sf{font-size:10px;font-weight:600}

/* Expanded card detail */
.dt{padding:10px 0 4px;border-top:1px solid;margin-top:8px;opacity:.1}
.light .dt{border-color:#ddd8d0}
.dark .dt{border-color:#262636}
.sl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;opacity:.5}
.cb{font-family:'SF Mono','Fira Code',monospace;font-size:12px;line-height:1.6;padding:10px 12px;border-radius:var(--rs);margin-bottom:10px;overflow-x:auto;white-space:pre;max-height:300px}
.nb{font-size:13px;line-height:1.6;padding:10px 12px;border-radius:var(--rs);margin-bottom:10px}
.dt .btn-g{margin-top:6px;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600}

/* Empty state */
.empty{text-align:center;padding:40px 20px}
.empty .e-title{font-size:15px;font-weight:600;margin-bottom:4px}
.empty .e-sub{font-size:12px;opacity:.5}

/* Toast */
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);z-index:999;padding:10px 20px;border-radius:var(--rs);font-size:12px;font-weight:600;transition:transform .3s,opacity .3s;opacity:0;pointer-events:none}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1}
.light .toast{background:#1c1c1e;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.15)}
.dark .toast{background:#e6e2ee;color:#14141c;box-shadow:0 4px 12px rgba(0,0,0,.3)}
```

- [ ] **Step 3: Write review mode CSS**

```css
/* Review mode */
.rv-hd{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;padding:12px 20px;gap:12px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.rv-back{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;transition:all .15s;flex-shrink:0;background:transparent}
.light .rv-back{color:#555;border:1px solid #e0ddd8}
.light .rv-back:hover{background:#eae7e2}
.dark .rv-back{color:#999;border:1px solid #262636}
.dark .rv-back:hover{background:#262636}
.rv-title{font-size:15px;font-weight:600;flex:1}
.rv-step{font-size:11px;font-weight:600;opacity:.5}
.rv-progress{height:4px;border-radius:2px;margin:56px 20px 0;overflow:hidden}
.rv-fill{height:100%;border-radius:2px;transition:width .4s ease}
.rv-card{margin:20px;border-radius:var(--rl);padding:24px}
.rv-q{font-size:18px;font-weight:700;margin-bottom:12px;line-height:1.4}
.rv-q-small{font-size:15px;font-weight:600;margin-bottom:12px;line-height:1.4}
.rv-meta{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px}
.rv-hint{font-size:13px;opacity:.6;margin-bottom:20px;line-height:1.6}
.rv-ratings{display:flex;gap:4px}
.rv-r{flex:1;padding:12px 4px;font-size:12px;font-weight:600;border-radius:var(--rs);min-width:0;text-align:center;line-height:1.3}
.rv-r .rv-rl{display:block;font-size:9px;font-weight:500;margin-top:2px}
.rv-actions{display:flex;gap:8px;margin-top:18px;flex-direction:column}
.btn-g{display:inline-block;padding:8px 18px;border-radius:var(--rs);font-size:12px;font-weight:600;text-align:center;background:transparent}
.rv-result{margin:10px 0;padding:10px 14px;border-radius:var(--rs);font-size:12px}
.light .rv-result{background:#f1efec}
.dark .rv-result{background:#181822;border:1px solid #262636}

/* Form (add card) */
.form{padding:0}
.form h2{font-size:16px;font-weight:600;margin-bottom:16px}
.fg{margin-bottom:12px}
.fg label{display:block;font-size:11px;font-weight:600;margin-bottom:4px;opacity:.7}
.fg input,.fg textarea,.fg select{width:100%;padding:8px 10px;border-radius:var(--rs);outline:none;transition:border-color .2s;font-size:13px}
.light .fg input,.light .fg textarea,.light .fg select{background:#fff;border:1px solid #e0ddd8;color:#1c1c1e}
.light .fg input:focus,.light .fg textarea:focus{border-color:#1c1c1e}
.dark .fg input,.dark .fg textarea,.dark .fg select{background:#111118;border:1px solid #262636;color:#ddd9e3}
.dark .fg input:focus,.dark .fg textarea:focus{border-color:#7aa2f7}
.fg textarea{min-height:80px;resize:vertical}
.f-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.errors{font-size:12px;color:#dc2626;margin-bottom:10px}
.errors ul{padding-left:16px}

/* Responsive */
@media(max-width:620px){
  .st{gap:4px}
  .sc{padding:8px 10px}
  .sc .n{font-size:15px}
  .rv-card{margin:16px}
  .rv-ratings{gap:3px}
  .rv-r{padding:10px 2px;font-size:11px}
  .f-row{grid-template-columns:1fr}
}
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "ux: add CSS for both themes and all layouts"
```

---

### Task 3: JS — Utility Layer + Theme Toggle

**File:**
- Modify: `index.html` (add `<script>` block after the style block, before body)

- [ ] **Step 1: Write utility helpers and theme toggle**

```js
(function(){
  var U = window.CJ = window.CJ || {};
  U.byId = function(id){return document.getElementById(id)};
  U.esc = function(v){
    if(v===null||v===undefined)return'';
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  };
  U.jsEsc = function(v){
    return String(v===null||v===undefined?'':v).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n');
  };
  U.today = function(){return new Date().toISOString().split('T')[0]};
  U.title = function(c){return c&&(c.title||c.question||'Untitled card')};
  U.sm2 = function(c){return(c&&c.sm2)||{}};
  U.toastTimer = null;
  U.showToast = function(m,d){
    d=d||2500;
    var el=U.byId('toast');
    if(!el)return;
    el.textContent=m||'';
    el.classList.remove('hidden');
    el.classList.add('show');
    if(U.toastTimer)clearTimeout(U.toastTimer);
    U.toastTimer=setTimeout(function(){el.classList.remove('show');el.classList.add('hidden')},d);
  };

  // Theme
  var theme = localStorage.getItem('cj-theme') || 'light';
  function setTheme(t){
    theme=t;
    document.body.classList.remove('light','dark');
    document.body.classList.add(t);
    localStorage.setItem('cj-theme',t);
    var btns=document.querySelectorAll('.tp-btn');
    for(var i=0;i<btns.length;i++)btns[i].classList.toggle('active',btns[i].dataset.theme===t);
  }
  U.getTheme=function(){return theme};
  U.setTheme=setTheme;

  // Init on DOMContentLoaded
  document.addEventListener('DOMContentLoaded',function(){
    setTheme(theme);

    // Theme picker
    var tpBtns=document.querySelectorAll('.tp-btn');
    for(var i=0;i<tpBtns.length;i++){
      tpBtns[i].addEventListener('click',function(){
        setTheme(this.dataset.theme);
      });
    }
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "ux: add JS utility layer and theme toggle"
```

---

### Task 4: JS — API Module

**File:**
- Modify: `index.html` (add API module before renderer)

- [ ] **Step 1: Write the API fetch module**

```js
(function(){
  var CJ = window.CJ;
  function handle(r){
    if(!r.ok)return r.json().then(function(d){throw new Error(d.error||'API error')},function(){throw new Error('API error')});
    return r.json().then(function(d){if(!d.ok)throw new Error(d.error||'API error');return d});
  }
  CJ.api = {
    getAll: function(){return fetch('/api/cards').then(handle).then(function(d){return d.cards})},
    getDue: function(){return fetch('/api/cards/due').then(handle).then(function(d){return d.cards})},
    getMastered: function(){return fetch('/api/cards/mastered').then(handle).then(function(d){return d.cards})},
    getCard: function(id){return fetch('/api/cards/'+encodeURIComponent(id)).then(handle).then(function(d){return d.card})},
    createCard: function(d){return fetch('/api/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(handle).then(function(r){return r.card})},
    updateCard: function(id,d){return fetch('/api/cards/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(handle).then(function(r){return r.card})},
    deleteCard: function(id){return fetch('/api/cards/'+encodeURIComponent(id),{method:'DELETE'}).then(handle).then(function(){return true})},
    reviewCard: function(id,q){return fetch('/api/cards/'+encodeURIComponent(id)+'?review=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quality:q})}).then(handle).then(function(d){return d.card})},
    getStats: function(){return fetch('/api/stats').then(handle).then(function(d){return d.stats})},
    exportData: function(){return fetch('/api/export').then(function(r){if(!r.ok)throw new Error('Export failed');return r.blob()}).then(function(b){var u=URL.createObjectURL(b);var a=document.createElement('a');a.href=u;a.download='coding-journal-backup.json';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);return true})},
    importData: function(c){return fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cards:c})}).then(handle).then(function(d){return d.count})}
  };
})();
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "ux: add API module"
```

---

### Task 5: JS — Browse Mode Renderer

**File:**
- Modify: `index.html` (add renderer module)

- [ ] **Step 1: Write the browse mode renderer**

```js
(function(){
  var CJ = window.CJ;
  var U = CJ.utils;
  var expanded = {};

  function sortDue(a,b){
    var an=U.sm2(a).nextReview,bn=U.sm2(b).nextReview;
    if(an!==bn){if(!an)return-1;if(!bn)return 1;return an<bn?-1:1}
    var at=Date.parse(a.created||'')||0,bt=Date.parse(b.created||'')||0;
    return bt-at;
  }

  function sortNew(a,b){
    var at=Date.parse(a.created||a.updated||'')||0,bt=Date.parse(b.created||b.updated||'')||0;
    return bt-at;
  }

  function statusText(card){
    var s=U.sm2(card);
    var r=typeof s.repetitions==='number'?s.repetitions:0;
    var n=s.nextReview;
    var t=U.today();
    if(r>=5)return {text:'Mastered',cls:'',color:'#059669'};
    if(n&&n<t)return{text:'Overdue',cls:'',color:'#dc2626'};
    if(n&&n<=t)return{text:'Due',cls:'',color:'#d97706'};
    return{text:n?'Next '+n:'New',cls:'',color:''};
  }

  function isDue(card){
    var n=U.sm2(card).nextReview;
    return !!n && n<=U.today();
  }

  CJ.renderer = {
    tab: 'due',

    refresh: function(){
      this.refreshStats();
      this.refreshTabs();
      this.renderTab();
    },

    refreshStats: function(){
      CJ.api.getStats().then(function(s){
        U.byId('statTotal').textContent=s.total||0;
        U.byId('statDue').textContent=s.due||0;
        U.byId('statMastered').textContent=s.mastered||0;
        U.byId('statStreak').textContent=s.streak||0;
      });
    },

    refreshTabs: function(){
      CJ.api.getDue().then(function(c){U.byId('tDue').textContent=c?c.length:0});
      CJ.api.getAll().then(function(c){U.byId('tAll').textContent=c?c.length:0});
      CJ.api.getMastered().then(function(c){U.byId('tMastered').textContent=c?c.length:0});
    },

    renderDueBadge: function(count){
      U.byId('dueBadge').textContent=count+' due';
    },

    renderTab: function(){
      var self=this;
      var tab=this.tab;
      if(tab==='due'){
        CJ.api.getDue().then(function(c){
          c=Array.isArray(c)?c:[];
          c.sort(sortDue);
          self.renderReviewPrompt(c);
          self.renderCardList(c,{empty:'Nothing due right now.',sub:'Nice work!'});
          self.renderDueBadge(c.length);
        });
      }else if(tab==='all'){
        CJ.api.getAll().then(function(c){
          c=Array.isArray(c)?c:[];
          c.sort(sortNew);
          U.byId('reviewPrompt')&&(U.byId('reviewPrompt').classList.add('hidden'));
          self.renderCardList(c,{empty:'No cards yet.',sub:'Use + New to add your first card.'});
        });
      }else if(tab==='mastered'){
        CJ.api.getMastered().then(function(c){
          c=Array.isArray(c)?c:[];
          c.sort(sortNew);
          U.byId('reviewPrompt')&&(U.byId('reviewPrompt').classList.add('hidden'));
          self.renderCardList(c,{empty:'No mastered cards yet.',sub:'Cards need 5 successful reps to become mastered.'});
        });
      }else if(tab==='add'){
        U.byId('reviewPrompt')&&(U.byId('reviewPrompt').classList.add('hidden'));
        this.renderAddForm();
      }
    },

    renderCardList: function(cards,opts){
      opts=opts||{};
      var el=U.byId('content');
      if(!el)return;
      if(!cards||!cards.length){
        el.innerHTML='<div class="empty"><div class="e-title">'+U.esc(opts.empty||'')+'</div>'+(opts.sub?'<div class="e-sub">'+U.esc(opts.sub)+'</div>':'')+'</div>';
        return;
      }
      el.innerHTML=cards.map(function(c){return self.renderCard(c)}).join('');
    },

    renderCard: function(card){
      if(!card)return'';
      var s=U.sm2(card);
      var st=statusText(card);
      var reps=typeof s.repetitions==='number'?s.repetitions:0;
      var id=U.jsEsc(card.id);
      var open=!!expanded[card.id];
      var notes=card.notes?'<div class="sl">Notes</div><div class="nb">'+U.esc(card.notes).replace(/\n/g,'<br>')+'</div>':'';
      return '<div class="cd" data-id="'+U.esc(card.id)+'" onclick="CJ.renderer.toggle(\''+id+'\')">'+
        '<div class="tt">'+U.esc(U.title(card))+' <span class="df">'+U.esc(card.difficulty||'medium')+'</span>'+
        (st.color?' <span class="sf" style="color:'+st.color+'">'+U.esc(st.text)+'</span>':'')+
        '</div>'+
        '<div class="cm">'+(Array.isArray(card.tags)?card.tags.map(function(t){return'<span class="tg">'+U.esc(t)+'</span>'}).join(''):'<span class="tg">untagged</span>')+'</div>'+
        '<div class="cf"><span>Reps '+reps+'</span>'+
        (s.nextReview?'<span>Next: '+s.nextReview+'</span>':'<span>Not scheduled</span>')+
        (card.link?' <a href="'+U.esc(card.link)+'" target="_blank" style="color:inherit" onclick="event.stopPropagation()">🔗</a>':'')+
        '</div>'+
        (open?'<div class="dt" onclick="event.stopPropagation()">'+
          '<div class="sl">Your code</div><pre class="cb">'+U.esc(card.actual_code||card.code||'')+'</pre>'+
          '<div class="sl">My thinking</div><div class="nb">'+(card.my_thinking?U.esc(card.my_thinking).replace(/\n/g,'<br>'):'<em>None</em>')+'</div>'+
          '<div class="sl">Right thinking</div><div class="nb">'+(card.right_thinking?U.esc(card.right_thinking).replace(/\n/g,'<br>'):'<em>None</em>')+'</div>'+
          notes+
          (isDue(card)?'<button class="btn-p" onclick="event.stopPropagation();CJ.review.startFromCard(\''+id+'\')" style="font-size:11px;padding:6px 14px;margin-top:4px">Review Now</button> ':'')+
          '<button class="btn-g" onclick="event.stopPropagation();CJ.renderer.del(\''+id+'\')">Delete</button>'+
        '</div>':'')+
      '</div>';
    },

    renderReviewPrompt: function(cards){
      var el=U.byId('reviewPrompt');
      if(!el)return;
      if(!cards||!cards.length){el.classList.add('hidden');return}
      U.byId('rpCount').textContent=cards.length;
      U.byId('rpNext').textContent='Next: '+U.esc(U.title(cards[0]));
      el.classList.remove('hidden');
    },

    toggle: function(id){
      expanded[id]=!expanded[id];
      this.renderTab();
    },

    del: function(id){
      if(!confirm('Delete this card?'))return;
      var self=this;
      CJ.api.deleteCard(id).then(function(){delete expanded[id];U.showToast('Deleted.');self.refresh()});
    },

    switchTab: function(tab){
      this.tab=tab;
      expanded={};
      var btns=document.querySelectorAll('.tb-btn');
      for(var i=0;i<btns.length;i++)btns[i].classList.toggle('active',btns[i].dataset.tab===tab);
      this.renderTab();
    }
  };
  var self=CJ.renderer;
  window.switchTab=function(t){CJ.renderer.switchTab(t)};
  // Init browse when API is ready
  document.addEventListener('DOMContentLoaded',function(){
    CJ.renderer.refresh();
  });
})();
```

Note: The inline click handlers in the HTML reference `CJ.api`, `CJ.review`, `switchTab`, `CJ.renderer.toggle`, `CJ.renderer.del` — these must all exist in the global scope.

- [ ] **Step 2: Wire up tab button clicks and review prompt**

Add event listeners after renderer init:

```js
// Wire tabs
document.addEventListener('DOMContentLoaded',function(){
  var tabs=document.querySelectorAll('.tb-btn');
  for(var i=0;i<tabs.length;i++){
    tabs[i].addEventListener('click',function(){switchTab(this.dataset.tab)});
  }
  document.getElementById('rpStart').addEventListener('click',function(){
    CJ.review.start();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "ux: add browse mode renderer with card list, tabs, expand"
```

---

### Task 6: JS — Stepped Review Mode

**File:**
- Modify: `index.html` (add review module)

- [ ] **Step 1: Write the stepped review module**

```js
(function(){
  var CJ = window.CJ;
  var U = CJ.utils;

  var state = {
    cards: [],
    idx: 0,
    active: false,
    rating: -1
  };

  function show(id){
    document.getElementById(id).classList.remove('hidden');
  }

  function hide(id){
    document.getElementById(id).classList.add('hidden');
  }

  function switchMode(mode){
    hide('modeBrowse');
    hide('modeReview');
    show('mode'+mode);
  }

  CJ.review = {
    start: function(fromCardId){
      var self=this;
      CJ.api.getDue().then(function(cards){
        cards=Array.isArray(cards)?cards:[];
        cards.sort(function(a,b){
          var an=U.sm2(a).nextReview,bn=U.sm2(b).nextReview;
          if(an!==bn){if(!an)return-1;if(!bn)return 1;return an<bn?-1:1}
          return 0;
        });
        state.cards=cards;
        state.idx=0;
        state.active=true;
        state.rating=-1;

        // If fromCardId specified, advance to that card
        if(fromCardId){
          for(var i=0;i<cards.length;i++){
            if(cards[i].id===fromCardId){state.idx=i;break;}
          }
        }

        if(!cards.length){
          U.showToast('Nothing due right now.');
          return;
        }

        switchMode('Review');
        self.renderQuestion();
      });
    },

    startFromCard: function(id){
      this.start(id);
    },

    renderQuestion: function(){
      var card=state.cards[state.idx];
      if(!card){this.end();return}

      state.rating=-1;

      U.byId('rvStep').textContent=(state.idx+1)+' / '+state.cards.length;
      U.byId('rvFill').style.width=((state.idx+1)/state.cards.length*100)+'%';

      U.byId('rvQTitle').textContent=U.title(card);
      U.byId('rvQMeta').innerHTML=
        (Array.isArray(card.tags)?card.tags.map(function(t){return'<span class="tg">'+U.esc(t)+'</span>'}).join(''):'')+
        '<span class="df">'+U.esc(card.difficulty||'medium')+'</span>';

      // Reset ratings
      var ratingBtns=document.querySelectorAll('.rv-r');
      for(var i=0;i<ratingBtns.length;i++)ratingBtns[i].classList.remove('selected');

      hide('rvReveal');
      hide('rvComplete');
      show('rvQuestion');
    },

    selectRating: function(quality){
      state.rating=parseInt(quality,10);
      var btns=document.querySelectorAll('.rv-r');
      for(var i=0;i<btns.length;i++)btns[i].classList.toggle('selected',btns[i].dataset.q===String(quality));
    },

    revealAndSubmit: function(){
      var card=state.cards[state.idx];
      var q=state.rating;
      if(q<1||q>5){U.showToast('Pick a rating first.');return}

      var self=this;
      CJ.api.reviewCard(card.id,q).then(function(reviewed){
        state.cards[state.idx]=reviewed;
        var s=reviewed.sm2||{};

        U.byId('rvRevealTitle').textContent=U.title(reviewed);
        U.byId('rvCode').textContent=reviewed.actual_code||reviewed.code||'(no code)';
        U.byId('rvMyThinking').innerHTML=reviewed.my_thinking?U.esc(reviewed.my_thinking).replace(/\n/g,'<br>'):'<em>None</em>';
        U.byId('rvRightThinking').innerHTML=reviewed.right_thinking?U.esc(reviewed.right_thinking).replace(/\n/g,'<br>'):'<em>None</em>';

        var ratingLabels={1:'Forgot',2:'Vague',3:'Fair',4:'Good',5:'Perfect'};
        U.byId('rvResult').innerHTML='Rating: <strong>'+ratingLabels[q]+' ('+q+')</strong> · Next review: <strong>'+(s.nextReview||'not scheduled')+'</strong>';

        hide('rvQuestion');
        show('rvReveal');
      }).catch(function(err){U.showToast('Review failed: '+err.message)});
    },

    nextCard: function(){
      state.idx++;
      state.rating=-1;
      if(state.idx<state.cards.length){
        this.renderQuestion();
      }else{
        show('rvReveal');
        hide('rvQuestion');
        show('rvComplete');
      }
    },

    end: function(){
      state.active=false;
      state.cards=[];
      state.idx=0;
      state.rating=-1;
      switchMode('Browse');
      CJ.renderer.refresh();
      U.showToast('Session ended.');
    },

    cancel: function(){
      if(!state.active)return;
      state.active=false;
      this.end();
    }
  };

  // Wire buttons
  document.addEventListener('DOMContentLoaded',function(){
    document.getElementById('rvBack').addEventListener('click',function(){CJ.review.cancel()});
    document.getElementById('rvEnd').addEventListener('click',function(){CJ.review.cancel()});
    document.getElementById('rvDone').addEventListener('click',function(){CJ.review.cancel()});
    document.getElementById('rvNext').addEventListener('click',function(){CJ.review.nextCard()});

    // Rating clicks
    var ratingBtns=document.querySelectorAll('.rv-r');
    for(var i=0;i<ratingBtns.length;i++){
      (function(btn){
        btn.addEventListener('click',function(){
          CJ.review.selectRating(this.dataset.q);
          // Auto-reveal after rating
          CJ.review.revealAndSubmit();
        });
      })(ratingBtns[i]);
    }

    // Keyboard shortcut: 1-5 for rating
    document.addEventListener('keydown',function(e){
      if(!state.active)return;
      var k=parseInt(e.key,10);
      if(k>=1&&k<=5){
        CJ.review.selectRating(k);
        CJ.review.revealAndSubmit();
      }
      if(e.key==='Enter'||e.key===' '){
        var reveal=document.getElementById('rvReveal');
        if(!reveal.classList.contains('hidden')){
          CJ.review.nextCard();
          e.preventDefault();
        }
      }
      if(e.key==='Escape'){
        CJ.review.cancel();
      }
    });
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "ux: add stepped review mode with keyboard shortcuts"
```

---

### Task 7: JS — Add Card Form + Export/Import

**File:**
- Modify: `index.html` (add form module)

- [ ] **Step 1: Write the add/edit card form module**

```js
(function(){
  var CJ = window.CJ;
  var U = CJ.utils;

  CJ.form = {
    editId: null,
    submitting: false,

    render: function(card){
      var el=U.byId('content');
      if(!el)return;
      var isEdit=!!card;
      this.editId=isEdit?card.id:null;

      el.innerHTML='<div class="form">'+
        '<h2>'+(isEdit?'Edit Card':'New Card')+'</h2>'+
        '<form id="cardForm">'+
          '<div class="f-row">'+
            '<div class="fg"><label>Question *</label><input type="text" id="fQ" placeholder="e.g. Two Sum" required></div>'+
            '<div class="fg"><label>Link</label><input type="url" id="fL" placeholder="https://leetcode.com/..."></div>'+
          '</div>'+
          '<div class="f-row">'+
            '<div class="fg"><label>Tags</label><input type="text" id="fT" placeholder="arrays, hash-map"></div>'+
            '<div class="fg"><label>Difficulty</label><select id="fD"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></div>'+
          '</div>'+
          '<div class="fg"><label>What I Was Thinking *</label><textarea id="fMyT" rows="3" placeholder="Describe your approach..."></textarea></div>'+
          '<div class="fg"><label>Right Thinking *</label><textarea id="fRT" rows="3" placeholder="Describe the correct approach..."></textarea></div>'+
          '<div class="fg"><label>Actual Code</label><textarea id="fCode" rows="5" placeholder="Paste code here..."></textarea></div>'+
          '<div class="fg"><label>Notes</label><textarea id="fNotes" rows="2" placeholder="Observations..."></textarea></div>'+
          '<div class="errors hidden" id="fErrors"></div>'+
          '<button type="submit" class="btn-p" id="fSubmit">'+(isEdit?'Update':'Save')+' →</button>'+
        '</form></div>';

      if(isEdit)this.populate(card);
      this.wire();
    },

    wire: function(){
      var self=this;
      document.getElementById('cardForm').addEventListener('submit',function(e){
        e.preventDefault();
        if(self.submitting)return;
        var data=self.read();
        var errs=self.validate(data);
        if(errs.length){
          document.getElementById('fErrors').innerHTML='<ul>'+errs.map(function(e){return'<li>'+U.esc(e)+'</li>'}).join('')+'</ul>';
          document.getElementById('fErrors').classList.remove('hidden');
          return;
        }
        document.getElementById('fErrors').classList.add('hidden');
        self.submitting=true;
        document.getElementById('fSubmit').disabled=true;

        var p=self.editId?CJ.api.updateCard(self.editId,data):CJ.api.createCard(data);
        p.then(function(){
          self.clear();
          U.showToast(self.editId?'Updated!':'Saved!');
          self.submitting=false;
          if(document.getElementById('fSubmit'))document.getElementById('fSubmit').disabled=false;
          switchTab('all');
          CJ.renderer.refresh();
        }).catch(function(err){
          document.getElementById('fErrors').innerHTML='<ul><li>'+U.esc(err.message)+'</li></ul>';
          document.getElementById('fErrors').classList.remove('hidden');
          self.submitting=false;
          if(document.getElementById('fSubmit'))document.getElementById('fSubmit').disabled=false;
        });
      });
    },

    read: function(){
      function v(id){return(document.getElementById(id)||{}).value||''}
      return{
        question:v('fQ').trim(),
        link:v('fL').trim(),
        tags:v('fT').split(',').map(function(t){return t.trim()}).filter(Boolean),
        difficulty:v('fD')||'medium',
        actual_code:v('fCode'),
        my_thinking:v('fMyT').trim(),
        right_thinking:v('fRT').trim(),
        notes:v('fNotes')
      };
    },

    validate: function(d){
      var e=[];
      if(!d.question)e.push('Question is required.');
      if(!d.my_thinking)e.push('What I Was Thinking is required.');
      if(!d.right_thinking)e.push('Right Thinking is required.');
      return e;
    },

    clear: function(){
      var ids=['fQ','fL','fT','fCode','fMyT','fRT','fNotes'];
      for(var i=0;i<ids.length;i++){
        var el=document.getElementById(ids[i]);
        if(el)el.value='';
      }
      document.getElementById('fD').value='medium';
      this.editId=null;
    },

    populate: function(card){
      function s(id,v){var el=document.getElementById(id);if(el)el.value=v||''}
      s('fQ',card.question);
      s('fL',card.link);
      s('fT',Array.isArray(card.tags)?card.tags.join(', '):'');
      s('fD',card.difficulty);
      s('fCode',card.actual_code||card.code);
      s('fMyT',card.my_thinking);
      s('fRT',card.right_thinking);
      s('fNotes',card.notes);
    }
  };
})();
```

- [ ] **Step 2: Wire export/import buttons**

```js
document.addEventListener('DOMContentLoaded',function(){
  var ex=document.getElementById('exportBtn');
  var im=document.getElementById('importBtn');
  var ii=document.getElementById('importInput');
  if(ex)ex.addEventListener('click',function(){CJ.api.exportData().then(function(){U.showToast('Exported!')}).catch(function(e){U.showToast(e.message)})});
  if(im&&ii)im.addEventListener('click',function(){ii.click()});
  if(ii)ii.addEventListener('change',function(e){
    var file=e.target.files&&e.target.files[0];
    if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      var d;
      try{d=JSON.parse(e.target.result)}catch(e){U.showToast('Invalid JSON.');return}
      if(!d||!Array.isArray(d.cards)){U.showToast('Invalid backup.');return}
      if(!confirm('Import '+d.cards.length+' cards?'))return;
      CJ.api.importData(d.cards).then(function(c){U.showToast('Imported '+c+' cards!');CJ.renderer.refresh()}).catch(function(e){U.showToast(e.message)});
    };
    r.readAsText(file);
    this.value='';
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "ux: add card form and export/import wiring"
```

---

### Task 8: Final Integration — Verify & Fix

**File:**
- Modify: `index.html` (ensure all script ordering and references are correct)

- [ ] **Step 1: Verify script module loading order in `<head>`**

Scripts must load in this order:
1. Utility + Theme toggle
2. API module
3. Browse renderer
4. Review mode
5. Form module
6. Init wiring (event listeners + DOMContentLoaded)

- [ ] **Step 2: Run the test suite**

```bash
node test/api-test.js
```

Expected: 18/18 passed (all API endpoints unchanged)

- [ ] **Step 3: Manual smoke test**

Open the `dev` preview URL and verify:
- [ ] Light/Dark toggle works, persists on refresh
- [ ] Browse mode shows stats, tabs, card list
- [ ] Tap card expands detail with code + notes
- [ ] Review Now button starts stepped review
- [ ] Stepped flow: question → rate → reveal with code → next
- [ ] Back/End Session returns to browse
- [ ] Add new card works via + New tab
- [ ] Delete works with confirmation
- [ ] Import/Export buttons work

- [ ] **Step 4: Commit any fixes**

```bash
git add index.html
git commit -m "ux: fix integration issues from testing"
```

---

### Task 9: Merge to Main

- [ ] **Step 1: Switch to main, merge dev**

```bash
git checkout main
git merge dev
git push
```

- [ ] **Step 2: Verify prod deployment**

Visit the production Vercel URL and confirm everything works.

---