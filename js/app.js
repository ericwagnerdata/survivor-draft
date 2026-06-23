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
const VIEWS = ['draft', 'standings', 'cast', 'team'];
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

function photoCard(p) {
  // Undrafted seasons (e.g. the demo) have drafter:null, so guard the class
  // and only show the drafter badge once a player has been drafted.
  const drafterClass = p.drafter ? p.drafter.toLowerCase() : '';
  const elimClass = p.eliminated ? ' eliminated' : '';
  const elimTag = p.eliminated
    ? `<div class="elim-tag">Out, episode ${esc(p.eliminatedEpisode)}</div>`
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
        <span class="tribe-badge ${esc(p.tribe)}">${esc(p.tribe)}</span>
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
          <span class="tribe-badge ${esc(p.tribe)}">${esc(p.tribe)}</span>
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

  const summary = aired
    ? `${DataStore.season.results.episodes.length} episodes logged.`
    : DataStore.isDrafted()
      ? `${DataStore.season.players.length} castaways drafted across 3 teams. The season has not aired.`
      : `Draft is not complete yet. Open the Draft tab to run it.`;

  view.innerHTML = `
    <div class="section-label">Standings</div>
    <p class="summary">${esc(summary)}</p>
    ${banner}
    <div class="standings">${list}</div>`;
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

  const cards = team.map(p => `
    <div class="player-card ${dc}${p.eliminated ? ' eliminated' : ''}">
      <div class="card-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></div>
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-meta">Age ${esc(p.age)}</div>
      <div class="card-occupation">${esc(p.occupation)}</div>
      <div class="card-seasons">${esc(p.seasons)}</div>
      <div class="badge-row"><span class="tribe-badge ${esc(p.tribe)}">${esc(p.tribe)}</span></div>
      ${p.eliminated ? `<div class="elim-tag">Out, episode ${esc(p.eliminatedEpisode)}</div>` : ''}
      <div class="pick-num">Pick ${esc(p.pick)}</div>
    </div>`).join('');

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
  else if (r.view === 'cast') renderCast();
  else if (r.view === 'team') renderTeam(r.arg || 'Eric');
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
