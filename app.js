import { KOPPEN_CLASSES } from './koppen-data.js';
// polylabel ships as CJS via unpkg — loading it as a <script> tag fails
// because the inlined `require('tinyqueue')` doesn't resolve. esm.sh
// bundles deps, so importing it as an ES module just works.
import polylabel from 'https://esm.sh/polylabel@1.1.0';

// --- DOM refs --------------------------------------------------------------

const $overlay = document.getElementById('map-overlay');
const $overlaySelect = document.getElementById('overlay-select');
const $overlayReference = document.getElementById('overlay-reference');
const $overlayRandom = document.getElementById('overlay-random');
const $overlayShuffle = document.getElementById('overlay-shuffle');
const $overlayClose = document.getElementById('overlay-close');
const $widget = document.getElementById('climate-widget');
const $widgetHeader = document.getElementById('widget-header');
const $widgetBody = document.getElementById('widget-body');
const $widgetCountry = document.getElementById('widget-country');
const $grid = document.getElementById('climate-grid');
const $sheet = document.getElementById('bottom-sheet');
const $sheetContent = document.getElementById('sheet-content');
const $sheetClose = $sheet.querySelector('.sheet-close');
const $methodologyLink = document.getElementById('methodology-link');
const $methodologyPopover = document.getElementById('methodology-popover');

const METHODOLOGY_HTML = `
  <h3>Methodology</h3>
  <p><b>Climate data.</b> Köppen-Geiger 1991–2020 classifications (10 km resolution) from Beck et al. 2023. Each pixel is assigned one of 30 Köppen classes (e.g., Cfa = humid subtropical, BWh = hot desert).</p>
  <p><b>Country borders.</b> Natural Earth 10 m admin boundaries.</p>
  <p><b>Polygonization.</b> The raster was vectorized class-by-class and intersected with country borders, yielding 936 (country, Köppen class) features. Polygons smaller than 200 km² were dropped; the rest were simplified at 0.02° tolerance to keep the file under 10 MB.</p>
  <p><b>Country matching.</b> For each Köppen class, every country in the world is ranked by total area of that class. The top-ranked country (excluding the country you're viewing) is the "match" — so a region labeled "Climate of China" means China is the country with the most land area in that climate worldwide.</p>
  <p><b>City dots.</b> Each zone is dotted with up to four real cities <i>of its matched country</i> that share the climate — larger zones get more (the China-matched US Southeast fills with Shanghai, Wuhan, Hangzhou…). Each city is placed to echo where it sits in its own country: a city in eastern China lands toward the east of the zone. Only recognizable cities are used (GeoNames places with population ≥ 1M or national capitals); if the matched country has none in that climate, the zone gets no dots.</p>
  <p><b>Greedy de-duplication.</b> When several regions in the same country would all map to the same match, the largest zone keeps the top match and smaller zones step down to their next-best non-duplicate. This is why shuffling one region's match can cascade into others.</p>
  <p><b>Shuffle.</b> The ↺ buttons step through the ranking — region-level shuffles the next-best match for that zone; "Shuffle all" advances every region one step.</p>
  <p><b>What this doesn't model.</b></p>
  <ul>
    <li>Magnitude or intensity within a class (a tiny BWh sliver in Iceland still matches whichever country has the most BWh land).</li>
    <li>Geographic plausibility — purely area-driven.</li>
    <li>Climate trends or future scenarios (this is the 1991–2020 baseline only).</li>
  </ul>
`;
$methodologyPopover.innerHTML = METHODOLOGY_HTML;

// --- Welcome modal ---------------------------------------------------------
// Short, plain-language labels for each Köppen class, used as the colored
// chips in the welcome modal's color legend.
const WELCOME_LABELS = {
  1: 'Tropical rainforest', 2: 'Tropical monsoon', 3: 'Tropical savanna',
  4: 'Hot desert', 5: 'Cold desert', 6: 'Hot steppe', 7: 'Cold steppe',
  8: 'Hot Mediterranean', 9: 'Warm Mediterranean', 10: 'Cool Mediterranean',
  11: 'Dry-winter subtropical', 12: 'Subtropical highland', 13: 'Cold highland',
  14: 'Humid subtropical', 15: 'Oceanic', 16: 'Subpolar oceanic',
  17: 'Hot dry-summer continental', 18: 'Warm dry-summer continental',
  19: 'Cold dry-summer continental', 20: 'Frigid dry-summer continental',
  21: 'Hot dry-winter continental', 22: 'Warm dry-winter continental',
  23: 'Subarctic, dry winter', 24: 'Frigid subarctic',
  25: 'Hot humid continental', 26: 'Warm humid continental',
  27: 'Subarctic (boreal)', 28: 'Frigid boreal',
  29: 'Polar tundra', 30: 'Polar ice cap',
};

const $welcomeModal = document.getElementById('welcome-modal');
const $welcomeStart = document.getElementById('welcome-start');
const $welcomeLegend = document.getElementById('welcome-legend');

