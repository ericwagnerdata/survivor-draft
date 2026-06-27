/* data.js - reads the manifest and loads a selected season.
   Pure data access. No DOM here. P2/P3 layers can extend SeasonData
   (e.g. running standings from results) without touching the renderers. */

const DataStore = {
  manifest: null,
  season: null, // { meta, players, results }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    const res = await fetch('data/manifest.json');
    if (!res.ok) throw new Error('Could not load manifest.json');
    this.manifest = await res.json();
    return this.manifest;
  },

  // Load players + results for one season number.
  async loadSeason(n) {
    const manifest = await this.loadManifest();
    const meta = manifest.seasons.find(s => String(s.n) === String(n));
    if (!meta) throw new Error('Season ' + n + ' not in manifest');

    const base = 'data/seasons/' + meta.n + '/';
    const [players, results] = await Promise.all([
      fetch(base + 'players.json').then(r => {
        if (!r.ok) throw new Error('Could not load players.json for season ' + meta.n);
        return r.json();
      }),
      fetch(base + 'results.json').then(r => {
        if (!r.ok) throw new Error('Could not load results.json for season ' + meta.n);
        return r.json();
      })
    ]);

    this.season = { meta, players, results };
    return this.season;
  },

  // True once every player has a non-empty drafter AND a pick.
  isDrafted() {
    if (!this.season || !Array.isArray(this.season.players) || this.season.players.length === 0) return false;
    return this.season.players.every(p => p.drafter && (p.pick || p.pick === 0));
  },

  // localStorage key for a season's working-copy results.
  resultsKey(n) {
    return 'sdp.results.' + (n === undefined ? this.season.meta.n : n);
  },

  // The effective episodes for the loaded season: the localStorage working copy
  // (sdp.results.<n>) if present and valid, otherwise the committed results.json.
  // Everything downstream (standings, chart, log, eliminations) reads this, so a
  // local working copy previews live before it is exported and committed.
  effectiveEpisodes() {
    if (!this.season) return [];
    let raw = null;
    try { raw = localStorage.getItem(this.resultsKey()); } catch (e) { raw = null; }
    if (raw) {
      let saved = null;
      try { saved = JSON.parse(raw); } catch (e) { saved = null; }
      if (saved && Array.isArray(saved.episodes)) return saved.episodes;
    }
    return (this.season.results && Array.isArray(this.season.results.episodes))
      ? this.season.results.episodes : [];
  },

  // True when a local working copy of results exists for the loaded season.
  hasLocalResults() {
    if (!this.season) return false;
    try { return localStorage.getItem(this.resultsKey()) !== null; } catch (e) { return false; }
  },

  // Replace the working copy with a fresh episodes array (sorted by episode).
  saveLocalResults(episodes) {
    const sorted = episodes.slice().sort((a, b) => a.episode - b.episode);
    const payload = { season: this.season.meta.n, episodes: sorted };
    try { localStorage.setItem(this.resultsKey(), JSON.stringify(payload)); } catch (e) { /* ignore */ }
  },

  // Drop the working copy, reverting to the committed results.json.
  clearLocalResults() {
    try { localStorage.removeItem(this.resultsKey()); } catch (e) { /* ignore */ }
  },

  // True once the season has at least one effective (working or committed) episode.
  hasAired() {
    return this.effectiveEpisodes().length > 0;
  },

  playersByDrafter(drafter) {
    if (!this.season) return [];
    return this.season.players
      .filter(p => p.drafter === drafter)
      .sort((a, b) => a.pick - b.pick);
  },

  // Total score for a drafter, summed from effective episode scores.
  teamScore(drafter) {
    let total = 0;
    const team = this.playersByDrafter(drafter);
    for (const ep of this.effectiveEpisodes()) {
      const scores = ep.scores || {};
      for (const p of team) {
        if (typeof scores[p.name] === 'number') total += scores[p.name];
      }
    }
    return total;
  },

  // Elimination derived from the effective episodes, so players.json stays static.
  // Scan in episode order; first episode that lists the player marks them out.
  eliminationInfo(playerName) {
    const eps = this.effectiveEpisodes().slice().sort((a, b) => a.episode - b.episode);
    for (const ep of eps) {
      if (Array.isArray(ep.eliminated) && ep.eliminated.includes(playerName)) {
        return { eliminated: true, episode: ep.episode };
      }
    }
    return { eliminated: false, episode: null };
  },

  playersRemaining(drafter) {
    const team = this.playersByDrafter(drafter);
    const alive = team.filter(p => !this.eliminationInfo(p.name).eliminated).length;
    return { alive, total: team.length };
  },

  // Cumulative standings series for the trend chart. Returns
  //   { episodes: [1..N], lines: { <drafter>: [running total per episode] } }
  // where each line value is that drafter's total points through that episode.
  cumulativeStandings(drafters) {
    const eps = this.effectiveEpisodes().slice().sort((a, b) => a.episode - b.episode);
    const labels = eps.map(ep => ep.episode);
    const lines = {};
    drafters.forEach(d => {
      const team = this.playersByDrafter(d);
      let running = 0;
      lines[d] = eps.map(ep => {
        const scores = ep.scores || {};
        for (const p of team) {
          if (typeof scores[p.name] === 'number') running += scores[p.name];
        }
        return running;
      });
    });
    return { episodes: labels, lines };
  },

  // Total points awarded in one episode (across all scored players).
  episodePoints(ep) {
    const scores = (ep && ep.scores) || {};
    return Object.keys(scores).reduce((sum, name) => {
      const v = scores[name];
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);
  },

  // Generic tribe colors, assigned by a tribe's index in season.meta.tribes.
  // The first three entries are S50's existing colors (vatu / cila / kalo), so
  // a 3-tribe S50 renders identically; later seasons with more tribes pull the
  // remaining palette entries. Tribes not listed in meta fall back to gray.
  // Each entry: { base, bg, text } where bg/text drive the soft badge styling.
  TRIBE_PALETTE: [
    { base: '#C0226A', bg: 'rgba(192,34,106,0.2)', text: '#e88ab8' },
    { base: '#E07000', bg: 'rgba(224,112,0,0.2)',  text: '#ffb366' },
    { base: '#007070', bg: 'rgba(0,112,112,0.2)',  text: '#66cccc' },
    { base: '#7B68EE', bg: 'rgba(123,104,238,0.2)', text: '#b3a7f5' },
    { base: '#3FA34D', bg: 'rgba(63,163,77,0.2)',   text: '#86d491' }
  ],
  TRIBE_FALLBACK: { base: '#3D3D3D', bg: 'rgba(61,61,61,0.5)', text: '#F0E6D3' },

  // Color for a tribe name in the currently loaded season (index into the palette).
  tribeColor(tribeName) {
    const tribes = (this.season && this.season.meta && Array.isArray(this.season.meta.tribes))
      ? this.season.meta.tribes : [];
    const i = tribes.indexOf(tribeName);
    if (i < 0) return this.TRIBE_FALLBACK;
    return this.TRIBE_PALETTE[i % this.TRIBE_PALETTE.length];
  }
};

