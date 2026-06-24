/* draft.js - interactive snake draft engine for undrafted seasons.
   Ported from the standalone draftboard tool, adapted to the app's data model:
   reads players + config from DataStore.season, holds live state in localStorage
   keyed per season (sdp.draft.<n>), and exports a finished players.json.

   app.js calls Draft.render(container) from renderDraft() only when the season
   is NOT drafted yet. Drafted seasons (S50) keep their read-only recap. */

const Draft = (function () {
  // Drafter colors come from CSS classes (eric/kris/kelly). The engine is
  // config-driven otherwise: drafters, picksPerDrafter, and tribes are read
  // from season.meta so future seasons need no code changes.

  /* ---- Eric view PIN gate (casual lock, not real security) ----
     The draft screen has two views: a Public board (default, shared on draft
     night) and Eric's private cheat sheet (ranks, tiers, "top available"). The
     Eric view is hidden behind a PIN so people do not stumble onto Eric's
     rankings on the shared screen. This is NOT real security: the rankings live
     in the public players.json, so anyone determined can read them. The gate
     only stops accidental reveals.

     We store a SHA-256 hash of the PIN (never the plaintext) and compare the
     entered PIN's hash with the Web Crypto API. Default PIN: "survivor".

     To change the PIN: compute the SHA-256 hex of the new PIN and paste it into
     ERIC_PIN_HASH below. One-liners:
       Browser console: crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOURPIN')).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
       Node / git-bash: printf '%s' 'YOURPIN' | sha256sum                            */
  const ERIC_PIN_HASH = '7a01ac37408614bcf58069bb6b6a543f6c473cdded552c491de4eb36aacce235'; // "survivor"
  const UNLOCK_KEY = 'sdp.draft.ericUnlocked'; // sessionStorage flag, per browser session

  let picks = [];        // ordered: [{ drafter, name }]
  let snakeOrder = [];   // index into drafters[] for each pick slot
  let drafters = [];
  let tribes = [];
  let picksPerDrafter = 0;
  let totalPicks = 0;
  let hasRanks = false;
  let activeFilter = 'All';
  let containerEl = null;
  let mode = 'public';   // 'public' (default) or 'eric'
  let pinError = false;  // true after a wrong PIN, to show a gentle error state

  function storageKey() {
    return 'sdp.draft.' + DataStore.season.meta.n;
  }

  // Has Eric's view been unlocked this session? Remembered so toggling back and
  // forth between Public and Eric does not re-prompt for the PIN.
  function isUnlocked() {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
  }
  function setUnlocked() {
    try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch (e) { /* ignore */ }
  }

  // SHA-256 hex of a string via the built-in Web Crypto API (no libraries).
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Snake order: round 0 in drafter order, round 1 reversed, alternating.
  function buildSnakeOrder(numDrafters, rounds) {
    const order = [];
    const forward = [];
    for (let i = 0; i < numDrafters; i++) forward.push(i);
    const back = forward.slice().reverse();
    for (let r = 0; r < rounds; r++) {
      (r % 2 === 0 ? forward : back).forEach(i => order.push(i));
    }
    return order;
  }

  function init() {
    const meta = DataStore.season.meta;
    drafters = Array.isArray(meta.drafters) ? meta.drafters.slice() : [];
    tribes = Array.isArray(meta.tribes) ? meta.tribes.slice() : [];
    picksPerDrafter = Number(meta.picksPerDrafter) || 0;
    totalPicks = drafters.length * picksPerDrafter;
    snakeOrder = buildSnakeOrder(drafters.length, picksPerDrafter);
    // Ranks present only if every player carries a numeric ericRank.
    hasRanks = DataStore.season.players.length > 0
      && DataStore.season.players.every(p => typeof p.ericRank === 'number');
    activeFilter = 'All';
    // Default to the public board. Stay in Eric view only if already unlocked.
    mode = 'public';
    pinError = false;
    loadState();
  }

  /* ---- Persistence ---- */

  function loadState() {
    picks = [];
    let raw = null;
    try { raw = localStorage.getItem(storageKey()); } catch (e) { raw = null; }
    if (!raw) return;
    let saved;
    try { saved = JSON.parse(raw); } catch (e) { return; }
    if (!saved || !Array.isArray(saved.picks)) return;
    // Keep only picks whose player still exists in this season's roster.
    const names = new Set(DataStore.season.players.map(p => p.name));
    picks = saved.picks
      .filter(pk => pk && names.has(pk.name) && drafters.includes(pk.drafter))
      .slice(0, totalPicks);
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ picks }));
    } catch (e) { /* storage full or blocked: draft still works in-session */ }
  }

  /* ---- Draft logic ---- */

  function draftedNames() {
    return new Set(picks.map(p => p.name));
  }

  function currentPickIdx() { return picks.length; }

  function currentDrafter() {
    if (currentPickIdx() >= totalPicks) return null;
    return drafters[snakeOrder[currentPickIdx()]];
  }

  function availablePlayers() {
    const taken = draftedNames();
    const pool = DataStore.season.players.filter(p => !taken.has(p.name));
    if (hasRanks) {
      pool.sort((a, b) => a.ericRank - b.ericRank);
    }
    // No ranks: leave in roster order (the array's natural order).
    return pool;
  }

  function playerByName(name) {
    return DataStore.season.players.find(p => p.name === name) || null;
  }

  function makePick(name) {
    if (draftedNames().has(name)) return;
    const drafter = currentDrafter();
    if (!drafter) return;
    picks.push({ drafter, name });
    saveState();
    render();
  }

  function undoPick() {
    if (!picks.length) return;
    picks.pop();
    saveState();
    render();
  }

  function resetDraft() {
    if (!window.confirm('Reset this draft? All picks will be cleared.')) return;
    picks = [];
    saveState();
    render();
  }

  function setFilter(f) {
    activeFilter = f;
    render();
  }

  /* ---- View mode (Public board vs PIN-gated Eric view) ---- */

  function switchToPublic() {
    mode = 'public';
    pinError = false;
    render();
  }

  // Request the Eric view. If already unlocked this session, go straight there;
  // otherwise show the PIN prompt (render handles that when pinPrompt is true).
  let pinPrompt = false;
  function requestEricView() {
    if (isUnlocked()) {
      mode = 'eric';
      pinPrompt = false;
      pinError = false;
      render();
      return;
    }
    pinPrompt = true;
    pinError = false;
    render();
    const input = containerEl.querySelector('#pin-input');
    if (input) input.focus();
  }

  function cancelPin() {
    pinPrompt = false;
    pinError = false;
    render();
  }

  // Check an entered PIN against the stored hash. Correct -> unlock + Eric view.
  // Wrong -> stay on the public board with a gentle error message.
  async function submitPin(value) {
    const entered = (value || '').trim();
    let ok = false;
    try { ok = (await sha256Hex(entered)) === ERIC_PIN_HASH; } catch (e) { ok = false; }
    if (ok) {
      setUnlocked();
      mode = 'eric';
      pinPrompt = false;
      pinError = false;
    } else {
      mode = 'public';
      pinPrompt = false;
      pinError = true;
    }
    render();
  }

  /* ---- Export ---- */

  // Produce the full players.json content with drafter + pick filled in.
  // Static fields are preserved; undrafted leftovers keep drafter:null, pick:null.
  function buildExport() {
    const pickByName = {};
    picks.forEach((pk, i) => { pickByName[pk.name] = { drafter: pk.drafter, pick: i + 1 }; });
    return DataStore.season.players.map(p => {
      const assigned = pickByName[p.name] || { drafter: null, pick: null };
      return {
        name: p.name,
        tribe: p.tribe,
        age: p.age,
        occupation: p.occupation,
        seasons: p.seasons,
        drafter: assigned.drafter,
        pick: assigned.pick,
        ericRank: p.ericRank,
        ericTier: p.ericTier,
        photo: p.photo,
        eliminated: p.eliminated === true,
        eliminatedEpisode: (p.eliminatedEpisode === undefined ? null : p.eliminatedEpisode)
      };
    });
  }

  function exportJSON() {
    return JSON.stringify(buildExport(), null, 2) + '\n';
  }

  function copyExport(btn) {
    const text = exportJSON();
    const done = ok => {
      if (!btn) return;
      const label = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { btn.textContent = label; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } else {
      // Fallback for non-secure contexts.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
  }

  function downloadExport() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'players.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---- Rendering ---- */

  function dc(d) { return String(d).toLowerCase(); }

  function tierBadge(p) {
    if (!p.ericTier) return '';
    return `<span class="tier-badge ${esc(p.ericTier)}">${esc(p.ericTier)}</span>`;
  }

  // Tribe badge colored from the season's palette (DataStore.tribeColor), applied
  // inline so any tribe names work. cls only carries shape/size from the CSS.
  function tribeBadgeHTML(tribe, cls) {
    const c = DataStore.tribeColor(tribe);
    return `<span class="${cls}" style="background:${c.bg};color:${c.text}">${esc(tribe)}</span>`;
  }

  // View toggle: Public board (default) vs Eric view (PIN-gated). The Eric
  // button carries a small lock when still locked this session.
  function toggleBarHTML() {
    const ericLocked = !isUnlocked();
    const lock = ericLocked ? '<span class="view-lock" aria-hidden="true">[lock]</span> ' : '';
    return `<div class="view-toggle">
      <button class="view-btn ${mode === 'public' ? 'active' : ''}" data-view="public">Public board</button>
      <button class="view-btn ${mode === 'eric' ? 'active' : ''}" data-view="eric">${lock}Eric view</button>
    </div>`;
  }

  // The PIN prompt, shown on the public board when Eric view is requested locked.
  function pinPromptHTML() {
    return `<div class="pin-prompt">
      <label class="pin-label" for="pin-input">Enter PIN for Eric view</label>
      <div class="pin-row">
        <input id="pin-input" class="pin-input" type="password" inputmode="numeric"
          autocomplete="off" placeholder="PIN">
        <button class="btn-export" data-act="pin-submit">Unlock</button>
        <button class="btn-undo" data-act="pin-cancel">Cancel</button>
      </div>
      ${pinError ? `<div class="pin-error">Incorrect PIN. Staying on the public board.</div>` : ''}
    </div>`;
  }

  // Compact public chip: thumbnail + name + tribe badge, the whole chip is the
  // pick button. Reveals nothing about ranks or tiers.
  function publicChipHTML(p) {
    return `<button class="cast-chip" data-pick="${esc(p.name)}" title="Pick ${esc(p.name)}">
      <span class="chip-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></span>
      <span class="chip-name">${esc(p.name)}</span>
      ${tribeBadgeHTML(p.tribe, 'chip-tribe')}
    </button>`;
  }

  function render() {
    if (!containerEl) return;
    const meta = DataStore.season.meta;
    const drafter = currentDrafter();
    const pickNum = currentPickIdx() + 1;
    const available = availablePlayers();
    // Eric's top suggestion is private to the Eric view.
    const ericTop = (mode === 'eric' && hasRanks && drafters.includes('Eric')) ? available[0] : null;
    const complete = currentPickIdx() >= totalPicks;

    let html = '';

    // Sandbox label for the demo season.
    if (String(meta.n) === 'demo') {
      html += `<div class="sandbox-note">Sandbox draft with placeholder castaways. Nothing here is real Survivor data. Use it to try the draft engine end to end.</div>`;
    }

    html += `<div class="section-label">Draft</div>`;

    // View toggle (Public board default / PIN-gated Eric view).
    html += toggleBarHTML();
    if (pinPrompt) html += pinPromptHTML();

    // On-the-clock banner (or completion banner).
    if (complete) {
      html += `<div class="done-banner">Draft complete</div>`;
    } else {
      html += `<div class="clock-banner ${dc(drafter)}">
        <div>
          <div class="clock-meta">On the Clock</div>
          <div class="clock-name">${esc(drafter)}</div>
        </div>
        <div class="clock-pick-num">#${pickNum}</div>
      </div>`;

      // Eric's top available: Eric view only, when it is not Eric's turn.
      if (ericTop && drafter !== 'Eric') {
        html += `<div class="suggestion">Eric's top available: <strong>${esc(ericTop.name)}</strong> (rank #${esc(ericTop.ericRank)}, ${esc(ericTop.ericTier)} tier)</div>`;
      }
    }

    // Teams building up, one column per drafter (shared by both views).
    html += `<div class="teams">`;
    drafters.forEach(d => {
      const teamPicks = picks.filter(p => p.drafter === d);
      html += `<div class="team-col">
        <div class="team-header ${dc(d)}">${esc(d)} <span class="team-count">${teamPicks.length}/${picksPerDrafter}</span></div>
        <div class="team-picks">`;
      teamPicks.forEach(pk => {
        const p = playerByName(pk.name);
        if (!p) return;
        html += `<div class="team-pick">
          <div class="pick-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></div>
          <span class="pick-name">${esc(p.name)}</span>
          ${tribeBadgeHTML(p.tribe, 'pick-tribe')}
        </div>`;
      });
      html += `</div></div>`;
    });
    html += `</div>`;

    // Controls: undo + reset (shared).
    html += `<div class="draft-controls">`;
    if (picks.length > 0) {
      html += `<button class="btn-undo" data-act="undo">Undo last pick</button>`;
    }
    html += `<button class="btn-reset" data-act="reset">Reset draft</button>`;
    html += `</div>`;

    // Available players (only while picks remain) - rendered per view.
    if (!complete) {
      html += `<div class="avail-label">Available players <span class="avail-count">${available.length}</span></div>`;

      if (mode === 'eric') {
        // Eric view: ranked list with tiers, tier filter, and top-pick highlight.
        if (hasRanks) {
          const fb = (label, val) =>
            `<button class="filter-btn ${activeFilter === val ? 'active' : ''}" data-filter="${esc(val)}">${esc(label)}</button>`;
          html += `<div class="filter-row">
            ${fb('All', 'All')}${fb('High', 'High')}${fb('Med', 'Medium')}${fb('Low', 'Low')}
          </div>`;
        }

        const list = (hasRanks && activeFilter !== 'All')
          ? available.filter(p => p.ericTier === activeFilter)
          : available;

        html += `<div class="player-list">`;
        list.forEach(p => {
          const isTop = ericTop && p.name === ericTop.name;
          html += `<div class="avail-player ${isTop ? 'eric-top' : ''}">
            <div class="a-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></div>
            <div class="a-info">
              <div class="a-name">${esc(p.name)}</div>
              <div class="a-meta">${esc(p.seasons)} &middot; Age ${esc(p.age)}</div>
            </div>
            ${tierBadge(p)}
            ${tribeBadgeHTML(p.tribe, 'a-tribe')}
            ${hasRanks ? `<span class="a-rank">#${esc(p.ericRank)}</span>` : ''}
            <button class="pick-btn" data-pick="${esc(p.name)}">Pick</button>
          </div>`;
        });
        html += `</div>`;
      } else {
        // Public board: every available castaway at once as compact chips. No
        // ranks, tiers, or suggestion. Use roster order (not the rank sort) so the
        // chip order reveals nothing about Eric's private ordering.
        const taken = draftedNames();
        const publicPool = DataStore.season.players.filter(p => !taken.has(p.name));
        html += `<div class="cast-board">`;
        publicPool.forEach(p => { html += publicChipHTML(p); });
        html += `</div>`;
      }
    }

    // Export panel (always available, even mid-draft; shared).
    html += `<div class="export-panel">
      <div class="avail-label">Finalize</div>
      <p class="export-note">Export the season's players.json with every pick filled in, then save it to <code>data/seasons/${esc(meta.n)}/players.json</code> and commit it. That finished file is what turns this draft into the season's data.</p>
      <div class="draft-controls">
        <button class="btn-export" data-act="copy">Copy draft JSON</button>
        <button class="btn-export" data-act="download">Download players.json</button>
      </div>
    </div>`;

    containerEl.innerHTML = html;
    wire();
  }

  function wire() {
    containerEl.querySelectorAll('[data-pick]').forEach(b => {
      b.addEventListener('click', () => makePick(b.dataset.pick));
    });
    containerEl.querySelectorAll('[data-filter]').forEach(b => {
      b.addEventListener('click', () => setFilter(b.dataset.filter));
    });
    // View toggle: Public board vs PIN-gated Eric view.
    containerEl.querySelectorAll('[data-view]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.view === 'public') switchToPublic();
        else requestEricView();
      });
    });
    // PIN entry: submit on click or Enter.
    const pinInput = containerEl.querySelector('#pin-input');
    if (pinInput) {
      pinInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitPin(pinInput.value); }
      });
    }
    containerEl.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'undo') undoPick();
        else if (act === 'reset') resetDraft();
        else if (act === 'copy') copyExport(b);
        else if (act === 'download') downloadExport();
        else if (act === 'pin-submit') {
          const inp = containerEl.querySelector('#pin-input');
          submitPin(inp ? inp.value : '');
        }
        else if (act === 'pin-cancel') cancelPin();
      });
    });
  }

  // Public entry point: app.js calls this from renderDraft for undrafted seasons.
  function renderInto(container) {
    containerEl = container;
    init();
    render();
  }

  return { render: renderInto };
})();
