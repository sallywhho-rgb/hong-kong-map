import { Inspector } from "@/components/Inspector"
import { MapView } from "@/components/MapView"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cameras, lineByCode, orderedLines, stationByCode, stations } from "@/lib/transit"
import type { LineCode, MapFocus, Selection } from "@/lib/types"
import { useMemo, useState } from "react"

const cameraByKey = new Map(cameras.map((camera) => [camera.key, camera]))

export default function App() {
  const [showMtr, setShowMtr] = useState(true)
  const [showCameras, setShowCameras] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [query, setQuery] = useState("")

  const results = useMemo(() => searchPlaces(query), [query])

  function reveal(lng: number, lat: number, zoom: number) {
    setFocus({ nonce: Date.now(), lng, lat, zoom })
  }

  function chooseStation(code: string) {
    const station = stationByCode.get(code)
    if (!station) return
    const line = orderedLines(station.lines)[0]
    setShowMtr(true)
    setSelection({ kind: "station", code, line })
    reveal(station.lng, station.lat, 14.5)
    setQuery("")
  }

  function chooseCamera(key: string) {
    const camera = cameraByKey.get(key)
    if (!camera) return
    setShowCameras(true)
    setSelection({ kind: "camera", key })
    reveal(camera.lng, camera.lat, 15)
    setQuery("")
  }

  return (
    <main className="relative h-full">
      <MapView
        showMtr={showMtr}
        showCameras={showCameras}
        selection={selection}
        focus={focus}
        onSelectStation={chooseStation}
        onSelectCamera={chooseCamera}
      />

      <header className="pointer-events-auto absolute top-4 left-4 z-30 w-[min(24rem,calc(100%-6.5rem))] rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-xl backdrop-blur">
        <p className="text-xs tracking-wide text-stone-500">香港</p>
        <h1 className="text-xl font-semibold text-stone-950">智慧城市地圖</h1>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          點選車站查看到站班次，點選快拍點查看最新照片。
        </p>

        <div className="relative mt-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋車站或快拍地點"
            aria-label="搜尋車站或快拍地點"
          />
          {query.trim() ? (
            <div className="absolute top-12 right-0 left-0 z-40 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
              {results.stations.length === 0 && results.cameras.length === 0 ? (
                <p className="px-3 py-3 text-sm text-stone-500">找不到符合的地點</p>
              ) : null}
              {results.stations.map((station) => (
                <button
                  key={station.code}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stone-50"
                  onClick={() => chooseStation(station.code)}
                >
                  <span>
                    <span className="font-medium">{station.nameZh}</span>
                    <span className="ml-2 text-stone-500">{station.nameEn}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {orderedLines(station.lines).map((code) => (
                      <span
                        key={code}
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: lineByCode.get(code)?.color }}
                        title={lineByCode.get(code)?.nameZh}
                      />
                    ))}
                  </span>
                </button>
              ))}
              {results.cameras.map((camera) => (
                <button
                  key={camera.key}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-50"
                  onClick={() => chooseCamera(camera.key)}
                >
                  <span className="font-medium text-orange-800">快拍</span>
                  <span className="ml-2">{camera.description}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={showMtr ? "default" : "outline"}
            aria-pressed={showMtr}
            onClick={() => setShowMtr((value) => !value)}
          >
            港鐵網絡
          </Button>
          <Button
            size="sm"
            variant={showCameras ? "default" : "outline"}
            aria-pressed={showCameras}
            onClick={() => setShowCameras((value) => !value)}
          >
            交通快拍
          </Button>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-stone-600">港鐵綫顏色</summary>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {[...lineByCode.values()].map((line) => (
              <li key={line.code} className="flex items-center gap-2 text-xs text-stone-700">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: line.color }} />
                {line.nameZh}
              </li>
            ))}
          </ul>
        </details>
        <p className="mt-3 text-[11px] leading-4 text-stone-500">
          底圖 OpenFreeMap © OpenMapTiles。路軌形狀與底圖資料來自 OpenStreetMap。到站班次由港鐵提供，快拍由運輸署提供。
        </p>
      </header>

      <Inspector
        selection={selection}
        onClose={() => setSelection(null)}
        onLineChange={(line: LineCode) => {
          setSelection((current) => (current?.kind === "station" ? { ...current, line } : current))
        }}
      />
    </main>
  )
}

function searchPlaces(query: string) {
  const text = query.trim().toLowerCase()
  if (!text) return { stations: [], cameras: [] }
  return {
    stations: stations
      .filter(
        (station) =>
          station.nameZh.toLowerCase().includes(text) ||
          station.nameEn.toLowerCase().includes(text) ||
          station.code.toLowerCase().includes(text),
      )
      .slice(0, 6),
    cameras: cameras
      .filter(
        (camera) =>
          camera.description.toLowerCase().includes(text) ||
          camera.district.toLowerCase().includes(text) ||
          camera.region.toLowerCase().includes(text) ||
          camera.key.toLowerCase().includes(text),
      )
      .slice(0, 4),
  }
}