/* PinGate - the one shared "Eric only" lock, used by both the draft's Eric view
   and the commissioner admin route. This is a casual lock, not real security:
   the rankings already live in the public players.json, so the gate only stops
   accidental reveals on a shared screen.

   We store a SHA-256 hash of the PIN (never the plaintext) and compare the
   entered PIN's hash with the Web Crypto API. Default PIN: "survivor". Unlock
   persists per browser session (sessionStorage), session-global not per-season.

   To change the PIN: compute the SHA-256 hex of the new PIN and paste it into
   ERIC_PIN_HASH below. One-liners:
     Browser console: crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOURPIN')).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
     Node / git-bash: printf '%s' 'YOURPIN' | sha256sum                            */
const PinGate = (function () {
  const ERIC_PIN_HASH = '7a01ac37408614bcf58069bb6b6a543f6c473cdded552c491de4eb36aacce235'; // "survivor"
  const UNLOCK_KEY = 'sdp.draft.ericUnlocked'; // sessionStorage flag, per browser session

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
  // Check an entered PIN. Correct -> mark unlocked + resolve true. Wrong -> false.
  async function verify(value) {
    const entered = (value || '').trim();
    let ok = false;
    try { ok = (await sha256Hex(entered)) === ERIC_PIN_HASH; } catch (e) { ok = false; }
    if (ok) setUnlocked();
    return ok;
  }
  return { isUnlocked, setUnlocked, verify };
})();
