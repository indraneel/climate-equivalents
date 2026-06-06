# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project

Viral-map-style climate equivalents tool: click a country, see it split into
its Köppen-Geiger zones, with each zone labeled by **another country that
shares that climate** ("the Pampas have the climate of the southeastern US").

Fully serverless. No backend, no build step, no framework. The entire app is
three static files (`index.html`, `app.js`, `koppen-data.js`) plus two
pre-baked data files in `data/`. Hosting anywhere with static file serving
works.

## Stack

- **MapLibre GL JS** (4.7) — basemap (`demotiles`) + GeoJSON fill / line /
  symbol layers, loaded via CDN.
- **Turf.js** (7) — `pointOnFeature`, `flatten`, `bbox`, `intersect`,
  `simplify`, `area`. Loaded via CDN.
- **Vanilla ES modules** in `app.js` — no bundler.
- **Python + uv** for offline data prep (`scripts/prep_country_zones.py`
  with PEP 723 inline deps: `rasterio`, `geopandas`, `shapely`).

## Layout

```
index.html              Shell + map container + side panel + top overlay
app.js                  All runtime logic (mode state, layers, shuffle, fit)
koppen-data.js          KOPPEN_CLASSES = { id → symbol, name, color } (30 classes)
scripts/
  prep_country_zones.py Offline prep: tif → polygonize → overlay → simplify
  prep_city_exemplars.py Offline prep: geonames cities → nearest-zone → group
data/
  country-zones.geojson 1054 (subunit, class) MultiPolygons, ~11.5 MB
  class-exemplars.json  Per-class top-8 subunits by area
  cities-by-country.json { iso3 → { class → [{label,lng,lat,pop}] } } city dots
koppen_geiger_tif/      Beck et al. 2023, downloaded once. .tif source files
cities_geonames/        GeoNames cities15000 (prep-time only, auto-downloaded)
subunits.geojson        Natural Earth 10m Admin-0 Map Subunits (~25 MB,
                        prep-time only). Splits France→{France, Corsica,
                        French Guiana, Réunion, …}, USA→{Continental,
                        Alaska, Hawaii, Puerto Rico, …}, Norway→{Norway,
                        Svalbard, Jan Mayen, …}, etc. Keyed by SU_A3.
```

`data/` is a build artifact — regenerate from source with `uv run
scripts/prep_country_zones.py` after editing the prep script. The current
`country-zones.geojson` is built from the 10 km (`0p1`) Beck raster with
0.02° simplify tolerance and a 200 km² area floor.

`cities-by-country.json` is regenerated independently with `uv run
scripts/prep_city_exemplars.py` — no raster needed. It pulls GeoNames
`cities15000` (auto-cached to `cities_geonames/`), keeps cities with pop ≥ 1M
or that are national capitals (~700), and assigns each its Köppen class **and
its country `iso3`** from a nearest-polygon join against `country-zones.geojson`.
Keying on the *zone's* iso3 (GU_A3, e.g. France = `FXX`, UK split into
`ENG`/`SCT`/`WLS`) is deliberate: it's the same code the exemplars use, so the
app's `citiesByCountry[matchedIso3][class]` lookups always line up.

The "country" terminology in the UI and code is shorthand for "Natural
Earth map subunit" — for most entries (Brazil, Japan, Kenya) the two are
identical, but ~30 sovereign states are split so overseas territories
become their own clickable entities. This keeps the climate-equivalents
premise honest: clicking France no longer also lights up French Guiana
(separate units, the latter correctly matched to Brazil's climate).

## Run

```bash
python3 -m http.server 8765    # serve project root
open http://localhost:8765/
```

Plain `http.server` is sufficient. **No fancy cache-control wrapper** — we
tried that and it created port-contention bugs when restarts overlapped.
Hard-reload Chrome (Cmd+Shift+R) when iterating on `app.js` / `index.html`.

## Modes

- **Country mode (default).** Click a colored region → that country's zones
  show vivid Köppen colors, all other countries are greyed; the country
  name appears in a floating pill at the top with `⟲` (shuffle all
  comparisons) and `✕` (clear) buttons; each climate region is labeled
  with the country it climate-matches. Click a label to cycle that one
  region's match.
  - **City dots.** Additive on top of the country labels; appear as soon as a
    country is selected (no zoom gate). Each zone gets real cities **of its
    matched country** sharing that climate — the China-matched SE-US zone shows
    Shanghai/Wuhan/Guangzhou. They're **HTML markers** (`.city-dot`,
    `createCityMarker`), not a MapLibre symbol layer, so they can use the app's
    Cormorant serif — demotiles glyphs are Open Sans only. `buildCityDots()` (end
    of `refreshLabels`, so it tracks selection + shuffle) per zone looks up
    `citiesByCountry[ctx.exemplar.iso3][class]`, then:
    - **count** scales with the zone's area (`cityCountForArea`, capped at
      `MAX_CITY_DOTS_PER_ZONE` = 4) — small/compact zones get 1–2, big ones up to 4;
    - **placement** (`scatterCities`) maps each city's relative lng/lat in its own
      country onto the same relative spot in the zone (eastern-China cities land
      east), with a soft `CITY_DOT_NUDGE_DEG` de-overlap that **never drops a
      city** (two close real cities beat one lonely dot). Count and placement are
      deliberately decoupled — no hard spacing rule throwing well-placed cities away.
    Relative placement is *not* hemisphere-flipped, and needn't be: every dot is
    already a city of the zone's Köppen class, so position is purely cosmetic
    spread. A matched country with no qualifying city in that class (deserts,
    polar, many 2nd-choice shuffle matches) simply gets no dots.
