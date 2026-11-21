import railGeometryJson from "@/data/rail-geometry.json"
import { lines, stationByCode } from "@/lib/transit"
import type { LineCode } from "@/lib/types"

type LngLat = [number, number]

export type MeasuredRoute = {
  line: LineCode
  pathIndex: number
  stations: string[]
  stationMeters: number[]
  points: LngLat[]
  legMeters: number[]
  total: number
}

const railTracks = railGeometryJson.lines as Record<LineCode, number[][][]>

function metersBetween(a: LngLat, b: LngLat) {
  const radius = 6_371_000
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)))
}

function projectT(a: LngLat, b: LngLat, target: LngLat) {
  const lat = (((a[1] + b[1]) / 2) * Math.PI) / 180
  const dx = (b[0] - a[0]) * Math.cos(lat)
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return 0
  const tx = (target[0] - a[0]) * Math.cos(lat)
  const ty = target[1] - a[1]
  return Math.min(1, Math.max(0, (tx * dx + ty * dy) / length2))
}

function projectOnto(line: LngLat[], target: LngLat) {
  let best = { dist: Number.POSITIVE_INFINITY, along: 0, point: line[0], seg: 0 }
  let along = 0
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = line[index]
    const end = line[index + 1]
    const segLen = metersBetween(start, end)
    const t = projectT(start, end, target)
    const point: LngLat = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
    const dist = metersBetween(point, target)
    if (dist < best.dist) best = { dist, along: along + segLen * t, point, seg: index }
    along += segLen
  }
  return best
}

function sliceBetween(line: LngLat[], from: ReturnType<typeof projectOnto>, to: ReturnType<typeof projectOnto>) {
  const forward = from.along <= to.along
  const start = forward ? from : to
  const end = forward ? to : from
  const points: LngLat[] = [start.point]
  for (let index = start.seg + 1; index <= end.seg; index += 1) points.push(line[index])
  points.push(end.point)
  if (!forward) points.reverse()
  return points.filter((point, index) => index === 0 || metersBetween(points[index - 1], point) > 1)
}

function segmentFor(line: LineCode, from: LngLat, to: LngLat) {
  const straight = metersBetween(from, to)
  const candidates = railTracks[line]
    .map((track) => track as LngLat[])
    .filter((track) => track.length > 1)
    .map((track) => {
      const start = projectOnto(track, from)
      const end = projectOnto(track, to)
      return {
        track,
        start,
        end,
        score: start.dist + end.dist,
        span: Math.abs(start.along - end.along),
      }
    })
    .sort((left, right) => left.score - right.score)
  const usable = candidates.find((candidate) => candidate.span > Math.max(80, straight * 0.35))
  const chosen = usable ?? candidates[0]
  if (!chosen || chosen.span < 40) return [from, to]
  return sliceBetween(chosen.track, chosen.start, chosen.end)
}

function lengthOf(points: LngLat[]) {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += metersBetween(points[index - 1], points[index])
  return total
}

function buildRoute(line: LineCode, pathIndex: number, stations: string[]): MeasuredRoute | null {
  const located = stations.flatMap((code) => {
    const station = stationByCode.get(code)
    return station ? [[code, [station.lng, station.lat] as LngLat] as const] : []
  })
  if (located.length < 2) return null
  const points: LngLat[] = []
  const stationMeters = [0]
  for (let index = 1; index < located.length; index += 1) {
    const slice = segmentFor(line, located[index - 1][1], located[index][1])
    const addition = points.length > 0 ? slice.slice(1) : slice
    points.push(...addition)
    stationMeters.push(lengthOf(points))
  }
  const legMeters: number[] = []
  for (let index = 1; index < points.length; index += 1) legMeters.push(metersBetween(points[index - 1], points[index]))
  const total = legMeters.reduce((sum, leg) => sum + leg, 0)
  if (total < 100) return null
  return { line, pathIndex, stations: located.map(([code]) => code), stationMeters, points, legMeters, total }
}

export const measuredRoutes: MeasuredRoute[] = lines.flatMap((line) =>
  line.paths.flatMap((path, pathIndex) => {
    const route = buildRoute(line.code, pathIndex, path)
    return route ? [route] : []
  }),
)

export function routeFor(line: LineCode, station: string, destination: string) {
  const matching = measuredRoutes.filter((route) => route.line === line && route.stations.includes(station))
  const withDestination = destination ? matching.filter((route) => route.stations.includes(destination)) : []
  const pool = withDestination.length > 0 ? withDestination : matching
  return (
    pool.sort(
      (left, right) =>
        Math.abs(left.stations.indexOf(destination) - left.stations.indexOf(station)) -
        Math.abs(right.stations.indexOf(destination) - right.stations.indexOf(station)),
    )[0] ?? null
  )
}

export function pointOnRoute(route: MeasuredRoute, along: number, bearingSide = 0) {
  const clamped = Math.max(0, Math.min(route.total, along))
  let covered = 0
  for (let index = 0; index < route.legMeters.length; index += 1) {
    const leg = route.legMeters[index]
    const last = index === route.legMeters.length - 1
    if (covered + leg >= clamped || last) {
      const t = leg === 0 ? 0 : Math.min(1, (clamped - covered) / leg)
      const start = route.points[index]
      const end = route.points[index + 1]
      const lng = start[0] + (end[0] - start[0]) * t
      const lat = start[1] + (end[1] - start[1]) * t
      const bearing = bearingDeg(start, end)
      const shifted = shift(lng, lat, bearing + 90, bearingSide)
      return { ...shifted, bearing }
    }
    covered += leg
  }
  const end = route.points[route.points.length - 1]
  return { lng: end[0], lat: end[1], bearing: 0 }
}

function bearingDeg(a: LngLat, b: LngLat) {
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function shift(lng: number, lat: number, bearing: number, meters: number) {
  const radians = (bearing * Math.PI) / 180
  const north = meters * Math.cos(radians)
  const east = meters * Math.sin(radians)
  return {
    lng: lng + east / (111_320 * Math.cos((lat * Math.PI) / 180)),
    lat: lat + north / 110_540,
  }
}
