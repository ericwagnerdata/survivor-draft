/* app.js - hash routing + rendering for Phase 1 (viewing UI).
   Season is the first hash segment, so links are shareable:
     #/<n>/draft                          -> draft board recap (or placeholder if undrafted)
     #/<n>/standings                      -> standings leaderboard (rows drill into a team)
     #/<n>/cast                           -> full cast with tribe + drafter filters
     #/<n>/team/Eric | /Kris | /Kelly     -> one drafter's team in pick order
   The URL is the source of truth for which season is shown. localStorage only
   supplies a default season when the URL has none. */

const DRAFTERS = ['Eric', 'Kris', 'Kelly'];
const TRIBES = ['Vatu', 'Cila', 'Kalo'];
const VIEWS = ['draft', 'standings', 'stats', 'cast', 'team', 'admin'];
const SEASON_KEY = 'sdp.season';

const view = document.getElementById('view');
const picker = document.getElementById('season-picker');
const subtitle = document.getElementById('season-subtitle');
const footer = document.getElementById('footer');
const tabs = document.getElementById('tabs');

// Cast filter state (lives across re-renders of the cast view).
let castFilter = { tribe: 'All', drafter: 'All' };

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// A tribe badge colored by the loaded season's tribe palette (DataStore.tribeColor).
// Inline style keeps it generic for any tribe names, no per-tribe CSS class needed.
function tribeBadge(tribe, cls) {
  const c = DataStore.tribeColor(tribe);
  return `<span class="${cls}" style="background:${c.bg};color:${c.text}">${esc(tribe)}</span>`;
}

// Small visible reveal indicator so viewers know where the spoiler gate stops.
// Only shown once a season has visible episodes.
function revealIndicator() {
  if (!DataStore.hasAired()) return '';
  return `<div class="reveal-note">Showing through episode ${esc(DataStore.currentEpisode())}</div>`;
}

function photoCard(p) {
  // Undrafted seasons (e.g. the demo) have drafter:null, so guard the class
  // and only show the drafter badge once a player has been drafted.
  // Elimination is derived from the effective episodes, not the static field.
  const drafterClass = p.drafter ? p.drafter.toLowerCase() : '';
  const elim = DataStore.eliminationInfo(p.name);
  const elimClass = elim.eliminated ? ' eliminated' : '';
  const elimTag = elim.eliminated
    ? `<div class="elim-tag">Out, episode ${esc(elim.episode)}</div>`
    : '';
  const drafterBadge = p.drafter
    ? `<span class="drafter-badge ${drafterClass}">${esc(p.drafter)}</span>`
    : '';
  return `
    <div class="player-card ${drafterClass}${elimClass}">
      <div class="card-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></div>
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-meta">Age ${esc(p.age)}</div>
      <div class="card-occupation">${esc(p.occupation)}</div>
      <div class="card-seasons">${esc(p.seasons)}</div>
      <div class="badge-row">
        ${tribeBadge(p.tribe, 'tribe-badge')}
        ${drafterBadge}
      </div>
      ${elimTag}
    </div>`;
}

/* ---- Views ---- */

function renderDraft() {
  // Undrafted seasons run the interactive snake draft engine (js/draft.js).
  // Drafted seasons (S50) fall through to the locked read-only recap below.
  if (!DataStore.isDrafted()) {
    Draft.render(view);
    return;
  }

  const columns = DRAFTERS.map(d => {
    const dc = d.toLowerCase();
    const picks = DataStore.playersByDrafter(d).map(p => `
      <div class="draft-pick">
        <div class="draft-pick-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></div>
        <div class="draft-pick-info">
          <div class="draft-pick-name">${esc(p.name)}</div>
          ${tribeBadge(p.tribe, 'tribe-badge')}
        </div>
        <div class="draft-pick-num">#${esc(p.pick)}</div>
      </div>`).join('');
    return `
      <div class="draft-col">
        <div class="draft-col-header ${dc}">${esc(d)}</div>
        <div class="draft-col-picks">${picks}</div>
      </div>`;
  }).join('');

  view.innerHTML = `
    <div class="section-label">Draft Board</div>
    <p class="summary">Snake draft, 8 rounds per drafter, in pick order.</p>
    <div class="draft-board">${columns}</div>`;
}