const WELCOME_KEY = 'ce_welcome_v1';
const WELCOME_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function readWelcomeState() {
  try { return JSON.parse(localStorage.getItem(WELCOME_KEY)) || {}; }
  catch { return {}; }
}
function writeWelcomeState(state) {
  try { localStorage.setItem(WELCOME_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

// WCAG relative luminance of an "rgb(r, g, b)" string.
function relLuminance(rgbStr) {
  const [r, g, b] = (rgbStr.match(/\d+/g) || [0, 0, 0]).map(Number).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Pick black or white text — whichever has the higher contrast ratio on bg.
function maxContrastText(rgbStr) {
  const L = relLuminance(rgbStr);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastBlack >= contrastWhite ? '#000' : '#fff';
}

function buildWelcomeLegend() {
  if (!$welcomeLegend || $welcomeLegend.childElementCount) return;
  const frag = document.createDocumentFragment();
  for (const id of Object.keys(KOPPEN_CLASSES)) {
    const klass = KOPPEN_CLASSES[id];
    const chip = document.createElement('span');
    chip.className = 'welcome-chip';
    chip.style.background = klass.color;
    chip.style.color = maxContrastText(klass.color);
    chip.textContent = WELCOME_LABELS[id] || klass.name;
    chip.title = `${klass.symbol} — ${klass.name}`;
    frag.appendChild(chip);
  }
  $welcomeLegend.appendChild(frag);
}

function showWelcome() {
  buildWelcomeLegend();
  $welcomeModal.hidden = false;
}
function hideWelcome() {
  $welcomeModal.hidden = true;
}

// Show on initial load unless suppressed. "Suppressed" = the modal has been
// seen twice OR "Start" was clicked once; either sets a one-week timestamp.
function maybeShowWelcome() {
  if (!$welcomeModal) return;
  const now = Date.now();
  const state = readWelcomeState();
  if (state.suppressedUntil && now < state.suppressedUntil) return;
  showWelcome();
  state.seen = (state.seen || 0) + 1;
  if (state.seen >= 2) state.suppressedUntil = now + WELCOME_WEEK_MS;
  writeWelcomeState(state);
}

if ($welcomeStart) {
  $welcomeStart.addEventListener('click', () => {
    hideWelcome();
    const state = readWelcomeState();
    state.suppressedUntil = Date.now() + WELCOME_WEEK_MS;
    writeWelcomeState(state);
  });
}
// Backdrop click and Escape dismiss without changing the suppression rule
// (the view already counted toward the "seen twice" threshold).
if ($welcomeModal) {
  $welcomeModal.addEventListener('click', (e) => {
    if (e.target === $welcomeModal) hideWelcome();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$welcomeModal.hidden) hideWelcome();
  });
}

maybeShowWelcome();

// Coarse pointer = touch device. Used to gate hover-vs-tap behavior.
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const mqMobile = window.matchMedia('(max-width: 719px)');

// --- Analytics -------------------------------------------------------------
// Umami custom events (script loaded `defer` in index.html). No-op until the
// global is present, so early interactions just don't record rather than throw.
function track(event, data) {
  try {
    window.umami?.track(event, data);
  } catch { /* never let analytics break the UI */ }
}

// --- Map setup -------------------------------------------------------------

const map = new maplibregl.Map({
  container: 'map',
  // OpenFreeMap Positron — free, no API key, OpenMapTiles vector schema. Unlike
  // demotiles it ships real city/town labels (our "source cities") and a
  // multi-font glyph endpoint, so the single-font-stack gotcha no longer applies.
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [10, 25],
  zoom: 1.4,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
window.__map = map;

function buildFillColorExpression() {
  const expr = ['match', ['get', 'koppen_class']];
  for (const [id, cls] of Object.entries(KOPPEN_CLASSES)) {
    expr.push(Number(id), cls.color);
  }
  expr.push('#cccccc');
  return expr;
}

// --- Data load + index -----------------------------------------------------

const dataReady = (async () => {
  const [zonesRes, exemplarsRes, citiesRes] = await Promise.all([
    fetch('./data/country-zones.geojson'),
    fetch('./data/class-exemplars.json'),
    fetch('./data/cities-by-country.json').catch(() => null),
  ]);
  const zones = await zonesRes.json();
  const exemplarsRaw = await exemplarsRes.json();
  // { iso3: { classId: [ {label, lng, lat, pop} ] } } — recognizable cities of
  // each country, grouped by Köppen class. Used to scatter city dots across a
  // matched zone. Tolerates a missing file (dots just won't render).
  const cities = citiesRes && citiesRes.ok ? await citiesRes.json() : {};

  const exemplars = {};
  for (const [k, list] of Object.entries(exemplarsRaw)) exemplars[Number(k)] = list;

  const byIso = new Map();
  for (const f of zones.features) {
    const iso = f.properties.iso3;
    if (!byIso.has(iso)) byIso.set(iso, { name: f.properties.name, features: [] });
    byIso.get(iso).features.push(f);
  }

  // Per-country breakdown: total area and top-3 climates by area.
  const byIsoBreakdown = new Map();
  for (const [iso, { name, features }] of byIso) {
    const byClass = new Map();
    let total = 0;
    for (const f of features) {
      const k = f.properties.koppen_class;
      const a = f.properties.area_km2;
      byClass.set(k, (byClass.get(k) ?? 0) + a);
      total += a;
    }
    const top = [...byClass.entries()]
      .map(([klass, area]) => ({ klass, fraction: area / total }))
      .sort((a, b) => b.fraction - a.fraction)
      .slice(0, 3);
    byIsoBreakdown.set(iso, { name, total, top });
  }

  return { zones, exemplars, byIso, byIsoBreakdown, cities };
})();

// --- Map layers ------------------------------------------------------------

map.on('load', async () => {
  const { zones } = await dataReady;

  map.addSource('zones', { type: 'geojson', data: zones });

  // Snapshot the basemap's symbol (label) layers, then partition them. We insert
  // our colored zones *below* the first label layer (`firstLabel`) so OpenFreeMap's
  // real place labels render on top of the fill and stay legible. We hide only the
  // country/continent/state labels on selection (they collide with our overlay pill
  // and region labels); city/town labels stay on as geographic "source" anchors.
  const symbolLayers = map.getStyle().layers.filter((l) => l.type === 'symbol');
  const firstLabel = symbolLayers[0]?.id;
  basemapSymbolLayers = symbolLayers.map((l) => l.id);
  // OpenFreeMap Positron place labels: label_country_{1,2,3} | label_state |
  // label_city | label_city_capital | label_town | label_village | label_other.
  // We hide only the country labels (big, and they fight the overlay pill + our
  // region labels); state/city/town stay on as source anchors.
  basemapCountryLabelLayers = symbolLayers
    .filter((l) => /^label_country/i.test(l.id))
    .map((l) => l.id);

  map.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: 'zones',
    paint: { 'fill-color': buildFillColorExpression(), 'fill-opacity': 0.78 },
  }, firstLabel);
  map.addLayer({
    id: 'zones-outline',
    type: 'line',
    source: 'zones',
    paint: { 'line-color': '#222', 'line-width': 0.25, 'line-opacity': 0.35 },
  }, firstLabel);

  map.addSource('country-outline', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'country-highlight-outline',
    type: 'line',
    source: 'country-outline',
    paint: { 'line-color': '#000', 'line-width': 1.5 },
  });

  // Country-hover border: dissolved outline of the country under the cursor.
  // We dissolve internal Köppen boundaries so this reads as a single national
  // border rather than tracing every sub-polygon.
  map.addSource('country-hover', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'country-hover-outline',
    type: 'line',
    source: 'country-hover',
    paint: {
      'line-color': '#111',
      'line-width': 2,
      'line-opacity': 0.85,
    },
  });

  // Region-hover highlight: wide soft glow + crisp inner border, both filtered
  // to the selected country + hovered Köppen class.
  map.addLayer({
    id: 'zones-hover-glow',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'iso3'], '__none__'],
    paint: {
      'line-color': '#000',
      'line-width': 6,
      'line-opacity': 0.18,
      'line-blur': 4,
    },
  });
  map.addLayer({
    id: 'zones-hover-outline',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'iso3'], '__none__'],
    paint: {
      'line-color': '#111',
      'line-width': 1.5,
    },
  });

  // City dots are HTML markers (see buildCityDots) so they can use the app's
  // serif font and an accent pin — this keeps the matched-country "comparison"
  // cities visually distinct from the basemap's plain grey "source" city labels.

  populateCountrySelect();

  map.on('moveend', () => {
    if (!selected) return;
    const z = map.getZoom();
    if (lastEmitZoom === null || Math.abs(z - lastEmitZoom) > 0.1) refreshLabels();
    else runCollisionPass();
  });
});

// --- State -----------------------------------------------------------------

// Per-selection state. selected.classes[classId] = { exemplars, index }.
// selected.context[classId] = { exemplar, fraction, runnersUp }.
let selected = null;
let hoveredKlass = null;
let hoveredIso = null;
let detailKlass = null; // when set, widget shows detail view for this class
let hasEverSelected = false;
let hoverTimer = null;
const HOVER_DELAY_MS = 200;

let basemapSymbolLayers = [];
// Subset of basemapSymbolLayers we hide on selection: country/continent/state
// labels that collide with our overlay pill + region labels. City/town labels
// are deliberately left out so they stay visible as geographic source anchors.
let basemapCountryLabelLayers = [];

