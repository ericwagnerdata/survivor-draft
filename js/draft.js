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

  let picks = [];        // ordered: [{ drafter, name }]
  let snakeOrder = [];   // index into drafters[] for each pick slot
  let drafters = [];
  let tribes = [];
  let picksPerDrafter = 0;
  let totalPicks = 0;
  let hasRanks = false;
  let activeFilter = 'All';
  let containerEl = null;

  function storageKey() {
    return 'sdp.draft.' + DataStore.season.meta.n;
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

  function render() {
    if (!containerEl) return;
    const meta = DataStore.season.meta;
    const drafter = currentDrafter();
    const pickNum = currentPickIdx() + 1;
    const available = availablePlayers();
    const ericTop = (hasRanks && drafters.includes('Eric')) ? available[0] : null;
    const complete = currentPickIdx() >= totalPicks;

    let html = '';

    // Sandbox label for the demo season.
    if (String(meta.n) === 'demo') {
      html += `<div class="sandbox-note">Sandbox draft with placeholder castaways. Nothing here is real Survivor data. Use it to try the draft engine end to end.</div>`;
    }

    html += `<div class="section-label">Draft</div>`;

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

      // Eric's top available, shown only when it is not Eric's turn and ranks exist.
      if (ericTop && drafter !== 'Eric') {
        html += `<div class="suggestion">Eric's top available: <strong>${esc(ericTop.name)}</strong> (rank #${esc(ericTop.ericRank)}, ${esc(ericTop.ericTier)} tier)</div>`;
      }
    }

    // Teams building up, one column per drafter.
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
          <span class="pick-tribe ${esc(p.tribe)}">${esc(p.tribe)}</span>
        </div>`;
      });
      html += `</div></div>`;
    });
    html += `</div>`;

    // Controls: undo + reset.
    html += `<div class="draft-controls">`;
    if (picks.length > 0) {
      html += `<button class="btn-undo" data-act="undo">Undo last pick</button>`;
    }
    html += `<button class="btn-reset" data-act="reset">Reset draft</button>`;
    html += `</div>`;

    // Available players list (only while picks remain).
    if (!complete) {
      html += `<div class="avail-label">Available players <span class="avail-count">${available.length}</span></div>`;

      // Tier filter only makes sense when ranks/tiers exist.
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
          <span class="a-tribe ${esc(p.tribe)}">${esc(p.tribe)}</span>
          ${hasRanks ? `<span class="a-rank">#${esc(p.ericRank)}</span>` : ''}
          <button class="pick-btn" data-pick="${esc(p.name)}">Pick</button>
        </div>`;
      });
      html += `</div>`;
    }

    // Export panel (always available, even mid-draft).
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
    containerEl.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'undo') undoPick();
        else if (act === 'reset') resetDraft();
        else if (act === 'copy') copyExport(b);
        else if (act === 'download') downloadExport();
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
