import { Button } from "@/components/ui/button"
import { fetchSchedule, formatClock, formatMinutes } from "@/lib/schedule"
import { cameraImageUrl, cameras, lineByCode, orderedLines, stationByCode } from "@/lib/transit"
import type { LineCode, ScheduleResult, Selection, Train } from "@/lib/types"
import { useEffect, useState } from "react"

type InspectorProps = {
  selection: Selection | null
  onClose: () => void
  onLineChange: (line: LineCode) => void
}

export function Inspector({ selection, onClose, onLineChange }: InspectorProps) {
  return (
    <aside
      className={
        selection
          ? "pointer-events-auto absolute inset-x-4 bottom-4 z-20 flex max-h-[48%] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white/95 shadow-2xl backdrop-blur lg:inset-x-auto lg:top-4 lg:right-4 lg:bottom-4 lg:w-[380px] lg:max-h-none"
          : "pointer-events-auto absolute inset-x-4 bottom-4 z-20 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-xl backdrop-blur lg:inset-x-auto lg:top-4 lg:right-4 lg:bottom-auto lg:w-[380px]"
      }
    >
      {selection?.kind === "station" ? (
        <StationCard
          code={selection.code}
          line={selection.line}
          onClose={onClose}
          onLineChange={onLineChange}
        />
      ) : null}
      {selection?.kind === "camera" ? (
        <CameraCard key={selection.key} cameraKey={selection.key} onClose={onClose} />
      ) : null}
      {selection ? null : (
        <div>
          <h2 className="text-base font-semibold text-stone-900">從地圖開始</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            點選車站查看到站班次，點選橙色快拍點查看該處最新照片。縮小地圖時，快拍點會合成一組，點組別可以放大。
          </p>
        </div>
      )}
    </aside>
  )
}

function CardHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string
  subtitle?: string
  onClose: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
      <div>
        <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
        {subtitle ? <p className="text-sm text-stone-500">{subtitle}</p> : null}
      </div>
      <Button variant="ghost" size="sm" onClick={onClose}>
        關閉
      </Button>
    </div>
  )
}

