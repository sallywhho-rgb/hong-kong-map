import { stationName } from "@/lib/transit"
import type { LineCode, ScheduleView, Train } from "@/lib/types"

const RETRY_MESSAGE = "暫時未能取得班次，請稍後再試。"

type RawTrain = {
  dest?: string
  plat?: string
  ttnt?: string
  time?: string
  valid?: string
  isdelay?: string
  Isdelay?: string
}

type RawSchedule = {
  status?: number
  message?: string
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

function presentTrain(train: RawTrain): Train | null {
  if (train.valid && train.valid !== "Y") return null
  const destinationCode = train.dest?.trim() || ""
  return {
    destination: destinationCode ? stationName(destinationCode) : "未有目的地",
    platform: train.plat?.trim() || "",
    minutes: train.ttnt?.trim() || "",
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
): Promise<ScheduleView | { kind: "error"; message: string }> {
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
    return { kind: "error", message: RETRY_MESSAGE }
  }

  const block = body.data?.[`${line}-${station}`]
  const up = presentList(block?.UP)
  const down = presentList(block?.DOWN)
  return {
    kind: "ready",
    delay: body.isdelay === "Y" || up.some((train) => train.delayed) || down.some((train) => train.delayed),
    updated: block?.curr_time || body.curr_time || "",
    up,
    down,
  }
}
