import { fetchSchedule, scheduleClock, secondsUntil } from "@/lib/schedule"
import { measuredRoutes, pointOnRoute, routeFor, type MeasuredRoute } from "@/lib/track"
import { lineByCode } from "@/lib/transit"
import type { LineCode, ScheduleView, Train } from "@/lib/types"

const APPROACH_MPS = 8.5
const MIN_MPS = 12
const MAX_MPS = 22
const REFRESH_MS = 20_000

export type TrainFrame = {
  geojson: {
    type: "FeatureCollection"
    features: Array<{
      type: "Feature"
      properties: { color: string; bearing: number; title: string; line: string }
      geometry: { type: "Point"; coordinates: [number, number] }
    }>
  }
  count: number
  note: string
}

type Target = {
  route: MeasuredRoute
  along: number
  stationAlong: number
  etaSec: number
  destName: string
  travelSign: number
}

type Marker = {
  route: MeasuredRoute
  along: number
  stationAlong: number
  velocity: number
  destName: string
  travelSign: number
}

const jobs = [
  ...new Map(
    measuredRoutes.flatMap((route) => route.stations.map((station) => [`${route.line}:${station}`, { line: route.line, station }])),
  ).values(),
]

export function startTrainMotion(update: (frame: TrainFrame) => void) {
  const controller = new AbortController()
  let markers: Marker[] = []
  let last = performance.now()
  let frame = 0
  let stopped = false
  let note = "正在沿路軌估計列車位置…"

  const publish = () => {
    update({
      geojson: {
        type: "FeatureCollection",
        features: markers.flatMap((marker) => {
          const spot = pointOnRoute(marker.route, marker.along, marker.travelSign > 0 ? 14 : -14)
          const line = lineByCode.get(marker.route.line)
          if (!line) return []
          return [
            {
              type: "Feature" as const,
              properties: {
                color: line.color,
                bearing: spot.bearing,
                title: `往${marker.destName}`,
                line: line.nameZh,
              },
              geometry: { type: "Point" as const, coordinates: [spot.lng, spot.lat] },
            },
          ]
        }),
      },
      count: markers.length,
      note,
    })
  }

  const tick = (now: number) => {
    if (stopped) return
    const dt = Math.min(0.25, (now - last) / 1000)
    last = now
    for (const marker of markers) {
      const remaining = marker.stationAlong - marker.along
      if (Math.abs(remaining) < 0.5) continue
      const step = Math.min(Math.abs(marker.velocity) * dt, Math.abs(remaining))
      marker.along += Math.sign(remaining) * step
    }
    publish()
    frame = requestAnimationFrame(tick)
  }

  const run = async () => {
    while (!stopped) {
      const targets = await collectTargets(controller.signal)
      if (stopped) return
      if (targets === null) {
        note = markers.length > 0 ? `沿路軌估計 ${markers.length} 班車` : "暫時未能估計列車位置"
      } else {
        markers = reconcile(markers, targets)
        note = markers.length > 0 ? `沿路軌估計 ${markers.length} 班車` : "現時沒有到站班次，路軌上沒有列車"
        publish()
      }
      await sleep(REFRESH_MS, controller.signal)
    }
  }

  frame = requestAnimationFrame(tick)
  void run()
  publish()
  return () => {
    stopped = true
    controller.abort()
    cancelAnimationFrame(frame)
  }
}

async function collectTargets(signal: AbortSignal) {
  const queue = [...jobs]
  const schedules = new Map<string, ScheduleView>()
  let failures = 0
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length > 0 && !signal.aborted) {
      const job = queue.shift()
      if (!job) return
      try {
        const result = await fetchSchedule(job.line, job.station, signal)
        if (result.kind === "ready") schedules.set(`${job.line}:${job.station}`, result)
        else failures += 1
      } catch (error) {
        if (signal.aborted) return
        failures += 1
        console.error(error)
      }
    }
  })
  await Promise.all(workers)
  if (signal.aborted) return null
  if (schedules.size === 0 && failures > 0) return null
  return placeTargets(schedules, Date.now())
}

function placeTargets(schedules: Map<string, ScheduleView>, now: number) {
  const targets: Target[] = []
  for (const [key, schedule] of schedules) {
    const [line, station] = key.split(":") as [LineCode, string]
    const clock = scheduleClock(schedule, now)
    pushDirection(targets, line, station, schedule.up, clock)
    pushDirection(targets, line, station, schedule.down, clock)
  }
  return dedupe(targets)
}

function pushDirection(targets: Target[], line: LineCode, station: string, trains: Train[], clock: number) {
  const train = trains.find((item) => {
    const eta = secondsUntil(item.time, clock)
    return eta != null && eta >= 20 && item.destinationCode
  })
  if (!train) return
  const eta = secondsUntil(train.time, clock)
  if (eta == null) return
  const route = routeFor(line, station, train.destinationCode)
  if (!route) return
  const stationIndex = route.stations.indexOf(station)
  const destinationIndex = route.stations.indexOf(train.destinationCode)
  if (stationIndex < 0) return
  const travelSign = destinationIndex > stationIndex ? 1 : destinationIndex < stationIndex ? -1 : stationIndex === 0 ? 1 : -1
  const stationAlong = route.stationMeters[stationIndex] ?? 0
  const previousIndex = stationIndex - travelSign
  const previousAlong =
    previousIndex >= 0 && previousIndex < route.stationMeters.length ? route.stationMeters[previousIndex] : stationAlong
  const segment = Math.abs(stationAlong - previousAlong)
  const back = Math.min(Math.max(eta, 0) * APPROACH_MPS, segment > 0 ? segment * 0.92 : 30)
  targets.push({
    route,
    along: stationAlong - travelSign * back,
    stationAlong,
    etaSec: Math.max(eta, 0),
    destName: train.destination,
    travelSign,
  })
}

function dedupe(targets: Target[]) {
  const kept: Target[] = []
  for (const target of [...targets].sort((left, right) => left.etaSec - right.etaSec)) {
    const sameTrain = kept.some(
      (existing) =>
        existing.route === target.route &&
        existing.destName === target.destName &&
        Math.abs(existing.along - target.along) < 1200,
    )
    if (!sameTrain) kept.push(target)
  }
  return kept
}

function reconcile(markers: Marker[], targets: Target[]) {
  const unused = [...markers]
  return targets.map((target) => {
    let best = -1
    let bestDistance = 1500
    unused.forEach((marker, index) => {
      if (marker.route !== target.route || marker.destName !== target.destName) return
      const distance = Math.abs(marker.along - target.along)
      if (distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    })
    if (best >= 0) {
      const marker = unused.splice(best, 1)[0]
      const gap = target.along - marker.along
      marker.along += Math.abs(gap) > 1500 ? gap : gap * 0.4
      marker.stationAlong = target.stationAlong
      marker.velocity = approachSpeed(marker.stationAlong - marker.along, target.etaSec)
      marker.travelSign = target.travelSign
      return marker
    }
    return {
      route: target.route,
      along: target.along,
      stationAlong: target.stationAlong,
      velocity: approachSpeed(target.stationAlong - target.along, target.etaSec),
      destName: target.destName,
      travelSign: target.travelSign,
    }
  })
}

function approachSpeed(distance: number, etaSec: number) {
  const needed = distance / Math.max(etaSec, 12)
  const magnitude = Math.abs(distance) > 50 ? Math.max(Math.abs(needed), MIN_MPS) : Math.abs(needed)
  return clamp(magnitude, 0, MAX_MPS) * Math.sign(distance)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