function StationCard({
  code,
  line,
  onClose,
  onLineChange,
}: {
  code: string
  line: LineCode
  onClose: () => void
  onLineChange: (line: LineCode) => void
}) {
  const station = stationByCode.get(code)
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${code}:${line}:${attempt}`
  const [loadedKey, setLoadedKey] = useState(requestKey)
  const [result, setResult] = useState<ScheduleResult>({ kind: "loading" })
  if (loadedKey !== requestKey) {
    setLoadedKey(requestKey)
    setResult({ kind: "loading" })
  }

  useEffect(() => {
    const controller = new AbortController()
    void fetchSchedule(line, code, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setResult(next)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        setResult({ kind: "error", message: "暫時未能取得班次，請稍後再試。" })
      })
    return () => controller.abort()
  }, [code, line, attempt])

  if (!station) {
    return (
      <div className="p-4">
        <p>找不到這個車站。</p>
        <Button className="mt-3" variant="outline" onClick={onClose}>
          關閉
        </Button>
      </div>
    )
  }

  const lineChoices = orderedLines(station.lines)
  const activeLine = lineByCode.get(line)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader title={station.nameZh} subtitle={station.nameEn} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {lineChoices.map((choice) => {
            const info = lineByCode.get(choice)
            const selected = choice === line
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={selected}
                onClick={() => onLineChange(choice)}
                className="rounded-full px-3 py-1 text-sm text-white"
                style={{
                  background: info?.color ?? "#444",
                  outline: selected ? "2px solid #1c1917" : "none",
                  outlineOffset: selected ? "2px" : "0",
                }}
              >
                {info?.nameZh ?? choice}
              </button>
            )
          })}
        </div>
        {lineChoices.length > 1 ? (
          <p className="mt-3 text-xs text-stone-500">轉車站可以切換路綫，再看該綫的到站班次。</p>
        ) : null}

        <div className="mt-4" role="status">
          {result.kind === "loading" ? <p className="text-sm text-stone-600">正在讀取到站班次…</p> : null}
          {result.kind === "error" ? (
            <div className="rounded-xl bg-stone-100 px-3 py-3">
              <p className="text-sm text-stone-800">{result.message}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                再試一次
              </Button>
            </div>
          ) : null}
          {result.kind === "ready" ? (
            <ScheduleBody
              result={result}
              upLabel={activeLine?.upLabel ?? "上行"}
              downLabel={activeLine?.downLabel ?? "下行"}
              racecourse={station.code === "RAC"}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ScheduleBody({
  result,
  upLabel,
  downLabel,
  racecourse,
}: {
  result: Extract<ScheduleResult, { kind: "ready" }>
  upLabel: string
  downLabel: string
  racecourse: boolean
}) {
  const none = result.up.length === 0 && result.down.length === 0
  const updated = formatClock(result.updated)
  return (
    <div className="space-y-3">
      {result.delay ? (
        <p className="rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-950">港鐵表示服務有延誤。</p>
      ) : null}
      {none ? (
        <div className="rounded-xl bg-stone-100 px-3 py-3 text-sm leading-6 text-stone-800">
          <p className="font-medium">暫無到站班次</p>
          {racecourse ? <p className="mt-1">馬場站在非賽馬日通常沒有班次。</p> : null}
        </div>
      ) : (
        <>
          <DirectionBlock label={upLabel} trains={result.up} />
          <DirectionBlock label={downLabel} trains={result.down} />
        </>
      )}
      {updated ? <p className="text-xs text-stone-500">資料時間 {updated}</p> : null}
    </div>
  )
}

function DirectionBlock({ label, trains }: { label: string; trains: Train[] }) {
  return (
    <section className="rounded-xl border border-stone-200 px-3 py-2">
      <h3 className="text-sm font-medium text-stone-800">{label}</h3>
      {trains.length === 0 ? (
        <p className="mt-1 text-sm text-stone-500">這個方向沒有班次</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {trains.map((train, index) => (
            <li key={`${train.destination}-${train.time}-${index}`} className="text-sm text-stone-800">
              <span className="font-semibold">{formatMinutes(train.minutes)}</span>
              <span className="text-stone-600">
                {" "}
                · 往{train.destination}
                {train.platform ? ` · 月台 ${train.platform}` : ""}
                {formatClock(train.time) ? ` · ${formatClock(train.time)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const cameraIndex = new Map(cameras.map((camera) => [camera.key, camera]))

function CameraCard({ cameraKey, onClose }: { cameraKey: string; onClose: () => void }) {
  const camera = cameraIndex.get(cameraKey)
  const [cacheKey, setCacheKey] = useState(() => Math.floor(Date.now() / 120_000))
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading")

  if (!camera) {
    return (
      <div className="p-4">
        <p>找不到這個快拍點。</p>
        <Button className="mt-3" variant="outline" onClick={onClose}>
          關閉
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader title={camera.description} subtitle={`${camera.region} · ${camera.district}`} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {phase === "error" ? (
          <div className="rounded-xl bg-stone-100 px-3 py-3" role="status">
            <p className="text-sm font-medium text-stone-800">暫無最新照片</p>
            <p className="mt-1 text-sm text-stone-600">這個位置暫時未能顯示快拍圖片。</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-stone-900">
            {phase === "loading" ? <p className="px-3 py-2 text-sm text-stone-200">正在載入照片…</p> : null}
            <img
              src={cameraImageUrl(camera.key, cacheKey)}
              alt={`${camera.description}的交通快拍`}
              className="aspect-[4/3] w-full object-contain"
              onLoad={() => setPhase("ready")}
              onError={() => setPhase("error")}
            />
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-stone-500">
          照片約每兩分鐘更新。若圖片上寫著「暫時未能提供服務」，表示這個位置暫時沒有新照片。
        </p>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => {
            setPhase("loading")
            setCacheKey(Date.now())
          }}
        >
          重新載入
        </Button>
      </div>
    </div>
  )
}