function renderStandings() {
  const aired = DataStore.hasAired();
  const rows = DRAFTERS
    .map(d => {
      const rem = DataStore.playersRemaining(d);
      return { drafter: d, score: DataStore.teamScore(d), alive: rem.alive, total: rem.total };
    })
    .sort((a, b) => b.score - a.score);

  const banner = aired ? '' : `
    <div class="preseason-banner">Season has not started. No points yet. Standings update once episodes are logged.</div>`;

  const n = DataStore.season.meta.n;
  const list = rows.map((r, i) => `
    <a class="standing-row ${r.drafter.toLowerCase()}" href="#/${n}/team/${esc(r.drafter)}">
      <div class="standing-rank">${i + 1}</div>
      <div class="standing-info">
        <div class="standing-name">${esc(r.drafter)}</div>
        <div class="standing-sub">${r.alive} of ${r.total} players remaining</div>
      </div>
      <div class="standing-score">
        <div class="standing-pts">${r.score}</div>
        <div class="standing-pts-label">points</div>
      </div>
      <div class="standing-chev">&rsaquo;</div>
    </a>`).join('');

  const episodes = DataStore.visibleEpisodes();
  const summary = aired
    ? `${episodes.length} ${episodes.length === 1 ? 'episode' : 'episodes'} logged.`
    : DataStore.isDrafted()
      ? `${DataStore.season.players.length} castaways drafted across 3 teams. The season has not aired.`
      : `Draft is not complete yet. Open the Draft tab to run it.`;

  // Chart + episode log only once a season has aired, so there is no empty chart.
  const chartBlock = aired ? `
    <div class="section-label" style="margin-top:26px">Points over time</div>
    <div class="chart-wrap"><canvas id="trend-chart"></canvas></div>` : '';

  const logBlock = aired ? renderEpisodeLog(episodes) : '';

  // A small commissioner link for Eric (PIN-gated route). Only on drafted seasons.
  const adminLink = DataStore.isDrafted()
    ? `<a class="commish-link" href="#/${n}/admin">Commissioner</a>`
    : '';

  view.innerHTML = `
    <div class="section-label">Standings</div>
    ${revealIndicator()}
    <p class="summary">${esc(summary)}</p>
    ${banner}
    <div class="standings">${list}</div>
    ${chartBlock}
    ${logBlock}
    ${adminLink}`;

  if (aired) {
    const canvas = view.querySelector('#trend-chart');
    if (canvas) Charts.standingsTrend(canvas, DataStore.cumulativeStandings(DRAFTERS));
  }
}