// --- Frame of reference ----------------------------------------------------
// Regions the user can express matches relative to ("France vs Europe"). Values
// are sets of GU_A3 codes present in the data. Selecting one soft-prioritizes
// its members in every class's exemplar list (see applyReferenceOrdering); a
// class the reference doesn't share transparently falls back to the global best.
const REFERENCE_PRESETS = {
  USA: ['USA'],
  AUS: ['AUS'],
  TWN: ['TWN'],
  // Curated geographic Europe (GU_A3 codes; UK is split ENG/SCT/WLS/NIR, and a
  // few use Natural Earth's non-ISO map-unit codes: FXX, NOW, PRX, SRS, BHF).
  EUR: [
    'ALB', 'AND', 'AUT', 'BEL', 'BLR', 'BHF', 'BGR', 'HRV', 'CYP', 'CZE',
    'DNK', 'ENG', 'EST', 'FIN', 'FXX', 'DEU', 'GRC', 'HUN', 'ISL', 'IRL',
    'ITA', 'KOS', 'LVA', 'LTU', 'LUX', 'MLT', 'MDA', 'MNE', 'NLX', 'MKD',
    'NIR', 'NOW', 'POL', 'PRX', 'ROU', 'SCT', 'SRS', 'SVK', 'SVN', 'ESP',
    'SWE', 'CHE', 'UKR', 'WLS',
  ],
};
const REFERENCE_STORAGE_KEY = 'climate-equivalents:reference';
// The active reference as a Set of iso3 (empty = "anywhere", global behavior).
let referenceIso3Set = new Set();

// Stable reorder: reference members first (keeping their existing area-rank order
// among themselves), then everyone else. The greedy-dedupe in refreshLabels walks
// each list from `index`, so front-loading the reference makes it picked first and
// falls through to global entries automatically — that's the soft-prioritize +
// global-fallback behavior, no special-casing.
function applyReferenceOrdering(list) {
  if (referenceIso3Set.size === 0) return list;
  const inRef = [];
  const rest = [];
  for (const e of list) (referenceIso3Set.has(e.iso3) ? inRef : rest).push(e);
  return inRef.length ? [...inRef, ...rest] : list;
}

// Switch the active frame of reference. Rebuilds each class's exemplar list from
// the canonical global ranking (so repeated switches stay deterministic), then
// re-applies the new ordering and refreshes — no camera move, the selection stays.
async function setReference(key) {
  referenceIso3Set = new Set(REFERENCE_PRESETS[key] ?? []);
  try { localStorage.setItem(REFERENCE_STORAGE_KEY, key || ''); } catch { /* ignore */ }
  track('set-reference', { reference: key || 'anywhere' });
  if (!selected) return;
  const { exemplars } = await dataReady;
  for (const [k, entry] of selected.classes) {
    entry.exemplars = applyReferenceOrdering(
      (exemplars[k] ?? []).filter((e) => e.iso3 !== selected.iso),
    );
    entry.index = 0;
  }
  refreshLabels();
  if (detailKlass != null) showDetail(detailKlass);
}

// Restore a persisted reference at load, before any selection is made.
(() => {
  let key = '';
  try { key = localStorage.getItem(REFERENCE_STORAGE_KEY) || ''; } catch { /* ignore */ }
  if (key && REFERENCE_PRESETS[key]) {
    referenceIso3Set = new Set(REFERENCE_PRESETS[key]);
    if ($overlayReference) $overlayReference.value = key;
  }
})();
let regionMarkers = [];
let markersByClass = new Map();
let cityMarkers = [];

let labelPopup = null;
let regionPopup = null;
let labelTooltipOpen = false;

let lastEmitZoom = null;

// Synchronous handles populated once data resolves.
let byIsoBreakdownSync = null;
let lastDataByIso = null;
let citiesByCountry = null;
dataReady.then(({ byIsoBreakdown, byIso, cities }) => {
  byIsoBreakdownSync = byIsoBreakdown;
  lastDataByIso = byIso;
  citiesByCountry = cities;
});

$overlayShuffle.addEventListener('click', () => {
  track('shuffle-all', selected ? { iso: selected.iso } : undefined);
  shuffleAll();
});
$overlayClose.addEventListener('click', () => {
  track('clear-selection', selected ? { iso: selected.iso } : undefined);
  clearSelection();
});
$overlaySelect.addEventListener('change', (e) => {
  const iso = e.target.value;
  if (iso) selectCountry(iso, 'dropdown');
});
$overlayReference.addEventListener('change', (e) => {
  setReference(e.target.value);
});
$overlayRandom.addEventListener('click', async () => {
  const { byIso } = await dataReady;
  const candidates = [...byIso.keys()].filter((iso) => iso !== selected?.iso);
  if (!candidates.length) return;
  selectCountry(candidates[Math.floor(Math.random() * candidates.length)], 'random');
});

$widgetHeader.addEventListener('click', () => {
  $widget.classList.toggle('collapsed');
  $widgetHeader.setAttribute('aria-expanded', String(!$widget.classList.contains('collapsed')));
});
$widgetHeader.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $widgetHeader.click();
  }
});

$sheetClose.addEventListener('click', closeSheet);
$sheet.addEventListener('click', (e) => {
  // tap outside content closes — only on the sheet element itself
  if (e.target === $sheet) closeSheet();
});

// Methodology: hover-open on desktop, tap-opens-sheet on coarse/mobile.
if (coarsePointer) {
  $methodologyLink.addEventListener('click', () => {
    $sheetContent.innerHTML = METHODOLOGY_HTML;
    $sheet.classList.add('open');
    $sheet.setAttribute('aria-hidden', 'false');
  });
} else {
  let methodologyPinned = false;
  $methodologyLink.addEventListener('mouseenter', () => $methodologyPopover.classList.add('open'));
  $methodologyLink.addEventListener('mouseleave', () => {
    if (!methodologyPinned) $methodologyPopover.classList.remove('open');
  });
  $methodologyPopover.addEventListener('mouseenter', () => $methodologyPopover.classList.add('open'));
  $methodologyPopover.addEventListener('mouseleave', () => {
    if (!methodologyPinned) $methodologyPopover.classList.remove('open');
  });
  $methodologyLink.addEventListener('click', () => {
    methodologyPinned = !methodologyPinned;
    $methodologyPopover.classList.toggle('open', methodologyPinned);
  });
  // Clicking elsewhere on the document un-pins.
  document.addEventListener('click', (e) => {
    if (!methodologyPinned) return;
    if (e.target === $methodologyLink) return;
    if ($methodologyPopover.contains(e.target)) return;
    methodologyPinned = false;
    $methodologyPopover.classList.remove('open');
  });
}

