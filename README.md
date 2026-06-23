# Survivor Draft

A mobile-friendly web app for tracking a family Survivor fantasy draft across seasons.
Three drafters (Eric, Kris, Kelly) each draft 8 castaways before the premiere. The app
shows live standings, each drafter's team, the full cast, a week-by-week episode log, and
draft-day stats.

## How it works

- **Static site, no backend.** Vanilla HTML, CSS, and JS, deployed on GitHub Pages.
- **The season is data, not code.** Each season lives in `data/seasons/<n>/`:
  - `players.json` is the static cast plus the draft (tribe, age, drafter, pick, rankings).
  - `results.json` is updated weekly (eliminations and points per castaway).
  - `data/manifest.json` lists every season and which one is current.
  - Adding a new season is a new folder plus one line in the manifest. Past seasons archive
    in place by flipping their status.
- **Standings are just the sum** of the points entered each week in `results.json`, so scoring
  stays fully under the commissioner's control.

## Structure

```
index.html              app shell (routing + rendering)
admin.html              commissioner's weekly-update form (hidden route)
css/styles.css          dark theme, tribe colors, Cinzel + Lato
js/
  data.js               reads the manifest, loads the selected season
  app.js                hash routing, page rendering
  charts.js             stats and visuals
data/
  manifest.json         seasons list + current season
  seasons/50/
    players.json        Season 50 cast + draft
    results.json        Season 50 weekly results
assets/photos/50/       24 castaway headshots
```

## Status

**Phase 0 complete** — Season 50 cast data and headshots ported into the data layer.
UI build in progress.

## Credits

Season 50 cast information and headshots are from CBS, used here for a private fan project.
