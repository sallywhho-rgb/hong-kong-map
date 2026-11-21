"""Build the static station, line, and camera files used by the map.

Station names and line order come from the MTR open-data station list.
Coordinates come from the Lands Department location search, converted from
the Hong Kong 1980 grid to latitude and longitude. The next-train API has
no coordinates, and the station list omits Racecourse, so that station is
added from the same geocoder. Camera locations come from the Transport
Department snapshot-location table. Image URLs are built from the camera
key because two rows in that table have swapped URL fields.
"""

from __future__ import annotations

import csv
import io
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = ROOT / "scripts" / "geocode-cache.json"
NETWORK_PATH = ROOT / "src" / "data" / "network.json"
CAMERAS_PATH = ROOT / "src" / "data" / "cameras.json"

USER_AGENT = "hk-smart-city-map/0.1 (classroom project; data preparation)"
TRANSFORM = Transformer.from_crs("epsg:2326", "epsg:4326", always_xy=True)

STATION_URL = "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv"
CAMERA_URL = (
    "https://static.data.gov.hk/td/traffic-snapshot-images/code/"
    "Traffic_Camera_Locations_Tc.csv"
)

LINES = [
    {
        "code": "AEL",
        "nameZh": "機場快綫",
        "nameEn": "Airport Express",
        "color": "#00888A",
        "directions": ["UT"],
        "upLabel": "往博覽館",
        "downLabel": "往香港",
    },
    {
        "code": "TCL",
        "nameZh": "東涌綫",
        "nameEn": "Tung Chung Line",
        "color": "#F7941D",
        "directions": ["UT"],
        "upLabel": "往東涌",
        "downLabel": "往香港",
    },
    {
        "code": "TML",
        "nameZh": "屯馬綫",
        "nameEn": "Tuen Ma Line",
        "color": "#9A3B26",
        "directions": ["UT"],
        "upLabel": "往屯門",
        "downLabel": "往烏溪沙",
    },
    {
        "code": "TKL",
        "nameZh": "將軍澳綫",
        "nameEn": "Tseung Kwan O Line",
        "color": "#6B208B",
        "directions": ["DT", "TKS-DT"],
        "upLabel": "往寶琳／康城",
        "downLabel": "往北角／調景嶺",
    },
    {
        "code": "EAL",
        "nameZh": "東鐵綫",
        "nameEn": "East Rail Line",
        "color": "#53B7E8",
        "directions": ["DT", "LMC-DT"],
        "upLabel": "往羅湖／落馬洲",
        "downLabel": "往金鐘",
    },
    {
        "code": "SIL",
        "nameZh": "南港島綫",
        "nameEn": "South Island Line",
        "color": "#B5BD00",
        "directions": ["UT"],
        "upLabel": "往海怡半島",
        "downLabel": "往金鐘",
    },
    {
        "code": "TWL",
        "nameZh": "荃灣綫",
        "nameEn": "Tsuen Wan Line",
        "color": "#E2231A",
        "directions": ["UT"],
        "upLabel": "往荃灣",
        "downLabel": "往中環",
    },
    {
        "code": "ISL",
        "nameZh": "港島綫",
        "nameEn": "Island Line",
        "color": "#007DC5",
        "directions": ["UT"],
        "upLabel": "往柴灣",
        "downLabel": "往堅尼地城",
    },
    {
        "code": "KTL",
        "nameZh": "觀塘綫",
        "nameEn": "Kwun Tong Line",
        "color": "#00A040",
        "directions": ["UT"],
        "upLabel": "往調景嶺",
        "downLabel": "往黃埔",
    },
    {
        "code": "DRL",
        "nameZh": "迪士尼綫",
        "nameEn": "Disneyland Resort Line",
        "color": "#F173AC",
        "directions": ["UT"],
        "upLabel": "往欣澳",
        "downLabel": "往迪士尼",
    },
]

# Present in the next-train API, absent from the station-order file.
RACECOURSE = {
    "code": "RAC",
    "nameZh": "馬場",
    "nameEn": "Racecourse",
    "lines": ["EAL"],
}

NAME_ALIASES = {
    "尖東": ["尖沙咀東"],
    "宋皇臺": ["宋皇台"],
    "廸士尼": ["迪士尼"],
}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def station_queries(name: str) -> list[str]:
    variants = [name.replace("茘", "荔")]
    variants.extend(NAME_ALIASES.get(name, []))
    if name not in variants:
        variants.insert(0, name)
    queries: list[str] = []
    for variant in variants:
        for query in (f"港鐵{variant}站", f"港鐵{variant}"):
            if query not in queries:
                queries.append(query)
    return queries


def search_location(query: str) -> list[dict]:
    url = (
        "https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q="
        + urllib.parse.quote(query)
    )
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.loads(response.read().decode("utf-8"))


def acceptable(result: dict, queries: list[str]) -> bool:
    name = result.get("nameZH") or ""
    if name not in queries:
        return False
    if any(token in name for token in ("出入口", "出口", "大堂")):
        return False
    return True


