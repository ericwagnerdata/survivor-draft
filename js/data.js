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

  // True once the season has at least one logged episode.
  hasAired() {
    return !!(this.season && this.season.results
      && Array.isArray(this.season.results.episodes)
      && this.season.results.episodes.length > 0);
  },

  playersByDrafter(drafter) {
    if (!this.season) return [];
    return this.season.players
      .filter(p => p.drafter === drafter)
      .sort((a, b) => a.pick - b.pick);
  },

  // Total score for a drafter. Pre-season there are no episodes, so 0.
  // P3 will sum per-player points out of results.json here.
  teamScore(drafter) {
    if (!this.hasAired()) return 0;
    let total = 0;
    for (const ep of this.season.results.episodes) {
      const scores = ep.scores || {};
      for (const p of this.playersByDrafter(drafter)) {
        if (typeof scores[p.name] === 'number') total += scores[p.name];
      }
    }
    return total;
  },

  playersRemaining(drafter) {
    const team = this.playersByDrafter(drafter);
    const alive = team.filter(p => !p.eliminated).length;
    return { alive, total: team.length };
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
