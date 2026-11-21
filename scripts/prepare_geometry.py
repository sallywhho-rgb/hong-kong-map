"""Build curved rail shapes from OpenStreetMap route tracks.

The map used to connect each station with a straight segment. This script
downloads the MTR route relations, follows the actual track between the
stations in each line's running order, and writes those curves into
src/data/rail-geometry.json. Shared stretches are drawn once. The racecourse
spur is added only where it leaves the East Rail through-tracks.
"""

from __future__ import annotations

import heapq
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NETWORK_PATH = ROOT / "src" / "data" / "network.json"
OUTPUT_PATH = ROOT / "src" / "data" / "rail-geometry.json"

USER_AGENT = "hk-smart-city-map/0.1 (classroom project; rail geometry)"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
CACHE_PATH = ROOT / "scripts" / "osm-mtr-routes.json"

# One direction is enough. Branch relations are included so the graph
# contains the Lo Wu, Lok Ma Chau, LOHAS Park, and similar diverging tracks.
RELATIONS = {
    "AEL": [5317238],
    "TCL": [5317704],
    "TML": [6102298],
    "TKL": [269672, 9736602],
    "EAL": [4248590, 4248589],
    "SIL": [6827211],
    "TWL": [269669],
    "ISL": [4432665],
    "KTL": [272125],
    "DRL": [4709540],
}
RACECOURSE_RELATION = 6587848

NODE_TOLERANCE_M = 35
STATION_SNAP_M = 700
DUPLICATE_M = 55
SIMPLIFY_M = 8

ORIGIN_LON = 114.1
ORIGIN_LAT = 22.35
METERS_PER_LON = 111320 * math.cos(math.radians(ORIGIN_LAT))
METERS_PER_LAT = 110540


def xy(lon: float, lat: float) -> tuple[float, float]:
    return ((lon - ORIGIN_LON) * METERS_PER_LON, (lat - ORIGIN_LAT) * METERS_PER_LAT)


def lonlat(point: tuple[float, float]) -> list[float]:
    x, y = point
    return [
        round(ORIGIN_LON + x / METERS_PER_LON, 6),
        round(ORIGIN_LAT + y / METERS_PER_LAT, 6),
    ]


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def point_segment_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return dist(point, start)
    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_sq
    t = max(0.0, min(1.0, t))
    return dist(point, (start[0] + t * dx, start[1] + t * dy))


def distance_to_line(point: tuple[float, float], line: list[tuple[float, float]]) -> float:
    return min(
        point_segment_distance(point, line[index], line[index + 1])
        for index in range(len(line) - 1)
    )


def length_of(line: list[tuple[float, float]]) -> float:
    return sum(dist(line[index], line[index + 1]) for index in range(len(line) - 1))


def fetch_relations(ids: list[int]) -> dict[int, dict]:
    if CACHE_PATH.exists():
        cached = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        found = {element["id"]: element for element in cached.get("elements", [])}
        if all(relation_id in found for relation_id in ids):
            print("使用已下載的路軌資料")
            return found

    id_list = ",".join(str(relation_id) for relation_id in ids)
    query = f"[out:json][timeout:120];relation(id:{id_list});out geom;"
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error: Exception | None = None
    for url in OVERPASS_URLS:
        request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except Exception as error:  # noqa: BLE001 — try the next Overpass server
            last_error = error
            print(f"{url} 未能下載：{error}")
    else:
        raise SystemExit(f"無法下載路軌：{last_error}")
    CACHE_PATH.write_text(json.dumps(payload), encoding="utf-8")
    return {element["id"]: element for element in payload["elements"]}


def track_segments(relation: dict) -> list[list[tuple[float, float]]]:
    segments: list[list[tuple[float, float]]] = []
    for member in relation.get("members", []):
        if member.get("type") != "way" or member.get("role"):
            continue
        geometry = member.get("geometry") or []
        if len(geometry) < 2:
            continue
        segments.append([xy(point["lon"], point["lat"]) for point in geometry])
    return segments