// Episode log: numbered rows, most recent first, with eliminations and the
// total points awarded that episode.
function renderEpisodeLog(episodes) {
  const sorted = episodes.slice().sort((a, b) => b.episode - a.episode);
  const rows = sorted.map(ep => {
    const elims = Array.isArray(ep.eliminated) && ep.eliminated.length
      ? ep.eliminated.map(n => esc(n)).join(', ')
      : 'No elimination';
    const date = ep.airDate ? esc(ep.airDate) : '';
    const title = ep.title ? esc(ep.title) : `Episode ${esc(ep.episode)}`;
    return `
      <div class="log-row">
        <div class="log-num">${esc(ep.episode)}</div>
        <div class="log-info">
          <div class="log-title">${title}</div>
          <div class="log-sub">${date ? date + ' &middot; ' : ''}Out: ${elims}</div>
        </div>
        <div class="log-pts">
          <div class="log-pts-num">${DataStore.episodePoints(ep)}</div>
          <div class="log-pts-label">pts</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="section-label" style="margin-top:26px">Episode log</div>
    <div class="episode-log">${rows}</div>`;
}

/* ---- Stats tab ----
   Three groups (By Manager / By Team / By Player), each with a per-episode and
   a cumulative view, a chart, and a table with a Sum row. All gated to
   visibleEpisodes via the DataStore stats helpers. UI state (which group, which
   mode) lives across re-renders below. */

let statsState = { group: 'manager', mode: 'cumulative' };

// Build a stats dataset + its color function for the active group.
function statsForGroup(group) {
  const meta = DataStore.season.meta;
  const drafters = Array.isArray(meta.drafters) ? meta.drafters : DRAFTERS;
  const tribes = (Array.isArray(meta.tribes) && meta.tribes.length)
    ? meta.tribes
    : [...new Set(DataStore.season.players.map(p => p.tribe))];

  if (group === 'team') {
    return {
      data: DataStore.pointsByTribe(tribes),
      colorOf: name => DataStore.tribeColor(name).base
    };
  }
  if (group === 'player') {
    // Color each castaway by their tribe so the dense set stays readable.
    const tribeOf = {};
    DataStore.season.players.forEach(p => { tribeOf[p.name] = p.tribe; });
    return {
      data: DataStore.pointsByCastaway(),
      colorOf: name => DataStore.tribeColor(tribeOf[name]).base
    };
  }
  // Default: by manager (drafter), using the fixed drafter palette.
  const DRAFTER_HEX = { Eric: '#D4A017', Kris: '#7B68EE', Kelly: '#C0226A' };
  return {
    data: DataStore.pointsByManager(drafters),
    colorOf: name => DRAFTER_HEX[name] || '#888'
  };
}

// A rows=episodes, columns=entities table with a Sum total row. mode picks
// per-episode points or the cumulative running total per cell.
function statsTable(stats, mode, colorOf) {
  const { episodes, keys } = stats;
  const cellSource = mode === 'cumulative' ? stats.cumulative : stats.perEpisode;

  const head = keys.map(k =>
    `<th style="color:${colorOf(k)}">${esc(k)}</th>`).join('');

  const body = episodes.map((epNum, i) => {
    const cells = keys.map(k => `<td>${cellSource[k][i]}</td>`).join('');
    return `<tr><th class="stats-rowhead">Ep ${esc(epNum)}</th>${cells}</tr>`;
  }).join('');

  // Sum row: per-episode totals add up to the grand total; cumulative's final
  // value already is the grand total, so the Sum row matches in both modes.
  const sumCells = keys.map(k => `<td>${stats.totals[k]}</td>`).join('');

  return `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead><tr><th class="stats-rowhead">Episode</th>${head}</tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><th class="stats-rowhead">Sum</th>${sumCells}</tr></tfoot>
      </table>
    </div>`;
}

function renderStats() {
  const n = DataStore.season.meta.n;

  // Stats only make sense once a season has visible (gated) episodes.
  if (!DataStore.hasAired()) {
    view.innerHTML = `
      <div class="section-label">Stats</div>
      <div class="preseason-banner">No episodes yet. Stats appear once the season airs and the commissioner logs results.</div>`;
    return;
  }

  const groups = [['manager', 'By Manager'], ['team', 'By Team'], ['player', 'By Player']];
  const modes = [['perEpisode', 'Per episode'], ['cumulative', 'Cumulative']];

  const groupBtns = groups.map(([v, label]) =>
    `<button class="filter-btn${statsState.group === v ? ' active' : ''}" data-stats-group="${v}">${label}</button>`).join('');
  const modeBtns = modes.map(([v, label]) =>
    `<button class="filter-btn${statsState.mode === v ? ' active' : ''}" data-stats-mode="${v}">${label}</button>`).join('');

  const { data, colorOf } = statsForGroup(statsState.group);
  const table = statsTable(data, statsState.mode, colorOf);

  view.innerHTML = `
    <div class="section-label">Stats</div>
    ${revealIndicator()}
    <div class="filter-group">
      <div class="filter-caption">Group</div>
      <div class="filter-row">${groupBtns}</div>
    </div>
    <div class="filter-group">
      <div class="filter-caption">View</div>
      <div class="filter-row">${modeBtns}</div>
    </div>
    <div class="chart-wrap"><canvas id="stats-chart"></canvas></div>
    ${table}`;

  const canvas = view.querySelector('#stats-chart');
  if (canvas) {
    if (statsState.mode === 'cumulative') {
      Charts.cumulativeLines(canvas, data.episodes, data.keys, data.cumulative, colorOf);
    } else {
      Charts.perEpisodeBars(canvas, data.episodes, data.keys, data.perEpisode, colorOf);
    }
  }

  view.querySelectorAll('[data-stats-group]').forEach(b => {
    b.addEventListener('click', () => { statsState.group = b.dataset.statsGroup; renderStats(); });
  });
  view.querySelectorAll('[data-stats-mode]').forEach(b => {
    b.addEventListener('click', () => { statsState.mode = b.dataset.statsMode; renderStats(); });
  });
}

function renderCast() {
  const meta = DataStore.season.meta;
  const drafted = DataStore.isDrafted();
  // Filter options come from this season, not hardcoded S50 values.
  const seasonTribes = (Array.isArray(meta.tribes) && meta.tribes.length)
    ? meta.tribes
    : [...new Set(DataStore.season.players.map(p => p.tribe))];
  const seasonDrafters = Array.isArray(meta.drafters) ? meta.drafters : DRAFTERS;
  // Drop any active filter that does not apply to this season.
  if (castFilter.tribe !== 'All' && !seasonTribes.includes(castFilter.tribe)) castFilter.tribe = 'All';
  if (!drafted) castFilter.drafter = 'All';

  let players = DataStore.season.players.slice();
  if (castFilter.tribe !== 'All') players = players.filter(p => p.tribe === castFilter.tribe);
  if (castFilter.drafter !== 'All') players = players.filter(p => p.drafter === castFilter.drafter);

  const btn = (label, group, value) => {
    const active = castFilter[group] === value ? ' active' : '';
    return `<button class="filter-btn${active}" data-group="${group}" data-value="${esc(value)}">${esc(label)}</button>`;
  };

  const tribeBtns = ['All', ...seasonTribes].map(t => btn(t, 'tribe', t)).join('');
  // Drafter filter only makes sense once a season is drafted.
  const drafterGroup = drafted ? `
    <div class="filter-group">
      <div class="filter-caption">Drafter</div>
      <div class="filter-row">${['All', ...seasonDrafters].map(d => btn(d, 'drafter', d)).join('')}</div>
    </div>` : '';

  view.innerHTML = `
    <div class="section-label">Full Cast</div>
    <div class="filter-group">
      <div class="filter-caption">Tribe</div>
      <div class="filter-row">${tribeBtns}</div>
    </div>
    ${drafterGroup}
    <p class="meta-line">${players.length} of ${DataStore.season.players.length} castaways</p>
    <div class="card-grid" style="margin-top:14px">${players.map(photoCard).join('')}</div>`;

  view.querySelectorAll('.filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      castFilter[b.dataset.group] = b.dataset.value;
      renderCast();
    });
  });
}

