/* app.js - hash routing + rendering for Phase 1 (viewing UI).
   Routes:
     #/            or #/standings   -> standings leaderboard
     #/cast                          -> full cast with tribe + drafter filters
     #/team/Eric | /Kris | /Kelly    -> one drafter's team in pick order
   Season selection persists in localStorage and is reloaded on boot. */

const DRAFTERS = ['Eric', 'Kris', 'Kelly'];
const TRIBES = ['Vatu', 'Cila', 'Kalo'];
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
  const drafterClass = p.drafter.toLowerCase();
  const elimClass = p.eliminated ? ' eliminated' : '';
  const elimTag = p.eliminated
    ? `<div class="elim-tag">Out, episode ${esc(p.eliminatedEpisode)}</div>`
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
        <span class="drafter-badge ${drafterClass}">${esc(p.drafter)}</span>
      </div>
      ${elimTag}
    </div>`;
}

/* ---- Views ---- */

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

  const list = rows.map((r, i) => `
    <div class="standing-row ${r.drafter.toLowerCase()}">
      <div class="standing-rank">${i + 1}</div>
      <div class="standing-info">
        <div class="standing-name">${esc(r.drafter)}</div>
        <div class="standing-sub">${r.alive} of ${r.total} players remaining</div>
      </div>
      <div class="standing-score">
        <div class="standing-pts">${r.score}</div>
        <div class="standing-pts-label">points</div>
      </div>
    </div>`).join('');

  const summary = aired
    ? `${DataStore.season.results.episodes.length} episodes logged.`
    : `${DataStore.season.players.length} castaways drafted across 3 teams. The season has not aired.`;

  view.innerHTML = `
    <div class="section-label">Standings</div>
    <p class="summary">${esc(summary)}</p>
    ${banner}
    <div class="standings">${list}</div>`;
}

function renderCast() {
  let players = DataStore.season.players.slice();
  if (castFilter.tribe !== 'All') players = players.filter(p => p.tribe === castFilter.tribe);
  if (castFilter.drafter !== 'All') players = players.filter(p => p.drafter === castFilter.drafter);

  const btn = (label, group, value) => {
    const active = castFilter[group] === value ? ' active' : '';
    return `<button class="filter-btn${active}" data-group="${group}" data-value="${esc(value)}">${esc(label)}</button>`;
  };

  const tribeBtns = ['All', ...TRIBES].map(t => btn(t, 'tribe', t)).join('');
  const drafterBtns = ['All', ...DRAFTERS].map(d => btn(d, 'drafter', d)).join('');

  view.innerHTML = `
    <div class="section-label">Full Cast</div>
    <div class="filter-group">
      <div class="filter-caption">Tribe</div>
      <div class="filter-row">${tribeBtns}</div>
    </div>
    <div class="filter-group">
      <div class="filter-caption">Drafter</div>
      <div class="filter-row">${drafterBtns}</div>
    </div>
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

  const switcher = DRAFTERS.map(d => {
    const active = d === drafter ? ' active' : '';
    return `<a class="team-tab ${d.toLowerCase()}${active}" href="#/team/${d}">${d}</a>`;
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

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'standings' };
  if (parts[0] === 'standings') return { name: 'standings' };
  if (parts[0] === 'cast') return { name: 'cast' };
  if (parts[0] === 'team') return { name: 'team', drafter: parts[1] || 'Eric' };
  return { name: 'standings' };
}

function setActiveTab(route) {
  tabs.querySelectorAll('a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === route.name);
  });
}

function render() {
  if (!DataStore.season) return;
  const route = parseHash();
  setActiveTab(route);
  if (route.name === 'cast') renderCast();
  else if (route.name === 'team') renderTeam(route.drafter);
  else renderStandings();
  window.scrollTo(0, 0);
}

/* ---- Season picker ---- */

function pickedSeason(manifest) {
  const saved = localStorage.getItem(SEASON_KEY);
  if (saved && manifest.seasons.some(s => String(s.n) === saved)) return saved;
  return String(manifest.currentSeason);
}

function buildPicker(manifest, selected) {
  picker.innerHTML = manifest.seasons
    .map(s => `<option value="${s.n}">${esc(s.title)}</option>`)
    .join('');
  picker.value = String(selected);
  picker.addEventListener('change', async () => {
    localStorage.setItem(SEASON_KEY, picker.value);
    await loadAndRender(picker.value);
  });
}

async function loadAndRender(n) {
  const season = await DataStore.loadSeason(n);
  const status = season.meta.status === 'active' ? 'In progress' : 'Archived';
  subtitle.textContent = season.meta.title + ' · Eric, Kris, Kelly';
  footer.textContent = season.meta.title + ' · ' + status;
  render();
}

/* ---- Boot ---- */

async function boot() {
  try {
    const manifest = await DataStore.loadManifest();
    const selected = pickedSeason(manifest);
    buildPicker(manifest, selected);
    await loadAndRender(selected);
  } catch (err) {
    view.innerHTML = `<p class="summary">Could not load season data. ${esc(err.message)}</p>`;
  }
}

window.addEventListener('hashchange', render);
boot();