async function populateCountrySelect() {
  const { byIso } = await dataReady;
  const opts = [...byIso.entries()]
    .map(([iso, { name }]) => ({ iso, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const frag = document.createDocumentFragment();
  for (const { iso, name } of opts) {
    const opt = document.createElement('option');
    opt.value = iso;
    opt.textContent = name;
    frag.appendChild(opt);
  }
  $overlaySelect.appendChild(frag);
}

// --- Map interactions ------------------------------------------------------

map.on('click', 'zones-fill', async (e) => {
  const feat = e.features?.[0];
  if (!feat) return;
  const iso = feat.properties.iso3;
  const klass = Number(feat.properties.koppen_class);

  // If clicking inside the currently selected country: open class details
  // (sheet on mobile/coarse, detail view on desktop) instead of switching.
  if (selected && iso === selected.iso) {
    if (isMobileSheet()) {
      openSheetForClass(klass, e.lngLat, 'map');
    } else {
      setHoveredKlass(klass);
      showDetail(klass, 'map');
    }
    return;
  }
  await selectCountry(iso);
});

map.on('mousemove', 'zones-fill', (e) => {
  if (coarsePointer) return;
  const feat = e.features?.[0];
  if (!feat) return;
  const iso = feat.properties.iso3;
  const onSelected = selected && iso === selected.iso;
  // Cheap, always-on: signal clickability even before any selection.
  map.getCanvas().style.cursor = onSelected ? 'crosshair' : 'pointer';

  if (!hasEverSelected) return;
  const klass = Number(feat.properties.koppen_class);
  scheduleHover({ iso, klass, lngLat: e.lngLat });
});
map.on('mouseleave', 'zones-fill', () => {
  if (coarsePointer) return;
  cancelHover();
  map.getCanvas().style.cursor = '';
  if (regionPopup) regionPopup.remove();
  setHoveredKlass(detailKlass);
  setHoveredIso(null);
});

function scheduleHover(args) {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    applyHover(args);
  }, HOVER_DELAY_MS);
}

function cancelHover() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
}

function applyHover({ iso, klass, lngLat }) {
  // Re-check state — selection may have changed during the debounce wait.
  if (!hasEverSelected) return;
  const onSelected = selected && selected.iso === iso;
  setHoveredIso(onSelected ? null : iso);

  if (onSelected) {
    if (!labelTooltipOpen) setHoveredKlass(klass);
    const ctx = selected.context.get(klass);
    if (!ctx || labelTooltipOpen) return;
    showHoverPopup(lngLat, regionInfoHtml(klass, ctx.exemplar, ctx.fraction, ctx.runnersUp));
    return;
  }

  setHoveredKlass(detailKlass);
  const brk = byIsoBreakdownSync?.get(iso);
  if (!brk) {
    if (regionPopup) regionPopup.remove();
    return;
  }
  showHoverPopup(lngLat, countryTipHtml(iso, brk));
}

function showHoverPopup(lngLat, html) {
  if (!regionPopup) {
    regionPopup = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, offset: 12, className: 'region-popup',
    });
  }
  regionPopup.setLngLat(lngLat).setHTML(html).addTo(map);
}

function countryTipHtml(iso, brk) {
  const rows = brk.top.map((row) => {
    const cls = KOPPEN_CLASSES[row.klass];
    if (!cls) return '';
    const pct = row.fraction >= 0.1 ? (row.fraction * 100).toFixed(0) : (row.fraction * 100).toFixed(1);
    return `
      <div class="country-tip__row">
        <span class="swatch" style="background:${cls.color}"></span>
        <span class="symbol">${cls.symbol}</span>
        <span class="name">${escapeHtml(cls.name)}</span>
        <span class="pct">${pct}%</span>
      </div>
    `;
  }).join('');
  const cta = selected && iso === selected.iso ? '' : '<div class="country-tip__cta">Click to explore →</div>';
  return `
    <div class="country-tip">
      <div class="country-tip__name">${escapeHtml(brk.name)}</div>
      <div class="country-tip__rows">${rows}</div>
      ${cta}
    </div>
  `;
}

async function selectCountry(iso, source = 'map') {
  const { byIso, exemplars } = await dataReady;
  const country = byIso.get(iso);
  if (!country) return;
  track('select-country', { iso, name: country.name, source });
  cancelHover();
  hasEverSelected = true;

  const classes = new Map();
  for (const f of country.features) {
    const k = f.properties.koppen_class;
    if (classes.has(k)) continue;
    const list = applyReferenceOrdering(
      (exemplars[k] ?? []).filter((e) => e.iso3 !== iso),
    );
    classes.set(k, { exemplars: list, index: 0 });
  }
  selected = {
    iso, name: country.name, features: country.features, classes,
    context: new Map(), partCandidates: null,
  };
  buildPartCandidates();
  lastEmitZoom = null;
  detailKlass = null;
  hoveredKlass = null;

  setCountryOutline(iso);
  applySelectionStyling(iso);
  $overlaySelect.value = iso;
  $overlayShuffle.disabled = false;
  $overlayClose.disabled = false;

  refreshLabels();
  showGrid();
  fitToFeatures(country.features);
}

function buildPartCandidates() {
  const candidates = [];
  for (const f of selected.features) {
    const k = f.properties.koppen_class;
    const featureTotal = f.properties.area_km2;
    const flat = turf.flatten(f);
    const parts = [];
    for (const sub of flat.features) {
      if (sub.geometry.type !== 'Polygon') continue;
      const partArea = turf.area(sub) / 1e6;
      parts.push({ sub, partArea });
    }
    for (const { sub, partArea } of parts) {
      const p = polylabel(sub.geometry.coordinates, 0.5);
      candidates.push({
        klass: k,
        anchor: [p[0], p[1]],
        partArea,
        featureTotal,
        featureParts: parts.length,
      });
    }
  }
  selected.partCandidates = candidates;
}

function getZoomTier() {
  const z = map.getZoom();
  if (z < 4) return 0;
  if (z < 5.5) return 1;
  return 2;
}
function getZoomThresholds(tier) {
  if (tier === 0) return { countryFrac: 0.005 };
  if (tier === 1) return { countryFrac: 0.002 };
  return { countryFrac: 0.0005 };
}

const MAX_LABELS_PER_CLASS = 3;

function clusterPartsScreen(candidates) {
  const vw = map.getContainer().clientWidth;
  const radiusPx = Math.max(150, vw / 5);
  const byClass = new Map();
  for (const c of candidates) {
    if (!byClass.has(c.klass)) byClass.set(c.klass, []);
    byClass.get(c.klass).push(c);
  }
  const clusters = [];
  for (const [klass, parts] of byClass) {
    const sorted = [...parts].sort((a, b) => b.partArea - a.partArea);
    const classClusters = [];
    for (const part of sorted) {
      const pt = map.project(part.anchor);
      let merged = null;
      for (const cl of classClusters) {
        const dx = pt.x - cl.screenPt.x;
        const dy = pt.y - cl.screenPt.y;
        if (Math.hypot(dx, dy) < radiusPx) { merged = cl; break; }
      }
      if (merged) {
        merged.totalArea += part.partArea;
        merged.partCount += 1;
      } else {
        classClusters.push({
          klass,
          anchor: part.anchor,
          screenPt: pt,
          totalArea: part.partArea,
          partCount: 1,
        });
      }
    }
    clusters.push(...spreadCap(classClusters, MAX_LABELS_PER_CLASS));
  }
  return clusters;
}

function spreadCap(cs, k) {
  if (cs.length <= k) return cs;
  const sorted = [...cs].sort((a, b) => b.totalArea - a.totalArea);
  const picked = [sorted[0]];
  const remaining = sorted.slice(1);
  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      let minDist = Infinity;
      for (const p of picked) {
        const dx = remaining[i].screenPt.x - p.screenPt.x;
        const dy = remaining[i].screenPt.y - p.screenPt.y;
        const d = Math.hypot(dx, dy);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestDist) { bestDist = minDist; bestIdx = i; }
    }
    picked.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return picked;
}