function renderTeam(drafter) {
  if (!DRAFTERS.includes(drafter)) drafter = 'Eric';
  const team = DataStore.playersByDrafter(drafter);
  const score = DataStore.teamScore(drafter);
  const rem = DataStore.playersRemaining(drafter);
  const dc = drafter.toLowerCase();

  const n = DataStore.season.meta.n;
  const switcher = DRAFTERS.map(d => {
    const active = d === drafter ? ' active' : '';
    return `<a class="team-tab ${d.toLowerCase()}${active}" href="#/${n}/team/${d}">${d}</a>`;
  }).join('');

  const cards = team.map(p => {
    const elim = DataStore.eliminationInfo(p.name);
    return `
    <div class="player-card ${dc}${elim.eliminated ? ' eliminated' : ''}">
      <div class="card-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></div>
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-meta">Age ${esc(p.age)}</div>
      <div class="card-occupation">${esc(p.occupation)}</div>
      <div class="card-seasons">${esc(p.seasons)}</div>
      <div class="badge-row">${tribeBadge(p.tribe, 'tribe-badge')}</div>
      ${elim.eliminated ? `<div class="elim-tag">Out, episode ${esc(elim.episode)}</div>` : ''}
      <div class="pick-num">Pick ${esc(p.pick)}</div>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="team-switch">${switcher}</div>
    <div class="team-banner ${dc}">
      <div>
        <div class="team-banner-name">${esc(drafter)}</div>
        <div class="team-banner-meta">${rem.alive} of ${rem.total} players remaining</div>
      </div>
      <div class="team-banner-score">
        <div class="team-banner-pts">${score}</div>
        <div class="team-banner-pts-label">points</div>
      </div>
    </div>
    <div class="card-grid">${cards}</div>`;
}

/* ---- Commissioner admin (PIN-gated, Eric only) ----
   Edits the localStorage working copy of results (sdp.results.<n>). Everything
   reads the effective episodes, so saving here updates standings/chart/log
   immediately. Export emits the full results.json to copy/download and commit;
   clear reverts to the committed file. Reuses the shared PinGate. */

// Which episode is open in the form: a number, or null for "new episode".
let adminEditingEp = null;

function renderAdmin() {
  const n = DataStore.season.meta.n;

  // Only drafted seasons can have episodes entered.
  if (!DataStore.isDrafted()) {
    view.innerHTML = `
      <div class="section-label">Commissioner</div>
      <div class="preseason-banner">Draft this season first. Episodes can only be entered once the season is drafted.</div>`;
    return;
  }

  // PIN gate: locked -> prompt; unlocked -> the form.
  if (!PinGate.isUnlocked()) {
    view.innerHTML = `
      <div class="section-label">Commissioner</div>
      <p class="summary">This area is for the commissioner. Enter the PIN to add or edit episode results.</p>
      <div class="pin-prompt">
        <label class="pin-label" for="admin-pin">Commissioner PIN</label>
        <div class="pin-row">
          <input id="admin-pin" class="pin-input" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">
          <button class="btn-export" data-act="admin-unlock">Unlock</button>
        </div>
        <div class="pin-error" id="admin-pin-error" style="display:none">Incorrect PIN.</div>
      </div>`;
    const input = view.querySelector('#admin-pin');
    const submit = () => {
      PinGate.verify(input.value).then(ok => {
        if (ok) renderAdmin();
        else { const e = view.querySelector('#admin-pin-error'); if (e) e.style.display = 'block'; }
      });
    };
    view.querySelector('[data-act="admin-unlock"]').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    input.focus();
    return;
  }

  renderAdminForm();
}

// Build (or rebuild) the unlocked commissioner panel.
function renderAdminForm() {
  const n = DataStore.season.meta.n;
  const episodes = DataStore.effectiveEpisodes().slice().sort((a, b) => a.episode - b.episode);

  // The episode being edited, or a blank one with the next number suggested.
  const nextNum = episodes.length ? Math.max(...episodes.map(e => e.episode)) + 1 : 1;
  const editing = (adminEditingEp !== null)
    ? episodes.find(e => e.episode === adminEditingEp) || null
    : null;
  const formEp = editing || { episode: nextNum, title: '', airDate: '', eliminated: [], scores: {} };

  // Existing-episodes list with edit/delete.
  const epList = episodes.length ? episodes.map(ep => `
    <div class="admin-ep-row ${editing && editing.episode === ep.episode ? 'editing' : ''}">
      <div class="admin-ep-num">${esc(ep.episode)}</div>
      <div class="admin-ep-info">
        <div class="admin-ep-title">${esc(ep.title || ('Episode ' + ep.episode))}</div>
        <div class="admin-ep-sub">${DataStore.episodePoints(ep)} pts &middot; ${(ep.eliminated && ep.eliminated.length) ? esc(ep.eliminated.join(', ')) : 'no elimination'}</div>
      </div>
      <button class="btn-undo" data-admin-edit="${esc(ep.episode)}">Edit</button>
      <button class="btn-reset" data-admin-del="${esc(ep.episode)}">Delete</button>
    </div>`).join('') : `<p class="meta-line">No episodes yet. Add the first one below.</p>`;

  // Active drafted players (not yet eliminated in a PRIOR episode). When editing
  // an episode we still show players eliminated *in that same episode* so the box
  // stays editable; players knocked out earlier drop off.
  const priorElims = new Set();
  for (const ep of episodes) {
    if (formEp.episode !== undefined && ep.episode >= formEp.episode) continue;
    if (Array.isArray(ep.eliminated)) ep.eliminated.forEach(nm => priorElims.add(nm));
  }
  const activePlayers = DRAFTERS.flatMap(d => DataStore.playersByDrafter(d))
    .filter(p => !priorElims.has(p.name));

  const playerRows = DRAFTERS.map(d => {
    const team = DataStore.playersByDrafter(d).filter(p => !priorElims.has(p.name));
    if (!team.length) return '';
    const rows = team.map(p => {
      const score = (formEp.scores && typeof formEp.scores[p.name] === 'number') ? formEp.scores[p.name] : 0;
      const out = Array.isArray(formEp.eliminated) && formEp.eliminated.includes(p.name);
      return `
        <div class="admin-player-row">
          <span class="admin-player-name">${esc(p.name)}</span>
          <input class="admin-score" type="number" inputmode="numeric" data-score="${esc(p.name)}" value="${score}">
          <label class="admin-elim"><input type="checkbox" data-elim="${esc(p.name)}" ${out ? 'checked' : ''}> out</label>
        </div>`;
    }).join('');
    return `
      <div class="admin-team-block">
        <div class="admin-team-head ${d.toLowerCase()}">${esc(d)}</div>
        ${rows}
      </div>`;
  }).join('');

  // Shared spoiler cutoff control. Clamped 0..highest entered. Default = max.
  const highest = episodes.length ? Math.max(...episodes.map(e => e.episode)) : 0;
  const cutoff = Math.min(DataStore.currentEpisode(), highest);

  view.innerHTML = `
    <div class="section-label">Commissioner</div>
    <p class="summary">Working copy in this browser. Standings, stats, chart, and log read it live. Export when ready to commit results.json.</p>

    <div class="reveal-control">
      <label class="admin-field" for="ep-cutoff"><span>Pool is caught up through episode</span>
        <input id="ep-cutoff" type="number" inputmode="numeric" min="0" max="${esc(highest)}" value="${esc(cutoff)}"></label>
      <p class="export-note">Nothing past this episode shows on Standings, Stats, the chart, or the log. Raise it after everyone has watched.</p>
    </div>

    <div class="admin-ep-list">${epList}</div>

    <div class="section-label" style="margin-top:24px">${editing ? 'Edit episode ' + esc(editing.episode) : 'New episode'}</div>
    <form id="admin-form" class="admin-form">
      <div class="admin-field-row">
        <label class="admin-field"><span>Episode #</span>
          <input id="ep-num" type="number" inputmode="numeric" value="${esc(formEp.episode)}" ${editing ? 'readonly' : ''}></label>
        <label class="admin-field"><span>Air date</span>
          <input id="ep-date" type="date" value="${esc(formEp.airDate || '')}"></label>
      </div>
      <label class="admin-field"><span>Title</span>
        <input id="ep-title" type="text" value="${esc(formEp.title || '')}" placeholder="Episode title"></label>

      <div class="avail-label" style="margin-top:16px">Points and eliminations</div>
      ${playerRows}

      <div class="draft-controls" style="margin-top:16px">
        ${editing ? `<button type="button" class="btn-undo" data-act="admin-cancel">Cancel edit</button>` : ''}
        <button type="submit" class="btn-export">${editing ? 'Update episode' : 'Save episode'}</button>
      </div>
    </form>

    <div class="export-panel">
      <div class="avail-label">Export</div>
      <p class="export-note">Export the effective results.json, then save it to <code>data/seasons/${esc(n)}/results.json</code> and commit. That published file is what everyone sees.</p>
      <div class="draft-controls">
        <button class="btn-export" data-act="results-copy">Copy results.json</button>
        <button class="btn-export" data-act="results-download">Download results.json</button>
        <button class="btn-reset" data-act="results-clear">Clear local results</button>
      </div>
    </div>`;

  wireAdmin(editing, activePlayers);
}

function collectEpisodeFromForm(activePlayers) {
  const episode = Number(view.querySelector('#ep-num').value);
  const title = view.querySelector('#ep-title').value.trim();
  const airDate = view.querySelector('#ep-date').value;
  const scores = {};
  const eliminated = [];
  activePlayers.forEach(p => {
    const sEl = view.querySelector(`[data-score="${cssAttr(p.name)}"]`);
    const eEl = view.querySelector(`[data-elim="${cssAttr(p.name)}"]`);
    const val = sEl ? Number(sEl.value) : 0;
    scores[p.name] = Number.isFinite(val) ? val : 0;
    if (eEl && eEl.checked) eliminated.push(p.name);
  });
  return { episode, title, airDate, eliminated, scores };
}

// Escape a value for use inside a [data-x="..."] attribute selector.
function cssAttr(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

function wireAdmin(editing, activePlayers) {
  const form = view.querySelector('#admin-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const ep = collectEpisodeFromForm(activePlayers);
      if (!Number.isFinite(ep.episode) || ep.episode < 1) { window.alert('Enter a valid episode number.'); return; }
      const prior = DataStore.effectiveEpisodes();
      const priorMax = prior.length ? Math.max(...prior.map(e => e.episode)) : 0;
      const priorCutoff = DataStore.currentEpisode();
      const episodes = prior.filter(x => x.episode !== ep.episode);
      episodes.push(ep);
      const newMax = Math.max(...episodes.map(e => e.episode));
      // If the cutoff was already keeping pace with the latest episode, advance
      // it to include the newly entered one (default = highest entered). If the
      // commissioner had deliberately held the cutoff back, leave it where it is.
      const cutoff = (priorCutoff >= priorMax) ? newMax : priorCutoff;
      DataStore.saveLocalResults(episodes, cutoff);
      adminEditingEp = null;
      renderAdminForm();
    });
  }

  // Spoiler cutoff: clamp 0..highest, persist to the working copy, re-render so
  // every gated view (and the reveal indicator) updates immediately.
  const cutoffInput = view.querySelector('#ep-cutoff');
  if (cutoffInput) {
    const applyCutoff = () => {
      const episodes = DataStore.effectiveEpisodes();
      const highest = episodes.length ? Math.max(...episodes.map(e => e.episode)) : 0;
      let val = Number(cutoffInput.value);
      if (!Number.isFinite(val)) val = highest;
      val = Math.max(0, Math.min(highest, Math.round(val)));
      DataStore.saveLocalResults(episodes, val);
      renderAdminForm();
    };
    cutoffInput.addEventListener('change', applyCutoff);
  }

  view.querySelectorAll('[data-admin-edit]').forEach(b => {
    b.addEventListener('click', () => { adminEditingEp = Number(b.dataset.adminEdit); renderAdminForm(); });
  });
  view.querySelectorAll('[data-admin-del]').forEach(b => {
    b.addEventListener('click', () => {
      const num = Number(b.dataset.adminDel);
      if (!window.confirm('Delete episode ' + num + '?')) return;
      const episodes = DataStore.effectiveEpisodes().filter(x => x.episode !== num);
      DataStore.saveLocalResults(episodes);
      if (adminEditingEp === num) adminEditingEp = null;
      renderAdminForm();
    });
  });

  view.querySelectorAll('[data-act]').forEach(b => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'admin-cancel') { adminEditingEp = null; renderAdminForm(); }
      else if (act === 'results-copy') copyResults(b);
      else if (act === 'results-download') downloadResults();
      else if (act === 'results-clear') clearResults();
    });
  });
}

