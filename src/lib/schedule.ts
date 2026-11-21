import { stationName } from "@/lib/transit"
import type { LineCode, ScheduleResult, Train } from "@/lib/types"

const RETRY_MESSAGE = "暫時未能取得班次，請稍後再試。"
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000

type RawTrain = {
  dest?: string
  plat?: string
  time?: string
  valid?: string
  isdelay?: string
  Isdelay?: string
}

type RawSchedule = {
  status?: number
  message?: string
  url?: string
  isdelay?: string
  curr_time?: string
  data?: Record<
    string,
    {
      UP?: RawTrain[]
      DOWN?: RawTrain[]
      curr_time?: string
    }
  >
}

export function parseHongKong(timestamp: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(timestamp.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const parsed = new Date(asUtc)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return null
  }
  return asUtc - HONG_KONG_OFFSET_MS
}

function latestClock(values: Array<string | undefined>) {
  let best: number | null = null
  for (const value of values) {
    const parsed = parseHongKong(value ?? "")
    if (parsed != null && (best == null || parsed > best)) best = parsed
  }
  return best
}

export function scheduleClock(view: { serverNowMs: number | null; fetchedAt: number }, now: number) {
  if (view.serverNowMs == null) return now
  return view.serverNowMs + (now - view.fetchedAt)
}

export function minutesUntil(arrival: string, currentMs: number) {
  const arrivalMs = parseHongKong(arrival)
  if (arrivalMs == null) return ""
  const minutes = Math.round((arrivalMs - currentMs) / 60_000)
  return minutes <= 0 ? "0" : String(minutes)
}

function alertHref(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString()
  } catch {
    return undefined
  }
  return undefined
}

function presentTrain(train: RawTrain): Train | null {
  if (train.valid && train.valid !== "Y") return null
  const destinationCode = train.dest?.trim() || ""
  return {
    destination: destinationCode ? stationName(destinationCode) : "未有目的地",
    platform: train.plat?.trim() || "",
    time: train.time?.trim() || "",
    delayed: train.isdelay === "Y" || train.Isdelay === "Y",
  }
}

function presentList(trains: RawTrain[] | undefined) {
  return (trains ?? []).flatMap((train) => {
    const presented = presentTrain(train)
    return presented ? [presented] : []
  })
}

export function formatMinutes(minutes: string) {
  if (minutes === "0") return "即將開出"
  if (!minutes) return "時間未明"
  return `${minutes} 分鐘`
}

export function formatClock(timestamp: string) {
  const match = timestamp.match(/(\d{2}:\d{2})/)
  return match?.[1] ?? ""
}

export async function fetchSchedule(
  line: LineCode,
  station: string,
  signal: AbortSignal,
): Promise<Exclude<ScheduleResult, { kind: "loading" }>> {
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${station}&lang=TC`
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (signal.aborted) throw error
    return { kind: "error", message: RETRY_MESSAGE }
  }

  if (response.status === 429 || !response.ok) {
    return { kind: "error", message: RETRY_MESSAGE }
  }

  let body: RawSchedule
  try {
    body = (await response.json()) as RawSchedule
  } catch {
    return { kind: "error", message: RETRY_MESSAGE }
  }

  if (body.status !== 1) {
    const message = body.message?.trim() ?? ""
    if (message && message.toLowerCase() !== "successful") {
      const href = alertHref(body.url)
      return href ? { kind: "error", message, href } : { kind: "error", message }
    }
    return { kind: "error", message: RETRY_MESSAGE }
  }

  const block = body.data?.[`${line}-${station}`]
  const up = presentList(block?.UP)
  const down = presentList(block?.DOWN)
  return {
    kind: "ready",
    delay: body.isdelay === "Y" || up.some((train) => train.delayed) || down.some((train) => train.delayed),
    updated: block?.curr_time || body.curr_time || "",
    serverNowMs: latestClock([block?.curr_time, body.curr_time]),
    fetchedAt: Date.now(),
    up,
    down,
  }
}