function applySelectionStyling(iso) {
  map.setPaintProperty('zones-fill', 'fill-color', [
    'case',
    ['==', ['get', 'iso3'], iso],
    buildFillColorExpression(),
    '#f1ede5',
  ]);
  map.setPaintProperty('zones-fill', 'fill-opacity', [
    'case',
    ['==', ['get', 'iso3'], iso],
    0.85,
    1.0,
  ]);
  map.setPaintProperty('zones-outline', 'line-opacity', 0);
  // Hide only the country/state labels (they fight our region labels); leave the
  // basemap's city/town labels on so the user sees where the zones really are.
  for (const id of basemapCountryLabelLayers) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }
}

function clearSelectionStyling() {
  map.setPaintProperty('zones-fill', 'fill-color', buildFillColorExpression());
  map.setPaintProperty('zones-fill', 'fill-opacity', 0.78);
  map.setPaintProperty('zones-outline', 'line-opacity', 0.35);
  for (const id of basemapCountryLabelLayers) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
  }
}

function setHoveredIso(iso) {
  if (hoveredIso === iso) return;
  hoveredIso = iso;
  const src = map.getSource('country-hover');
  if (!src) return;
  if (!iso) {
    src.setData(emptyFC());
    return;
  }
  const outline = getOrBuildCountryOutline(iso);
  src.setData(outline ? { type: 'FeatureCollection', features: [outline] } : emptyFC());
}

// Returns a dissolved outline feature for the given iso, computing it once
// (via turf.union) and caching for the session. Returns null if the country
// isn't in the data set yet, or unioning failed.
function getOrBuildCountryOutline(iso) {
  if (countryOutlineCache.has(iso)) return countryOutlineCache.get(iso);
  const entry = lastDataByIso?.get(iso);
  if (!entry) return null;
  let outline;
  if (entry.features.length === 1) {
    outline = entry.features[0];
  } else {
    try {
      outline = turf.union(turf.featureCollection(entry.features));
    } catch {
      outline = null;
    }
  }
  countryOutlineCache.set(iso, outline);
  return outline;
}

function setHoveredKlass(k) {
  hoveredKlass = k;
  const noMatch = ['==', ['get', 'iso3'], '__none__'];
  if (!selected || k == null) {
    if (map.getLayer('zones-hover-outline')) map.setFilter('zones-hover-outline', noMatch);
    if (map.getLayer('zones-hover-glow')) map.setFilter('zones-hover-glow', noMatch);
  } else {
    const f = ['all',
      ['==', ['get', 'iso3'], selected.iso],
      ['==', ['get', 'koppen_class'], k],
    ];
    if (map.getLayer('zones-hover-outline')) map.setFilter('zones-hover-outline', f);
    if (map.getLayer('zones-hover-glow')) map.setFilter('zones-hover-glow', f);
  }
  syncGridHover();
}

function clearSelection() {
  cancelHover();
  selected = null;
  detailKlass = null;
  if (map.getSource('country-outline')) {
    map.getSource('country-outline').setData(emptyFC());
  }
  setHoveredKlass(null);
  setHoveredIso(null);
  clearRegionMarkers();
  clearCityMarkers();
  if (labelPopup) labelPopup.remove();
  if (regionPopup) regionPopup.remove();
  labelTooltipOpen = false;
  if (map.getLayer('zones-fill')) clearSelectionStyling();
  $overlaySelect.value = '';
  $overlayShuffle.disabled = true;
  $overlayClose.disabled = true;
  hideWidget();
  closeSheet();
}

function clearRegionMarkers() {
  for (const m of regionMarkers) m.remove();
  regionMarkers = [];
  markersByClass = new Map();
}

const countryOutlineCache = new Map();

function setCountryOutline(iso) {
  const outline = getOrBuildCountryOutline(iso);
  const data = outline
    ? { type: 'FeatureCollection', features: [outline] }
    : emptyFC();
  map.getSource('country-outline').setData(data);
}

function shuffleOne(klass) {
  if (!selected) return;
  const entry = selected.classes.get(klass);
  if (!entry || entry.exemplars.length <= 1) return;
  track('shuffle-region', { iso: selected.iso, koppen: KOPPEN_CLASSES[klass]?.symbol });
  entry.index = (entry.index + 1) % entry.exemplars.length;
  refreshLabels();
  if (detailKlass === klass) showDetail(klass); // refresh detail view text
}

function shuffleAll() {
  if (!selected) return;
  for (const entry of selected.classes.values()) {
    if (entry.exemplars.length <= 1) continue;
    entry.index = (entry.index + 1) % entry.exemplars.length;
  }
  refreshLabels();
  if (detailKlass != null) showDetail(detailKlass);
}

// --- Labels ----------------------------------------------------------------

function refreshLabels() {
  if (!selected) return;
  clearRegionMarkers();
  if (labelPopup) labelPopup.remove();
  labelTooltipOpen = false;

  const total = selected.features.reduce((s, f) => s + f.properties.area_km2, 0);
  const tier = getZoomTier();
  lastEmitZoom = map.getZoom();
  const { countryFrac } = getZoomThresholds(tier);
  const minLabelArea = total * countryFrac;

  const areaByClass = new Map();
  for (const f of selected.features) {
    const k = f.properties.koppen_class;
    areaByClass.set(k, (areaByClass.get(k) ?? 0) + f.properties.area_km2);
  }
  const orderedClasses = [...areaByClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const used = new Set();
  const pickByClass = new Map();
  for (const k of orderedClasses) {
    const entry = selected.classes.get(k);
    if (!entry || entry.exemplars.length === 0) continue;
    let pick = null;
    for (let off = 0; off < entry.exemplars.length; off++) {
      const j = (entry.index + off) % entry.exemplars.length;
      const ex = entry.exemplars[j];
      if (!used.has(ex.iso3)) { pick = ex; break; }
    }
    if (!pick) pick = entry.exemplars[entry.index];
    used.add(pick.iso3);
    pickByClass.set(k, pick);
  }

  selected.context = new Map();
  for (const k of orderedClasses) {
    const entry = selected.classes.get(k);
    const pick = pickByClass.get(k);
    if (!pick) continue;
    const runnersUp = (entry?.exemplars ?? [])
      .filter((e) => e.iso3 !== pick.iso3)
      .slice(0, 3);
    selected.context.set(k, {
      exemplar: pick,
      fraction: areaByClass.get(k) / total,
      runnersUp,
    });
  }

  const prioClasses = new Set(orderedClasses.slice(0, 3));

  const clusters = clusterPartsScreen(selected.partCandidates);
  for (const cluster of clusters) {
    const ctx = selected.context.get(cluster.klass);
    if (!ctx) continue;
    if (cluster.totalArea < minLabelArea) continue;
    const marker = createLabelMarker({
      klass: cluster.klass,
      partArea: cluster.totalArea,
      prio: prioClasses.has(cluster.klass),
      anchor: cluster.anchor,
    });
    regionMarkers.push(marker);
    if (!markersByClass.has(cluster.klass)) markersByClass.set(cluster.klass, []);
    markersByClass.get(cluster.klass).push(marker);
  }

  buildCityDots();
  requestAnimationFrame(runCollisionPass);
  // Re-render grid only when it's the visible widget body — if the user is in
  // the detail view, we re-render that branch in shuffleOne / shuffleAll.
  if (selected && detailKlass == null) renderGrid();
}

function createLabelMarker({ klass, partArea, prio, anchor }) {
  const ctx = selected.context.get(klass);
  const el = document.createElement('div');
  el.className = 'region-label';
  el.dataset.klass = String(klass);
  el.dataset.prio = prio ? '1' : '0';
  el.dataset.area = String(partArea);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'region-label__refresh';
  btn.title = 'Show a new match';
  btn.setAttribute('aria-label', 'Show a new match for this region');
  btn.textContent = '↺';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    shuffleOne(klass);
  });
  el.appendChild(btn);

  const name = document.createElement('span');
  name.className = 'region-label__name';
  name.textContent = ctx.exemplar.name;
  el.appendChild(name);

  const showTip = () => {
    if (!selected) return;
    const c = selected.context.get(klass);
    if (!c) return;
    if (regionPopup) regionPopup.remove();
    labelTooltipOpen = true;
    setHoveredKlass(klass);
    if (!labelPopup) {
      labelPopup = new maplibregl.Popup({
        closeButton: false, closeOnClick: false, offset: 16, className: 'region-popup',
      });
    }
    labelPopup
      .setLngLat(anchor)
      .setHTML(regionInfoHtml(klass, c.exemplar, c.fraction, c.runnersUp))
      .addTo(map);
  };

  if (coarsePointer) {
    el.addEventListener('click', (e) => {
      // Don't fire if the refresh button was the target.
      if (e.target.closest('.region-label__refresh')) return;
      openSheetForClass(klass, undefined, 'label');
    });
  } else {
    el.addEventListener('mouseenter', showTip);
    el.addEventListener('mouseleave', () => {
      labelTooltipOpen = false;
      if (labelPopup) labelPopup.remove();
      setHoveredKlass(detailKlass);
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('.region-label__refresh')) return;
      setHoveredKlass(klass);
      showDetail(klass, 'label');
    });
  }

  return new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat(anchor)
    .addTo(map);
}