class TrackGraph:
    def __init__(self, segments: list[list[tuple[float, float]]]) -> None:
        self.nodes: list[tuple[float, float]] = []
        self.edges: list[dict] = []
        self.adjacent: list[list[int]] = []
        self._live: set[int] = set()
        for segment in segments:
            start = self._node(segment[0])
            end = self._node(segment[-1])
            if start == end:
                continue
            middle = segment[1:-1]
            coords = [self.nodes[start], *middle, self.nodes[end]]
            self._add_edge(start, end, coords)

    def _node(self, point: tuple[float, float]) -> int:
        for index, existing in enumerate(self.nodes):
            if dist(point, existing) <= NODE_TOLERANCE_M:
                return index
        self.nodes.append(point)
        self.adjacent.append([])
        return len(self.nodes) - 1

    def attach(self, point: tuple[float, float], limit: float) -> int | None:
        """Split the nearest track at this station so routing can start there."""
        best: tuple[float, int, int, tuple[float, float]] | None = None
        for edge_id, edge in enumerate(self.edges):
            if edge_id not in self._live:
                continue
            coords = edge["coords"]
            for index in range(len(coords) - 1):
                gap = point_segment_distance(point, coords[index], coords[index + 1])
                if best is not None and gap >= best[0]:
                    continue
                dx = coords[index + 1][0] - coords[index][0]
                dy = coords[index + 1][1] - coords[index][1]
                length_sq = dx * dx + dy * dy
                if length_sq == 0:
                    proj = coords[index]
                else:
                    t = ((point[0] - coords[index][0]) * dx + (point[1] - coords[index][1]) * dy) / length_sq
                    t = max(0.0, min(1.0, t))
                    proj = (coords[index][0] + t * dx, coords[index][1] + t * dy)
                best = (gap, edge_id, index, proj)
        if best is None or best[0] > limit:
            return None
        _gap, edge_id, index, proj = best
        edge = self.edges[edge_id]
        if dist(proj, edge["coords"][0]) <= 20:
            return edge["u"]
        if dist(proj, edge["coords"][-1]) <= 20:
            return edge["v"]
        node_id = len(self.nodes)
        self.nodes.append(proj)
        self.adjacent.append([])
        left = edge["coords"][: index + 1] + [proj]
        right = [proj, *edge["coords"][index + 1 :]]
        self._retire(edge_id)
        self._add_edge(edge["u"], node_id, left)
        self._add_edge(node_id, edge["v"], right)
        return node_id

    def _add_edge(self, start: int, end: int, coords: list[tuple[float, float]]) -> None:
        edge_id = len(self.edges)
        self.edges.append(
            {"u": start, "v": end, "length": length_of(coords), "coords": coords}
        )
        self._live.add(edge_id)
        self.adjacent[start].append(edge_id)
        self.adjacent[end].append(edge_id)

    def _retire(self, edge_id: int) -> None:
        edge = self.edges[edge_id]
        self._live.discard(edge_id)
        self.adjacent[edge["u"]] = [item for item in self.adjacent[edge["u"]] if item != edge_id]
        self.adjacent[edge["v"]] = [item for item in self.adjacent[edge["v"]] if item != edge_id]

    def route_nodes(self, source: int, target: int) -> list[tuple[float, float]] | None:
        if source == target:
            return [self.nodes[source]]
        best = [math.inf] * len(self.nodes)
        previous_edge = [-1] * len(self.nodes)
        best[source] = 0.0
        queue = [(0.0, source)]
        while queue:
            travelled, node = heapq.heappop(queue)
            if travelled != best[node]:
                continue
            if node == target:
                break
            for edge_id in self.adjacent[node]:
                if edge_id not in self._live:
                    continue
                edge = self.edges[edge_id]
                other = edge["v"] if edge["u"] == node else edge["u"]
                proposed = travelled + edge["length"]
                if proposed < best[other]:
                    best[other] = proposed
                    previous_edge[other] = edge_id
                    heapq.heappush(queue, (proposed, other))
        if previous_edge[target] < 0:
            return None
        pieces: list[list[tuple[float, float]]] = []
        cursor = target
        while cursor != source:
            edge_id = previous_edge[cursor]
            edge = self.edges[edge_id]
            coords = edge["coords"]
            if edge["v"] != cursor:
                coords = list(reversed(coords))
            pieces.append(coords)
            cursor = edge["u"] if edge["v"] == cursor else edge["v"]
        pieces.reverse()
        line: list[tuple[float, float]] = []
        for piece in pieces:
            line.extend(piece if not line else piece[1:])
        return line


def simplify(
    line: list[tuple[float, float]], epsilon: float
) -> list[tuple[float, float]]:
    if len(line) < 3:
        return line
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        start, end = stack.pop()
        worst = 0.0
        pivot = None
        for index in range(start + 1, end):
            gap = point_segment_distance(line[index], line[start], line[end])
            if gap > worst:
                worst = gap
                pivot = index
        if pivot is not None and worst > epsilon:
            keep[pivot] = True
            stack.append((start, pivot))
            stack.append((pivot, end))
    return [point for point, selected in zip(line, keep) if selected]


