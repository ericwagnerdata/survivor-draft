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
  }
};
