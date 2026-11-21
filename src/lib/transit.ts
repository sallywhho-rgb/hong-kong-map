import camerasJson from "@/data/cameras.json"
import networkJson from "@/data/network.json"
import railGeometryJson from "@/data/rail-geometry.json"
import type { LineCode, Network, RailLine, Station, TrafficCamera } from "@/lib/types"

export const network = networkJson as Network
export const lines: RailLine[] = network.lines
export const stations: Station[] = network.stations
export const cameras = camerasJson as TrafficCamera[]

export const stationByCode = new Map(stations.map((station) => [station.code, station]))
export const lineByCode = new Map(lines.map((line) => [line.code, line]))
const lineOrder = new Map(lines.map((line, index) => [line.code, index]))

export function orderedLines(codes: LineCode[]) {
  return [...codes].sort(
    (left, right) => (lineOrder.get(left) ?? 0) - (lineOrder.get(right) ?? 0),
  )
}

export function stationName(code: string) {
  return stationByCode.get(code)?.nameZh ?? code
}

const railTracks = railGeometryJson.lines as Record<LineCode, number[][][]>

export function railGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: lines.flatMap((line) =>
      railTracks[line.code].map((coordinates) => ({
        type: "Feature" as const,
        properties: {
          code: line.code,
          nameZh: line.nameZh,
          color: line.color,
        },
        geometry: {
          type: "LineString" as const,
          coordinates,
        },
      })),
    ),
  }
}

export function stationGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: stations.map((station) => {
      const primary = lineByCode.get(station.lines[0])
      return {
        type: "Feature" as const,
        properties: {
          code: station.code,
          nameZh: station.nameZh,
          nameEn: station.nameEn,
          color: station.lines.length > 1 ? "#14222b" : (primary?.color ?? "#14222b"),
          interchange: station.lines.length > 1 ? 1 : 0,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [station.lng, station.lat],
        },
      }
    }),
  }
}

export function cameraGeoJson() {
  return {
    type: "FeatureCollection" as const,
    features: cameras.map((camera) => ({
      type: "Feature" as const,
      properties: {
        key: camera.key,
        description: camera.description,
        region: camera.region,
        district: camera.district,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [camera.lng, camera.lat],
      },
    })),
  }
}

export function cameraImageUrl(key: string, cacheKey: number) {
  return `https://tdcctv.data.one.gov.hk/${key}.JPG?t=${cacheKey}`
}