// Full results.json content from the effective episodes (schema preserved).
function resultsJSON() {
  const episodes = DataStore.effectiveEpisodes().slice().sort((a, b) => a.episode - b.episode);
  return JSON.stringify(
    { season: DataStore.season.meta.n, currentEpisode: DataStore.currentEpisode(), episodes },
    null, 2) + '\n';
}

function copyResults(btn) {
  const text = resultsJSON();
  const done = ok => {
    const label = btn.textContent;
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { btn.textContent = label; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta); done(ok);
  }
}

function downloadResults() {
  const blob = new Blob([resultsJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'results.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearResults() {
  if (!window.confirm('Clear the local working copy and revert to the committed results.json?')) return;
  DataStore.clearLocalResults();
  adminEditingEp = null;
  renderAdminForm();
}

/* ---- Routing ---- */
/* The URL shape is #/<season>/<view>. The season segment is the source of
   truth for which season is shown; localStorage is only a fallback default. */

let manifest = null;

function isValidSeason(n) {
  return !!(manifest && manifest.seasons.some(s => String(s.n) === String(n)));
}

// Default view depends on whether the loaded season is drafted yet.
function defaultViewForState() {
  return DataStore.isDrafted() ? 'standings' : 'draft';
}

// Pull a sane season number when the URL has none: localStorage, else current.
function fallbackSeason() {
  const saved = localStorage.getItem(SEASON_KEY);
  if (saved && isValidSeason(saved)) return String(saved);
  return String(manifest.currentSeason);
}

// Parse #/<season>/<view>[/<arg>]. Returns null for the season when invalid,
// so the caller can redirect.
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const season = parts[0] && isValidSeason(parts[0]) ? String(parts[0]) : null;
  const view = parts[1] && VIEWS.includes(parts[1]) ? parts[1] : null;
  return { season, view, arg: parts[2] || null };
}

function setActiveTab(view) {
  tabs.querySelectorAll('a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === view);
  });
}

