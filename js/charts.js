/* charts.js - Chart.js visuals (loaded via CDN in index.html).
   Phase 3 ships the standings-over-time line chart. Later phases can add more
   here without touching the renderers. */

const Charts = (function () {
  // Drafter line colors, matched to the CSS drafter palette.
  const DRAFTER_COLORS = {
    Eric: '#D4A017',
    Kris: '#7B68EE',
    Kelly: '#C0226A'
  };
  const FALLBACK_COLOR = '#888';

  let trendChart = null; // single live instance, destroyed before re-draw

  // Standings-over-time line chart.
  //   canvasEl  a <canvas> in the DOM
  //   series    { episodes: [1..N], lines: { <drafter>: [cumulative totals] } }
  // X axis = episode number, one line per drafter in drafter colors, Y = points.
  function standingsTrend(canvasEl, series) {
    if (!canvasEl || typeof Chart === 'undefined') return;
    if (trendChart) { trendChart.destroy(); trendChart = null; }

    const datasets = Object.keys(series.lines).map(drafter => {
      const color = DRAFTER_COLORS[drafter] || FALLBACK_COLOR;
      return {
        label: drafter,
        data: series.lines[drafter],
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: color,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.25
      };
    });

    const grid = 'rgba(240,230,211,0.08)';
    const tick = '#888';

    trendChart = new Chart(canvasEl.getContext('2d'), {
      type: 'line',
      data: {
        labels: series.episodes.map(n => 'Ep ' + n),
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#F0E6D3', font: { family: 'Cinzel, serif', size: 11 }, boxWidth: 14 }
          },
          tooltip: {
            backgroundColor: '#1A1A1A',
            titleColor: '#D4A017',
            bodyColor: '#F0E6D3',
            borderColor: '#3D3D3D',
            borderWidth: 1
          }
        },
        scales: {
          x: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { color: tick, font: { size: 10 }, precision: 0 } }
        }
      }
    });
    return trendChart;
  }

  return { standingsTrend };
})();