function runCollisionPass() {
  if (!regionMarkers.length) return;
  const PAD = 4;
  const sorted = [...regionMarkers].sort((a, b) => {
    const ea = a.getElement(), eb = b.getElement();
    const pa = Number(ea.dataset.prio), pb = Number(eb.dataset.prio);
    if (pa !== pb) return pb - pa;
    return Number(eb.dataset.area) - Number(ea.dataset.area);
  });
  for (const m of sorted) m.getElement().style.visibility = 'visible';
  const placed = [];
  for (const m of sorted) {
    const el = m.getElement();
    const r = el.getBoundingClientRect();
    if (el.dataset.prio === '1') {
      placed.push(r);
      continue;
    }
    const overlaps = placed.some((p) =>
      !(r.right + PAD < p.left || r.left > p.right + PAD ||
        r.bottom + PAD < p.top || r.top > p.bottom + PAD));
    if (overlaps) {
      el.style.visibility = 'hidden';
    } else {
      placed.push(r);
    }
  }
}

// --- City dots -------------------------------------------------------------
//
// For each climate zone of the selected country, the matched country's cities
// in that same Köppen class are scattered across the zone. Placement is rough:
// each city is mapped by its relative lng/lat into the zone, so eastern cities
// land east, northern north — "across the entirety of the region", loosely.

const MAX_CITY_DOTS_PER_ZONE = 4; // upper bound; small/compact zones get fewer
const CITY_DOT_NUDGE_DEG = 1.2;   // soft de-overlap only — never drops a city

// How many dots a zone earns, from its total area. This is decoupled from
// placement: the count scales with region size, but every chosen city is still
// placed at its best spot (no hard spacing rule throwing well-placed cities away).
function cityCountForArea(km2) {
  if (km2 < 150_000) return 1;
  if (km2 < 600_000) return 2;
  if (km2 < 1_500_000) return 3;
  return MAX_CITY_DOTS_PER_ZONE;
}

function clearCityMarkers() {
  for (const m of cityMarkers) m.remove();
  cityMarkers = [];
}

function buildCityDots() {
  clearCityMarkers();
  if (!selected || !citiesByCountry) return;

  // Group the selected country's polygons by class once.
  const featsByClass = new Map();
  for (const f of selected.features) {
    const k = f.properties.koppen_class;
    if (!featsByClass.has(k)) featsByClass.set(k, []);
    featsByClass.get(k).push(f);
  }

  for (const [k, ctx] of selected.context) {
    const iso = ctx.exemplar?.iso3;
    const cities = iso && citiesByCountry[iso]?.[k];
    if (!cities || !cities.length) continue; // matched country has no city here
    const zoneFeats = featsByClass.get(k);
    if (!zoneFeats) continue;

    const polygons = [];
    for (const f of zoneFeats) {
      for (const sub of turf.flatten(f).features) {
        if (sub.geometry.type === 'Polygon') polygons.push(sub.geometry.coordinates);
      }
    }
    if (!polygons.length) continue;

    const zoneArea = zoneFeats.reduce((s, f) => s + f.properties.area_km2, 0);
    for (const p of scatterCities(cities, polygons, cityCountForArea(zoneArea))) {
      cityMarkers.push(createCityMarker(p.label, [p.lng, p.lat]));
    }
  }
}

// A dot pin + the city name, anchored so the pin sits on the coordinate. Uses
// the app's serif font (.city-dot in index.html), matching the country labels.
function createCityMarker(label, lngLat) {
  const el = document.createElement('div');
  el.className = 'city-dot';
  const pin = document.createElement('span');
  pin.className = 'city-dot__pin';
  const name = document.createElement('span');
  name.className = 'city-dot__name';
  name.textContent = label;
  el.appendChild(pin);
  el.appendChild(name);
  return new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat(lngLat).addTo(map);
}

