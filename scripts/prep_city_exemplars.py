# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "geopandas",
#   "shapely>=2.0",
#   "pandas",
#   "pyogrio",
# ]
# ///
"""
Prep — recognizable cities grouped by country and Köppen class.

Feeds the on-map *city dots*. When a selected country's climate zone is matched
to another country (e.g. the SE-US humid-subtropical zone → China), the app
scatters that matched country's cities of the same climate across the zone
(Shanghai, Wuhan, Guangzhou…). So we need, per (country, Köppen class), the list
of that country's recognizable cities in that climate.

Reads:
  GeoNames cities15000  (downloaded once to cities_geonames/, gitignored)
  data/country-zones.geojson  (existing build artifact — supplies Köppen class)

We deliberately do NOT need the Köppen raster: country-zones.geojson already
encodes koppen_class as polygons, so each city's class comes from a nearest-zone
spatial join. Coastal/border cities snap to a neighbouring polygon — harmless,
since neighbours share climate.

Writes:
  data/cities-by-country.json  — { "<iso3>": { "<class_id>":
                                   [ {label, lng, lat, pop}, ... ] } }
  Cities are sorted by population (desc) within each (iso3, class), so the app
  can scatter the biggest/most-recognizable first.

The country key is the zone's own `iso3` (Natural Earth GU_A3) taken from the
nearest-zone join — the SAME code the app's exemplars use — so lookups always
line up (e.g. France = "FXX", not ISO "FRA"). A city wedged against a border may
snap to a neighbour's zone and be filed under it; harmless at this granularity.

Run:
  uv run scripts/prep_city_exemplars.py
"""

import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parent.parent
ZONES = ROOT / "data" / "country-zones.geojson"
CITIES_DIR = ROOT / "cities_geonames"
CITIES_TXT = CITIES_DIR / "cities15000.txt"
CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip"
OUT_CITIES = ROOT / "data" / "cities-by-country.json"

# Keep cities that are either large or a national capital, so every dot is a
# recognizable name. (No per-class cap — we want a rich pool to scatter.)
MIN_POP = 1_000_000
CAPITAL_CODES = {"PPLC"}  # GeoNames feature code for "capital of a country"

# GeoNames cities15000.txt columns (tab-separated, no header).
COLS = [
    "geonameid", "name", "asciiname", "alternatenames", "latitude", "longitude",
    "feature_class", "feature_code", "country_code", "cc2", "admin1", "admin2",
    "admin3", "admin4", "population", "elevation", "dem", "timezone", "moddate",
]


def download_cities():
    if CITIES_TXT.exists():
        return
    CITIES_DIR.mkdir(exist_ok=True)
    print(f"Downloading {CITIES_URL} ...")
    with urllib.request.urlopen(CITIES_URL) as resp:
        blob = resp.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        with zf.open("cities15000.txt") as src:
            CITIES_TXT.write_bytes(src.read())
    print(f"  cached to {CITIES_TXT}")


def main():
    download_cities()

    print(f"Reading {CITIES_TXT.name} ...")
    df = pd.read_csv(
        CITIES_TXT, sep="\t", header=None, names=COLS, low_memory=False,
        dtype={"country_code": "string", "feature_code": "string"},
    )
    df["population"] = pd.to_numeric(df["population"], errors="coerce").fillna(0)

    keep = (df["population"] >= MIN_POP) | (df["feature_code"].isin(CAPITAL_CODES))
    df = df[keep].copy()
    print(f"  {len(df)} candidate cities (pop >= {MIN_POP:,} or capital)")

    # Assign each city its Köppen class AND its country (iso3) from the nearest
    # country-zone polygon — keying on the zone's own iso3 keeps us consistent
    # with the app's exemplars (GU_A3, e.g. France = FXX).
    print(f"Reading {ZONES.name} and classifying cities ...")
    zones = gpd.read_file(ZONES)[["iso3", "koppen_class", "geometry"]]
    pts = gpd.GeoDataFrame(
        df.reset_index(drop=True),
        geometry=[Point(xy) for xy in zip(df["longitude"], df["latitude"])],
        crs="EPSG:4326",
    )
    joined = gpd.sjoin_nearest(pts, zones, how="left")
    joined = joined[~joined.index.duplicated(keep="first")]  # drop tie dupes
    joined = joined[joined["koppen_class"].notna() & joined["iso3"].notna()].copy()
    joined["koppen_class"] = joined["koppen_class"].astype(int)

    # Group by country -> class -> cities (sorted by population desc).
    print("Grouping cities by country and class ...")
    out: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    joined = joined.sort_values("population", ascending=False)
    for _, row in joined.iterrows():
        out[row["iso3"]][str(int(row["koppen_class"]))].append(
            {
                "label": row["name"],
                "lng": round(float(row["longitude"]), 4),
                "lat": round(float(row["latitude"]), 4),
                "pop": int(row["population"]),
            }
        )

    OUT_CITIES.parent.mkdir(exist_ok=True)
    serializable = {iso: dict(classes) for iso, classes in out.items()}
    with open(OUT_CITIES, "w") as f:
        json.dump(serializable, f, indent=2)

    n_countries = len(serializable)
    n_cities = sum(len(c) for cs in serializable.values() for c in cs.values())
    print(f"Wrote {OUT_CITIES} ({n_countries} countries, {n_cities} city slots)")


if __name__ == "__main__":
    main()
