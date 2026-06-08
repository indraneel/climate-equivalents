# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "rasterio",
#   "geopandas",
#   "shapely>=2.0",
#   "numpy",
#   "pyogrio",
# ]
# ///
"""
Phase 1 prep — per-map-unit Köppen zone polygons + per-class exemplar ranking.

Reads:
  koppen_geiger_tif/1991_2020/koppen_geiger_0p1.tif  (Beck et al. 2023, ~10 km)
  subunits.geojson                                   (Natural Earth 10m admin-0
                                                      map subunits)

Writes:
  data/country-zones.geojson  — features: { iso3, name, koppen_class, area_km2 }
  data/class-exemplars.json   — { "<class_id>": [{iso3, name, area_km2}, ...] }

We key on Natural Earth's GU_A3 (map unit), not SU_A3 (map subunit) and not
the sovereign admin-0 code. The GU level is the cartographic sweet spot:

  - USA's Continental + Alaska + Hawaii all share GU_A3=USA, so they roll
    up into one clickable "United States of America".
  - Australia's mainland + Tasmania + Macquarie all share GU_A3=AUS.
  - Russia's mainland + Kaliningrad + Crimea all share GU_A3=RUS.
  - France's metropolitan + Corsica share GU_A3=FXX, but French Guiana
    (GUF), Réunion (REU), Mayotte (MYT), Guadeloupe (GLP), Martinique
    (MTQ) each have their own GU_A3 — so they stay separately clickable.
  - Same split-out for Norway/Svalbard/Jan Mayen, Netherlands/Caribbean
    Netherlands, Portugal/Madeira/Azores.

Using SU_A3 instead would split Alaska/Hawaii out of USA (the user wants
them together); using ADM0_A3 would re-collapse French Guiana into France
(the user wants them apart). GU_A3 is Natural Earth's deliberate design
intent for this kind of "geographic but politically grouped" rollup.

Run:
  uv run scripts/prep_country_zones.py
"""

import json
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import shapes
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
TIF = ROOT / "koppen_geiger_tif" / "1991_2020" / "koppen_geiger_0p1.tif"
SUBUNITS = ROOT / "subunits.geojson"
OUT_ZONES = ROOT / "data" / "country-zones.geojson"
OUT_EXEMPLARS = ROOT / "data" / "class-exemplars.json"

SIMPLIFY_TOL_DEG = 0.02
MIN_AREA_KM2 = 200  # drop slivers


def main():
    print(f"Reading {TIF.name}...")
    with rasterio.open(TIF) as src:
        arr = src.read(1)
        transform = src.transform
        nodata = src.nodata

    print(f"  raster shape: {arr.shape}, nodata={nodata}")

    # Polygonize categorical raster: one polygon per contiguous (class) region.
    print("Polygonizing raster...")
    polys = []
    for geom, val in shapes(arr.astype(np.int16), transform=transform):
        v = int(val)
        if v < 1 or v > 30:
            continue
        polys.append({"koppen_class": v, "geometry": shape(geom)})
    print(f"  {len(polys)} raw polygons")

    zones = gpd.GeoDataFrame(polys, geometry="geometry", crs="EPSG:4326")

    # Dissolve to one (Multi)Polygon per class — cuts the overlay cost.
    print("Dissolving zones by class...")
    zones = zones.dissolve(by="koppen_class", as_index=False)
    print(f"  {len(zones)} classes present")

    print(f"Reading {SUBUNITS.name}...")
    countries = gpd.read_file(SUBUNITS)
    countries = countries[["gu_a3", "geounit", "geometry"]].rename(
        columns={"gu_a3": "iso3", "geounit": "name"}
    )
    # Repair any invalid subunit geometries
    countries["geometry"] = countries.geometry.buffer(0)
    print(f"  {len(countries)} subunit rows (will dissolve to map-unit level)")

    # Per-country × per-class fragments.
    print("Overlaying countries × zones...")
    joined = gpd.overlay(countries, zones, how="intersection", keep_geom_type=False)
    print(f"  {len(joined)} (country, class) fragments")

    # Dissolve duplicates (e.g. when a country owns several disconnected pieces
    # of the same class) into one row per (iso3, koppen_class).
    print("Dissolving by (iso3, class)...")
    joined = joined.dissolve(
        by=["iso3", "koppen_class"],
        as_index=False,
        aggfunc={"name": "first"},
    )

    # Equal-area projection for area math.
    print("Computing areas...")
    joined["area_km2"] = joined.to_crs(6933).geometry.area / 1e6
    joined = joined[joined["area_km2"] >= MIN_AREA_KM2].copy()
    print(f"  {len(joined)} rows after area filter (>= {MIN_AREA_KM2} km²)")

    print("Simplifying geometries...")
    joined["geometry"] = joined.geometry.simplify(
        SIMPLIFY_TOL_DEG, preserve_topology=True
    )

    # Cast class to int for clean JSON output.
    joined["koppen_class"] = joined["koppen_class"].astype(int)
    joined["area_km2"] = joined["area_km2"].round(1)

    # Per-class exemplar ranking: top countries by area for that class.
    print("Ranking class exemplars...")
    exemplars: dict[int, list[dict]] = defaultdict(list)
    for klass, group in joined.groupby("koppen_class"):
        top = group.sort_values("area_km2", ascending=False).head(8)
        for _, row in top.iterrows():
            exemplars[int(klass)].append(
                {
                    "iso3": row["iso3"],
                    "name": row["name"],
                    "area_km2": float(row["area_km2"]),
                }
            )

    OUT_ZONES.parent.mkdir(exist_ok=True)
    out_cols = ["iso3", "name", "koppen_class", "area_km2", "geometry"]
    joined[out_cols].to_file(OUT_ZONES, driver="GeoJSON")

    with open(OUT_EXEMPLARS, "w") as f:
        json.dump({str(k): v for k, v in exemplars.items()}, f, indent=2)

    zone_mb = OUT_ZONES.stat().st_size / 1e6
    print(f"Wrote {OUT_ZONES} ({zone_mb:.1f} MB)")
    print(f"Wrote {OUT_EXEMPLARS}")


if __name__ == "__main__":
    main()