def geocode(name: str, cache: dict) -> tuple[float, float]:
    legacy = name.replace("荔", "茘")
    if name not in cache and legacy in cache:
        cache[name] = cache[legacy]
    if name in cache:
        cached = cache[name]
        return cached["lat"], cached["lng"]

    queries = station_queries(name)
    chosen = None
    matched_query = None
    for query in queries:
        results = search_location(query)
        matches = [item for item in results if acceptable(item, queries)]
        if matches:
            chosen = matches[0]
            matched_query = query
            break
        time.sleep(0.15)

    if chosen is None:
        raise SystemExit(f"找不到車站座標：{name}（試過 {queries}）")

    longitude, latitude = TRANSFORM.transform(chosen["x"], chosen["y"])
    cache[name] = {
        "lat": round(latitude, 6),
        "lng": round(longitude, 6),
        "matched": chosen.get("nameZH"),
        "query": matched_query,
    }
    save_cache(cache)
    time.sleep(0.12)
    return cache[name]["lat"], cache[name]["lng"]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = a
    lat2, lng2 = b
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    hav = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlng / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(hav))


def load_station_rows() -> list[dict]:
    text = fetch(STATION_URL).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def load_camera_rows() -> list[dict]:
    text = fetch(CAMERA_URL).decode("utf-16").lstrip("\ufeff")
    return list(csv.DictReader(io.StringIO(text), delimiter="\t"))


def build_network(rows: list[dict], cache: dict) -> dict:
    stations: dict[str, dict] = {}
    for row in rows:
        code = (row.get("Station Code") or "").strip()
        line = (row.get("Line Code") or "").strip()
        if not code or not line:
            continue
        station = stations.setdefault(
            code,
            {
                "code": code,
                "nameZh": row["Chinese Name"].strip().replace("茘", "荔"),
                "nameEn": row["English Name"].strip(),
                "lines": [],
            },
        )
        if line not in station["lines"]:
            station["lines"].append(line)

    if "RAC" not in stations:
        stations["RAC"] = dict(RACECOURSE)

    for station in stations.values():
        latitude, longitude = geocode(station["nameZh"], cache)
        if not (22.13 <= latitude <= 22.58 and 113.80 <= longitude <= 114.50):
            raise SystemExit(
                f"座標超出香港範圍：{station['nameZh']} {latitude}, {longitude}"
            )
        station["lat"] = latitude
        station["lng"] = longitude

    by_code = {station["code"]: station for station in stations.values()}
    lines = []
    for line in LINES:
        paths = []
        for direction in line["directions"]:
            ordered = [
                row
                for row in rows
                if row.get("Line Code") == line["code"]
                and row.get("Direction") == direction
            ]
            ordered.sort(key=lambda row: float(row["Sequence"]))
            codes = [row["Station Code"].strip() for row in ordered]
            if len(codes) < 2:
                raise SystemExit(f"{line['code']} {direction} 沒有足夠車站")
            for left, right in zip(codes, codes[1:]):
                distance = haversine_km(
                    (by_code[left]["lat"], by_code[left]["lng"]),
                    (by_code[right]["lat"], by_code[right]["lng"]),
                )
                if distance > 22:
                    raise SystemExit(
                        f"{line['code']} {by_code[left]['nameZh']} 至 "
                        f"{by_code[right]['nameZh']} 相距 {distance:.1f} 公里，座標可能有誤"
                    )
            paths.append(codes)
        lines.append(
            {
                "code": line["code"],
                "nameZh": line["nameZh"],
                "nameEn": line["nameEn"],
                "color": line["color"],
                "upLabel": line["upLabel"],
                "downLabel": line["downLabel"],
                "paths": paths,
            }
        )

    order = {line["code"]: index for index, line in enumerate(LINES)}
    station_list = sorted(
        stations.values(),
        key=lambda station: (order[station["lines"][0]], station["nameZh"]),
    )
    return {"lines": lines, "stations": station_list}


# The Transport Department table puts AID10120 several kilometres south of
# Shenzhen Bay Bridge, beside Yuen Long Highway. The camera caption and the
# other six northbound cameras keep it on the bridge, opposite AID10201.
CAMERA_COORDINATE_FIXES = {
    "AID10120": (22.476958, 113.954874),
}


def build_cameras(rows: list[dict]) -> list[dict]:
    cameras = []
    seen = set()
    for row in rows:
        key = row["key"].strip()
        if not key or key in seen:
            raise SystemExit(f"快拍點編號重複或空白：{key}")
        seen.add(key)
        latitude = float(row["latitude"])
        longitude = float(row["longitude"])
        if key in CAMERA_COORDINATE_FIXES:
            latitude, longitude = CAMERA_COORDINATE_FIXES[key]
        if not (22.13 <= latitude <= 22.58 and 113.80 <= longitude <= 114.50):
            raise SystemExit(f"快拍點超出香港範圍：{key}")
        cameras.append(
            {
                "key": key,
                "region": row["region"].strip(),
                "district": row["district"].strip(),
                "description": row["description"].strip(),
                "lat": round(latitude, 6),
                "lng": round(longitude, 6),
            }
        )
    cameras.sort(key=lambda camera: camera["key"])
    return cameras


def main() -> None:
    NETWORK_PATH.parent.mkdir(parents=True, exist_ok=True)
    cache = load_cache()
    network = build_network(load_station_rows(), cache)
    cameras = build_cameras(load_camera_rows())
    NETWORK_PATH.write_text(
        json.dumps(network, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    CAMERAS_PATH.write_text(
        json.dumps(cameras, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"stations {len(network['stations'])}")
    print(f"lines {len(network['lines'])}")
    print(f"cameras {len(cameras)}")


if __name__ == "__main__":
    main()