// Season-aware top tabs (built per render so hrefs carry the season).
function buildTabs(n) {
  tabs.innerHTML = [
    ['draft', 'Draft'],
    ['standings', 'Standings'],
    ['stats', 'Stats'],
    ['cast', 'Full Cast']
  ].map(([v, label]) => `<a href="#/${n}/${v}" data-tab="${v}">${label}</a>`).join('');
}

function applySeasonChrome(season) {
  const status = season.meta.status === 'active' ? 'In progress' : 'Archived';
  subtitle.textContent = season.meta.title + ' · Eric, Kris, Kelly';
  footer.textContent = season.meta.title + ' · ' + status;
  picker.value = String(season.meta.n);
}

// Single coordinator: validate URL, redirect if needed, load season, render.
async function route() {
  if (!manifest) return;
  const r = parseHash();

  // No valid season in the URL: redirect to a default landing route.
  if (!r.season) {
    const n = fallbackSeason();
    await ensureSeasonLoaded(n);
    const v = defaultViewForState();
    location.replace('#/' + n + '/' + v);
    return;
  }

  await ensureSeasonLoaded(r.season);
  localStorage.setItem(SEASON_KEY, r.season);

  // Valid season but no/unknown view: redirect to the state-aware default.
  if (!r.view) {
    location.replace('#/' + r.season + '/' + defaultViewForState());
    return;
  }

  applySeasonChrome(DataStore.season);
  buildTabs(r.season);
  setActiveTab(r.view);

  if (r.view === 'draft') renderDraft();
  else if (r.view === 'stats') renderStats();
  else if (r.view === 'cast') renderCast();
  else if (r.view === 'team') renderTeam(r.arg || 'Eric');
  else if (r.view === 'admin') { adminEditingEp = null; renderAdmin(); }
  else renderStandings();
  window.scrollTo(0, 0);
}

// Load a season only when it is not already the loaded one.
async function ensureSeasonLoaded(n) {
  if (DataStore.season && String(DataStore.season.meta.n) === String(n)) return;
  await DataStore.loadSeason(n);
}

/* ---- Season picker ---- */

function buildPicker() {
  picker.innerHTML = manifest.seasons
    .map(s => `<option value="${s.n}">${esc(s.title)}</option>`)
    .join('');
  // Changing the dropdown rewrites the URL's season segment, preserving the
  // current view when it is valid (team falls back to its default arg).
  picker.addEventListener('change', () => {
    const cur = parseHash();
    const view = cur.view || defaultViewForState();
    if (view === 'team') location.hash = '#/' + picker.value + '/team/Eric';
    else location.hash = '#/' + picker.value + '/' + view;
  });
}

/* ---- Boot ---- */

async function boot() {
  try {
    manifest = await DataStore.loadManifest();
    buildPicker();
    await route();
  } catch (err) {
    view.innerHTML = `<p class="summary">Could not load season data. ${esc(err.message)}</p>`;
  }
}

window.addEventListener('hashchange', route);
boot();