def trim_out_and_back(line: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Keep a spur that runs out along a track and returns on the same rails."""
    if len(line) < 4 or dist(line[0], line[-1]) > 40:
        return line
    farthest = max(range(len(line)), key=lambda index: dist(line[0], line[index]))
    if farthest in (0, len(line) - 1):
        return line
    return line[: farthest + 1]


def novel_pieces(
    line: list[tuple[float, float]], drawn: list[list[tuple[float, float]]]
) -> list[list[tuple[float, float]]]:
    if len(line) < 2:
        return []
    if not drawn:
        return [line]

    def already_drawn(point: tuple[float, float]) -> bool:
        return any(distance_to_line(point, existing) <= DUPLICATE_M for existing in drawn)

    pieces: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for index, point in enumerate(line):
        if already_drawn(point):
            if current:
                current.append(point)
                if len(current) >= 2 and length_of(current) > 80:
                    pieces.append(current)
                current = []
        else:
            if not current and index > 0:
                current.append(line[index - 1])
            current.append(point)
    if len(current) >= 2 and length_of(current) > 80:
        pieces.append(current)
    return pieces


def route_path(
    graph: TrackGraph,
    codes: list[str],
    stations: dict[str, tuple[float, float]],
    label: str,
) -> list[tuple[float, float]]:
    anchors: list[int] = []
    for code in codes:
        node = graph.attach(stations[code], STATION_SNAP_M)
        if node is None:
            raise SystemExit(f"{label} 車站 {code} 找不到附近路軌")
        anchors.append(node)
    routed: list[tuple[float, float]] = []
    for origin, destination, source, target in zip(codes, codes[1:], anchors, anchors[1:]):
        hop = graph.route_nodes(source, target)
        if hop is None or len(hop) < 2:
            raise SystemExit(f"{label} 無法沿路軌連接 {origin} 至 {destination}")
        straight = dist(stations[origin], stations[destination])
        travelled = length_of(hop)
        if travelled > max(straight * 3.2, straight + 6000):
            raise SystemExit(
                f"{label} {origin}->{destination} 繞路過長：直線 {straight:.0f} 米，路軌 {travelled:.0f} 米"
            )
        routed.extend(hop if not routed else hop[1:])
    return routed


def main() -> None:
    network = json.loads(NETWORK_PATH.read_text(encoding="utf-8"))
    stations = {
        station["code"]: xy(station["lng"], station["lat"])
        for station in network["stations"]
    }
    relation_ids = sorted({RACECOURSE_RELATION, *[i for ids in RELATIONS.values() for i in ids]})
    print(f"下載 {len(relation_ids)} 條路軌關係…")
    relations = fetch_relations(relation_ids)
    missing = [relation_id for relation_id in relation_ids if relation_id not in relations]
    if missing:
        raise SystemExit(f"缺少路軌關係：{missing}")

    output_lines: dict[str, list[list[list[float]]]] = {}
    for line in network["lines"]:
        code = line["code"]
        segments = [
            segment
            for relation_id in RELATIONS[code]
            for segment in track_segments(relations[relation_id])
        ]
        graph = TrackGraph(segments)
        drawn: list[list[tuple[float, float]]] = []
        stored: list[list[list[float]]] = []
        for path in line["paths"]:
            routed = route_path(graph, path, stations, code)
            for piece in novel_pieces(routed, drawn):
                simplified = trim_out_and_back(simplify(piece, SIMPLIFY_M))
                drawn.append(piece)
                stored.append([lonlat(point) for point in simplified])
        if code == "EAL":
            spur_graph = TrackGraph(
                segments + track_segments(relations[RACECOURSE_RELATION])
            )
            spur = route_path(spur_graph, ["SHT", "RAC", "UNI"], stations, "EAL 馬場")
            for piece in novel_pieces(spur, drawn):
                simplified = trim_out_and_back(simplify(piece, SIMPLIFY_M))
                drawn.append(piece)
                stored.append([lonlat(point) for point in simplified])
        if not stored:
            raise SystemExit(f"{code} 沒有畫出路軌")
        output_lines[code] = stored

        drawn_for_check = [
            [xy(lon, lat) for lon, lat in piece] for piece in stored
        ]
        expected = {station for path in line["paths"] for station in path}
        if code == "EAL":
            expected.add("RAC")
        worst_name = ""
        worst_gap = 0.0
        for station_code in expected:
            gap = min(distance_to_line(stations[station_code], piece) for piece in drawn_for_check)
            if gap > worst_gap:
                worst_gap = gap
                worst_name = station_code
            if gap > 450:
                raise SystemExit(f"{code} 車站 {station_code} 距離路軌 {gap:.0f} 米")
        kilometres = sum(length_of([xy(lon, lat) for lon, lat in piece]) for piece in stored) / 1000
        print(f"{code}: {len(stored)} 段，{kilometres:.1f} 公里，最遠車站 {worst_name} {worst_gap:.0f} 米")

    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "source": "OpenStreetMap route relations, © OpenStreetMap contributors, ODbL",
                "lines": output_lines,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"已寫入 {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