- **Draw mode.** Click vertices to build a polygon, double-click or hit
  "Finish drawing" to close → side panel shows a per-class breakdown with
  the top exemplar per class. Uses Turf intersect against the country-zones
  data, no DuckDB.

## Key invariants

- **`KOPPEN_CLASSES` keys match the integer pixel values in the Beck raster
  and in `country-zones.geojson` `properties.koppen_class`.** Don't renumber.
- **The same class→color map drives both the raster (not yet shipped) and
  the vector zones.** Both come from `legend.txt` in the Beck archive.
- **Per-country shuffle state lives in `selected.classes` as a `Map<classId,
  { exemplars, index }>`.** The `exemplars` array has self already filtered
  out. The displayed label is computed by greedy dedupe (see below), so the
  raw `index` is just user intent, not necessarily what's on screen.

## Gotchas (we hit these — don't re-discover)

- **demotiles glyph endpoint serves only single-font stacks.** Setting
  `'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold']` makes
  MapLibre fetch `font/Open Sans Semibold,Arial Unicode MS Bold/*.pbf` which
  404s — the symbol layer then silently renders nothing. Use exactly
  `['Open Sans Semibold']`.
- **Basemap text labels collide with ours.** With `text-allow-overlap: false`,
  the demotiles `countries-label` / `geolines-label` layers win and suppress
  our region labels. `app.js` snapshots all basemap symbol layers on load
  (`basemapSymbolLayers`) and hides them during a country selection.
- **`fitToFeatures` frames the bbox of every polygon part — no outlier
  rejection.** An earlier version dropped Alaska / Hawaii / Chukchi via a
  weighted-median centroid + gap-cut heuristic so the camera framed the
  mainland tightly; we removed that because losing Alaska when the user
  clicks "USA" is worse than a slightly looser frame. Only special case
  retained: dateline unwrap (longitudes < 0 shifted by 360° when total
  longitude span exceeds 180°), needed for Russia / Fiji.
- **Greedy dedupe in `refreshLabels`.** Classes are ranked by area desc;
  each picks the first exemplar at-or-after its shuffle `index` that
  hasn't been claimed by a larger sibling. Per-region shuffle therefore
  cascades — bumping Cfa's index can free its previous exemplar for BSk
  to pick up. This is intentional.
- **Test-cache traps.** `page.goto(url + '?v=N')` does not bust
  `import './app.js'` — ES module URLs cache separately. In dev-browser
  tests use a CDP `Network.clearBrowserCache` + `setCacheDisabled` session.

## Camera tunables (`fitToFeatures`)

- `maxZoom: 6, padding: 80` — `fitBounds` knobs. Padding governs breathing
  room; max-zoom prevents tiny countries (Vatican-ish) from filling the
  screen pixel-perfect.

## Phase progression

- **Phase 0** (skipped — went straight to Phase 1): planned mock GeoJSON
  + Turf, no real data. Code lived here briefly.
- **Phase 1**: 50 km Köppen polygonization, side-panel breakdown with
  exemplar list. ~2.5 MB GeoJSON, 28 classes.
- **Phase 1.5** (current): 10 km Köppen polygonization, country-centric
  UX (overlay header, on-map labels, shuffle, grey-out non-selected).
  9.4 MB GeoJSON, 30 classes, 936 (country, class) features.

## Not yet wired (deferred)

- **deck.gl-raster + COG**: the original plan had a GPU raster layer for
  the climate data; we instead pre-polygonized into vectors. Adding the
  raster back would matter for inter-country shading at very low zoom.
- **DuckDB-WASM**: draw-mode currently uses Turf's `intersect` against
  the in-memory GeoJSON, which is fine at this data size. DuckDB pays
  for itself only if data grows ~10×.
- **Future climate scenarios** (CMIP6 SSPs in the Beck archive): re-run
  prep with a different `TIF` path; UI doesn't change. Add a period/scenario
  switcher in the side panel.

## Label collision — known limit

Dense N–S strips (the Andes inside Argentina/Chile) crowd many small zones
into a narrow band. MapLibre's collision picks one position per label and
culls the rest; sort-key + variable-anchor mitigates but doesn't fix it.
A proper fix is deck.gl `TextLayer` + `CollisionFilterExtension` with a
`LineLayer` for leader lines — flagged in chat history, not yet built.