// Place the `n` biggest cities at interior points of the zone, each mapped to its
// best relative position (a city in eastern China lands in the east of the zone).
// `n` already scales with region size; here we never drop a city — we just prefer
// a spot CITY_DOT_NUDGE_DEG away from the ones already placed to avoid overlap,
// and fall back to the nearest spot if no clear one exists.
function scatterCities(cities, polygons, n) {
  if (!cities.length || n <= 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  const candidates = sampleInterior(polygons, minX, minY, maxX, maxY);
  if (!candidates.length) return [];
  const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
  for (const c of candidates) { c.nx = (c.lng - minX) / spanX; c.ny = (c.lat - minY) / spanY; }

  // Normalize cities within their own bbox so the arrangement maps in.
  let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
  for (const c of cities) {
    if (c.lng < cMinX) cMinX = c.lng; if (c.lng > cMaxX) cMaxX = c.lng;
    if (c.lat < cMinY) cMinY = c.lat; if (c.lat > cMaxY) cMaxY = c.lat;
  }
  const cSpanX = (cMaxX - cMinX) || 1, cSpanY = (cMaxY - cMinY) || 1;

  // Latitude-weight longitude so the overlap nudge reflects real distance.
  const cosLat = Math.max(0.2, Math.cos(((minY + maxY) / 2) * Math.PI / 180));
  const nudge2 = CITY_DOT_NUDGE_DEG * CITY_DOT_NUDGE_DEG;

  const used = new Array(candidates.length).fill(false);
  const placed = [];
  const take = Math.min(n, cities.length);
  for (let i = 0; i < take; i++) {
    const city = cities[i]; // biggest-first
    const nx = (city.lng - cMinX) / cSpanX, ny = (city.lat - cMinY) / cSpanY;
    // Nearest non-overlapping candidate, with the overall nearest as a fallback
    // so a city is never skipped (two close-but-real cities beat one lonely dot).
    let best = -1, bestD = Infinity, fallback = -1, fbD = Infinity;
    for (let j = 0; j < candidates.length; j++) {
      if (used[j]) continue;
      const cand = candidates[j];
      const dx = cand.nx - nx, dy = cand.ny - ny;
      const d = dx * dx + dy * dy;
      if (d < fbD) { fbD = d; fallback = j; }
      let overlaps = false;
      for (const pt of placed) {
        const ox = (pt.lng - cand.lng) * cosLat, oy = pt.lat - cand.lat;
        if (ox * ox + oy * oy < nudge2) { overlaps = true; break; }
      }
      if (!overlaps && d < bestD) { bestD = d; best = j; }
    }
    const pick = best >= 0 ? best : fallback;
    if (pick < 0) break;
    used[pick] = true;
    placed.push({ label: city.label, lng: candidates[pick].lng, lat: candidates[pick].lat });
  }
  return placed;
}

// Grid-sample interior points of the zone; spacing selection thins them later.
function sampleInterior(polygons, minX, minY, maxX, maxY) {
  const g = 16;
  const stepX = (maxX - minX) / (g + 1), stepY = (maxY - minY) / (g + 1);
  const pts = [];
  for (let i = 1; i <= g; i++) for (let j = 1; j <= g; j++) {
    const lng = minX + stepX * i, lat = minY + stepY * j;
    if (pointInPolygons(lng, lat, polygons)) pts.push({ lng, lat });
  }
  return pts;
}

// Even-odd ray cast; a point inside any polygon's outer-minus-holes counts.
function pointInPolygons(x, y, polygons) {
  for (const poly of polygons) {
    let inside = false;
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

function regionInfoHtml(klass, exemplar, fraction, runnersUp) {
  const cls = KOPPEN_CLASSES[klass];
  const pct = fraction >= 0.1 ? (fraction * 100).toFixed(0) : (fraction * 100).toFixed(1);
  const also = runnersUp.length
    ? `<div class="region-tip__also">Also: ${runnersUp.slice(0, 2).map((e) => escapeHtml(e.name)).join(', ')}</div>`
    : '';
  return `
    <div class="region-tip">
      <div class="region-tip__match">Climate of <b>${escapeHtml(exemplar.name)}</b></div>
      <div class="region-tip__koppen">
        <span class="swatch" style="background:${cls.color}"></span>
        <span class="symbol">${cls.symbol}</span>
        <span class="name">${escapeHtml(cls.name)}</span>
      </div>
      <div class="region-tip__share">${pct}% of ${escapeHtml(selected.name)}</div>
      ${also}
    </div>
  `;
}

// --- Climate widget --------------------------------------------------------

function showWidget() {
  $widget.classList.add('open');
  $widget.classList.remove('collapsed');
  $widgetHeader.setAttribute('aria-expanded', 'true');
}
function hideWidget() {
  $widget.classList.remove('open');
  $widgetCountry.textContent = '';
  $grid.innerHTML = '';
  $widgetBody.innerHTML = '<div id="climate-grid"></div>';
  // re-bind reference after innerHTML wipe
  bindGridRef();
}

let gridRef = $grid;
function bindGridRef() { gridRef = document.getElementById('climate-grid'); }

function showGrid() {
  if (!selected) return;
  detailKlass = null;
  $widgetCountry.textContent = ` · ${selected.name}`;
  $widgetBody.innerHTML = '<div id="climate-grid"></div>';
  bindGridRef();
  // Widget must be visible before measuring — otherwise getBoundingClientRect
  // returns 0×0 and the treemap collapses.
  showWidget();
  renderGrid();
}

function renderGrid() {
  if (!selected || !gridRef || !gridRef.isConnected) return;
  const rectCheck = gridRef.getBoundingClientRect();
  if (rectCheck.width < 8 || rectCheck.height < 8) return;
  // Compute per-class shares.
  const total = selected.features.reduce((s, f) => s + f.properties.area_km2, 0);
  const byClass = new Map();
  for (const f of selected.features) {
    const k = f.properties.koppen_class;
    byClass.set(k, (byClass.get(k) ?? 0) + f.properties.area_km2);
  }
  const entries = [...byClass.entries()]
    .map(([klass, area]) => ({ klass, area, fraction: area / total }))
    .sort((a, b) => b.fraction - a.fraction);

  if (!entries.length) {
    gridRef.innerHTML = '<div class="widget-empty">No climate data.</div>';
    return;
  }

  const W = Math.max(200, rectCheck.width);
  const H = Math.max(160, rectCheck.height);
  const items = entries.map((e) => ({ ...e, value: e.fraction }));
  const layout = squarify(items, 0, 0, W, H);

  // Floor: anything below MIN_PX area gets re-flowed to a thin bottom strip.
  const MIN_AREA = 36 * 28;
  const big = [];
  const small = [];
  for (const node of layout) {
    if (node.w * node.h < MIN_AREA) small.push(node);
    else big.push(node);
  }
  // Re-squarify big cells in the upper region (leaving room for small strip).
  let bigLayout = big;
  if (small.length) {
    const stripH = 28;
    bigLayout = squarify(big.map((n) => ({ ...n, value: n.fraction })), 0, 0, W, Math.max(120, H - stripH));
    // Lay out small cells in a flex strip along the bottom.
    const stripY = Math.max(120, H - stripH);
    const stripWidth = W;
    const each = stripWidth / small.length;
    small.forEach((n, i) => {
      n.x = i * each;
      n.y = stripY;
      n.w = each - 2;
      n.h = stripH - 2;
      n.tiny = true;
    });
  }

  gridRef.innerHTML = '';
  const all = [...bigLayout, ...small];
  for (const node of all) {
    const cls = KOPPEN_CLASSES[node.klass];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'grid-cell' + (node.tiny ? ' tiny' : '');
    cell.dataset.klass = String(node.klass);
    cell.style.left = `${node.x}px`;
    cell.style.top = `${node.y}px`;
    cell.style.width = `${Math.max(0, node.w - 2)}px`;
    cell.style.height = `${Math.max(0, node.h - 2)}px`;
    cell.style.background = cls.color;
    cell.style.color = pickTextColor(cls.color);
    cell.title = `${cls.symbol} · ${cls.name} · ${formatPct(node.fraction)}%`;

    const sym = document.createElement('span');
    sym.className = 'symbol';
    sym.textContent = cls.symbol;
    cell.appendChild(sym);

    if (!node.tiny) {
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = `${formatPct(node.fraction)}%`;
      cell.appendChild(pct);
    }

    cell.addEventListener('mouseenter', () => {
      if (coarsePointer) return;
      setHoveredKlass(node.klass);
    });
    cell.addEventListener('mouseleave', () => {
      if (coarsePointer) return;
      setHoveredKlass(detailKlass);
    });
    cell.addEventListener('click', () => {
      setHoveredKlass(node.klass);
      showDetail(node.klass, 'grid');
    });
    gridRef.appendChild(cell);
  }
  syncGridHover();
}

function syncGridHover() {
  if (!gridRef) return;
  for (const el of gridRef.querySelectorAll('.grid-cell')) {
    el.classList.toggle('is-hovered', Number(el.dataset.klass) === hoveredKlass);
  }
}

function showDetail(klass, source) {
  if (!selected) return;
  detailKlass = klass;
  const ctx = selected.context.get(klass);
  if (!ctx) return;
  // `source` set only on user-initiated opens; shuffle refreshes pass nothing.
  if (source) track('view-region', { iso: selected.iso, koppen: KOPPEN_CLASSES[klass]?.symbol, source });
  const cls = KOPPEN_CLASSES[klass];
  const area = [...selected.features]
    .filter((f) => f.properties.koppen_class === klass)
    .reduce((s, f) => s + f.properties.area_km2, 0);

  $widgetBody.innerHTML = `
    <button class="detail-back" type="button">← Back to grid</button>
    <div class="detail-swatch-row">
      <span class="detail-swatch" style="background:${cls.color}"></span>
      <div class="detail-meta">
        <div><span class="symbol">${cls.symbol}</span></div>
        <div class="name">${escapeHtml(cls.name)}</div>
      </div>
    </div>
    <div class="detail-share">${formatPct(ctx.fraction)}% of ${escapeHtml(selected.name)} · ${Math.round(area).toLocaleString()} km²</div>
    <div class="detail-match">
      <button type="button" title="Show a new match" aria-label="Show a new match">↺</button>
      <span>Climate of <b>${escapeHtml(ctx.exemplar.name)}</b></span>
    </div>
    ${ctx.runnersUp.length ? `<div class="detail-also">Also: ${ctx.runnersUp.map((e) => escapeHtml(e.name)).join(', ')}</div>` : ''}
  `;
  $widgetBody.querySelector('.detail-back').addEventListener('click', () => {
    detailKlass = null;
    setHoveredKlass(null);
    showGrid();
  });
  $widgetBody.querySelector('.detail-match button').addEventListener('click', () => {
    shuffleOne(klass);
  });
  showWidget();
}

function pickTextColor(rgbStr) {
  const m = rgbStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return '#111';
  const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
  // Relative luminance, rec.709 weights.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

function formatPct(f) {
  if (f >= 0.1) return (f * 100).toFixed(0);
  if (f >= 0.005) return (f * 100).toFixed(1);
  return '<1';
}

// --- Squarified treemap (sorted-rows variant) ------------------------------
//
// Returns an array of { klass, fraction, x, y, w, h } for the input items,
// packed inside [x0, y0, x0+w, y0+h]. Items must have a `.value` (>=0).
//
// This is a compact implementation of the Bruls/Huijsen/Vliegen 2000
// "squarified treemaps" algorithm. We keep `klass` and `fraction` pass-through.
function squarify(items, x0, y0, w, h) {
  if (!items.length || w <= 0 || h <= 0) return [];
  const totalValue = items.reduce((s, it) => s + Math.max(0, it.value), 0) || 1;
  // Scale values to area.
  const scaled = items.map((it) => ({ ...it, area: (Math.max(0, it.value) / totalValue) * (w * h) }));

  const result = [];
  let rect = { x: x0, y: y0, w, h };

  function shortSide(r) { return Math.min(r.w, r.h); }
  function worst(row, side) {
    let sum = 0, max = 0, min = Infinity;
    for (const it of row) {
      sum += it.area;
      if (it.area > max) max = it.area;
      if (it.area < min) min = it.area;
    }
    if (sum === 0) return Infinity;
    const s2 = side * side;
    const sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  }
  function layoutRow(row, r) {
    if (!row.length) return r;
    const side = shortSide(r);
    const sum = row.reduce((s, it) => s + it.area, 0);
    if (sum <= 0) return r;
    const otherSide = sum / side;
    let isHorizRow; // row laid horizontally?
    // Lay along the shorter side: if w <= h, side = w and row goes horizontally
    // along width; new sub-rect is below.
    if (r.w <= r.h) {
      isHorizRow = true;
      let xx = r.x;
      const yy = r.y;
      for (const it of row) {
        const cellW = (it.area / sum) * r.w;
        result.push({ klass: it.klass, fraction: it.fraction, x: xx, y: yy, w: cellW, h: otherSide });
        xx += cellW;
      }
      return { x: r.x, y: r.y + otherSide, w: r.w, h: r.h - otherSide };
    } else {
      isHorizRow = false;
      const xx = r.x;
      let yy = r.y;
      for (const it of row) {
        const cellH = (it.area / sum) * r.h;
        result.push({ klass: it.klass, fraction: it.fraction, x: xx, y: yy, w: otherSide, h: cellH });
        yy += cellH;
      }
      return { x: r.x + otherSide, y: r.y, w: r.w - otherSide, h: r.h };
    }
  }

  // Sort largest-first.
  const queue = [...scaled].sort((a, b) => b.area - a.area);

  let row = [];
  while (queue.length || row.length) {
    const side = shortSide(rect);
    if (queue.length === 0) {
      rect = layoutRow(row, rect);
      row = [];
      break;
    }
    const next = queue[0];
    const withNext = [...row, next];
    if (row.length === 0 || worst(withNext, side) <= worst(row, side)) {
      row.push(next);
      queue.shift();
    } else {
      rect = layoutRow(row, rect);
      row = [];
    }
  }
  return result;
}

// --- Bottom sheet (mobile) -------------------------------------------------

function isMobileSheet() {
  return coarsePointer || mqMobile.matches;
}

function openSheetForClass(klass, lngLat, source) {
  if (!selected) return;
  const ctx = selected.context.get(klass);
  if (!ctx) return;
  if (source) track('view-region', { iso: selected.iso, koppen: KOPPEN_CLASSES[klass]?.symbol, source });
  setHoveredKlass(klass);
  $sheetContent.innerHTML = regionInfoHtml(klass, ctx.exemplar, ctx.fraction, ctx.runnersUp);
  $sheet.classList.add('open');
  $sheet.setAttribute('aria-hidden', 'false');
}

function closeSheet() {
  $sheet.classList.remove('open');
  $sheet.setAttribute('aria-hidden', 'true');
  if (!detailKlass) setHoveredKlass(null);
}

// --- Camera ----------------------------------------------------------------

function fitToFeatures(features) {
  if (!features.length) return;

  const boxes = [];
  for (const f of features) {
    const flat = turf.flatten(f);
    for (const sub of flat.features) boxes.push(turf.bbox(sub));
  }
  if (!boxes.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    if (b[0] < minX) minX = b[0];
    if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2];
    if (b[3] > maxY) maxY = b[3];
  }

  if (maxX - minX > 180) {
    minX = Infinity; maxX = -Infinity;
    for (const b of boxes) {
      const x1 = b[0] < 0 ? b[0] + 360 : b[0];
      const x2 = b[2] < 0 ? b[2] + 360 : b[2];
      if (x1 < minX) minX = x1;
      if (x2 > maxX) maxX = x2;
    }
  }

  // On mobile, leave room for the bottom sheet by adding extra bottom padding.
  const pad = isMobileSheet()
    ? { top: 40, bottom: 40, left: 30, right: 30 }
    : { top: 80, bottom: 80, left: 80, right: 360 }; // 360 = clear widget on right

  map.fitBounds(
    [[minX, minY], [maxX, maxY]],
    { padding: pad, duration: 700, maxZoom: 6 },
  );
}

// --- Utilities -------------------------------------------------------------

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
