import {
  cameraGeoJson,
  railGeoJson,
  stationGeoJson,
} from "@/lib/transit"
import type { MapFocus, Selection } from "@/lib/types"
import { Map, NavigationControl, setWorkerUrl } from "maplibre-gl"
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl"
import { useEffect, useRef, useState } from "react"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import "maplibre-gl/dist/maplibre-gl.css"

setWorkerUrl(workerUrl)

const MTR_LAYERS = ["rail-casing", "rail-line", "stations", "station-labels"]
const CAMERA_LAYERS = ["camera-clusters", "camera-count", "cameras"]

type MapViewProps = {
  showMtr: boolean
  showCameras: boolean
  selection: Selection | null
  focus: MapFocus | null
  onSelectStation: (code: string) => void
  onSelectCamera: (key: string) => void
}

export function MapView({
  showMtr,
  showCameras,
  selection,
  focus,
  onSelectStation,
  onSelectCamera,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [styleError, setStyleError] = useState(false)
  const selectStationRef = useRef(onSelectStation)
  const selectCameraRef = useRef(onSelectCamera)

  useEffect(() => {
    selectStationRef.current = onSelectStation
    selectCameraRef.current = onSelectCamera
  }, [onSelectStation, onSelectCamera])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let alive = true
    const map = new Map({
      container,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [114.15, 22.33],
      zoom: 10.7,
      maxBounds: [
        [113.7, 22.05],
        [114.6, 22.68],
      ],
      attributionControl: {
        customAttribution: "路軌：OpenStreetMap · 到站班次：港鐵 · 快拍：運輸署",
      },
    })
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-left")
    mapRef.current = map

    const placeZoom = () => {
      const narrow = window.matchMedia("(max-width: 1023px)").matches
      const zoom = container.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-left")
      const credit = container.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right")
      const attrib = container.querySelector<HTMLElement>(".maplibregl-ctrl-attrib")
      if (attrib) attrib.classList.toggle("maplibregl-compact", narrow)
      if (!zoom || !credit) return
      if (narrow) {
        zoom.style.bottom = ""
        return
      }
      zoom.style.bottom = `${credit.offsetHeight + 16}px`
    }
    placeZoom()
    const credit = container.querySelector(".maplibregl-ctrl-bottom-right")
    const creditObserver = credit ? new ResizeObserver(placeZoom) : null
    if (credit) creditObserver?.observe(credit)
    window.addEventListener("resize", placeZoom)

    map.on("load", () => {
      if (!alive) return
      map.addSource("cameras", {
        type: "geojson",
        data: cameraGeoJson(),
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 14,
      })
      map.addLayer({
        id: "camera-clusters",
        type: "circle",
        source: "cameras",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#c2410c",
          "circle-radius": ["step", ["get", "point_count"], 14, 25, 18, 80, 24],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7ed",
        },
      })
      map.addLayer({
        id: "cameras",
        type: "circle",
        source: "cameras",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#ea580c",
          "circle-radius": 5,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      })

      map.addSource("rail", { type: "geojson", data: railGeoJson() })
      map.addLayer({
        id: "rail-casing",
        type: "line",
        source: "rail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.95 },
      })
      map.addLayer({
        id: "rail-line",
        type: "line",
        source: "rail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 1 },
      })
      map.addLayer({
        id: "camera-count",
        type: "symbol",
        source: "cameras",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#fff7ed",
          "text-halo-color": "#c2410c",
          "text-halo-width": 1.2,
        },
      })

      map.addSource("stations", { type: "geojson", data: stationGeoJson() })
      map.addLayer({
        id: "stations",
        type: "circle",
        source: "stations",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["case", ["==", ["get", "interchange"], 1], 6.5, 5.5],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      })
      map.addLayer({
        id: "station-labels",
        type: "symbol",
        source: "stations",
        minzoom: 12,
        layout: {
          "text-field": ["get", "nameZh"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 0.95],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#1c1917",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.4,
        },
      })

      const pointCursor = (layer: string) => {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer"
        })
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = ""
        })
      }
      pointCursor("stations")
      pointCursor("cameras")
      pointCursor("camera-clusters")

      map.on("click", (event) => {
        const stationHit = map.queryRenderedFeatures(event.point, { layers: ["stations"] })[0]
        const stationCode = stationHit?.properties?.code
        if (stationCode) {
          selectStationRef.current(String(stationCode))
          return
        }
        const cameraHit = map.queryRenderedFeatures(event.point, { layers: ["cameras"] })[0]
        const cameraKey = cameraHit?.properties?.key
        if (cameraKey) {
          selectCameraRef.current(String(cameraKey))
          return
        }
        const cluster = map.queryRenderedFeatures(event.point, { layers: ["camera-clusters"] })[0]
        if (!cluster || cluster.geometry.type !== "Point") return
        const center = cluster.geometry.coordinates as [number, number]
        const source = map.getSource("cameras") as GeoJSONSource
        const clusterId = Number(cluster.properties?.cluster_id)
        if (!Number.isFinite(clusterId)) return
        void source
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            if (!alive) return
            map.easeTo({ center, zoom })
          })
          .catch(() => {})
      })

      setStyleError(false)
      setReady(true)
      placeZoom()
    })

    map.on("error", (event) => {
      if (!alive || map.isStyleLoaded()) return
      const error = event.error as { url?: string; message?: string } | undefined
      const url = typeof error?.url === "string" ? error.url : ""
      const message = event.error instanceof Error ? event.error.message : String(error?.message ?? "")
      if (url.includes("/styles/") || /style/i.test(message)) setStyleError(true)
    })

    return () => {
      alive = false
      creditObserver?.disconnect()
      window.removeEventListener("resize", placeZoom)
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const mtr = showMtr ? "visible" : "none"
    const camera = showCameras ? "visible" : "none"
    for (const layer of MTR_LAYERS) map.setLayoutProperty(layer, "visibility", mtr)
    for (const layer of CAMERA_LAYERS) map.setLayoutProperty(layer, "visibility", camera)
  }, [ready, showMtr, showCameras])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const stationCode = selection?.kind === "station" ? selection.code : ""
    const cameraKey = selection?.kind === "camera" ? selection.key : ""
    map.setPaintProperty("stations", "circle-stroke-color", [
      "case",
      ["==", ["get", "code"], stationCode],
      "#14222b",
      "#ffffff",
    ])
    map.setPaintProperty("stations", "circle-stroke-width", [
      "case",
      ["==", ["get", "code"], stationCode],
      3.5,
      2,
    ])
    map.setPaintProperty("stations", "circle-radius", [
      "case",
      ["==", ["get", "code"], stationCode],
      9,
      ["case", ["==", ["get", "interchange"], 1], 6.5, 5.5],
    ])
    map.setPaintProperty("cameras", "circle-stroke-color", [
      "case",
      ["==", ["get", "key"], cameraKey],
      "#14222b",
      "#ffffff",
    ])
    map.setPaintProperty("cameras", "circle-radius", [
      "case",
      ["==", ["get", "key"], cameraKey],
      7,
      5,
    ])
  }, [ready, selection])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focus) return
    let frame = 0
    let lastOverlap = -1

    const move = () => {
      const narrow = window.matchMedia("(max-width: 1023px)").matches
      const mapRect = map.getContainer().getBoundingClientRect()
      const panel = document.getElementById("place-inspector")?.getBoundingClientRect()
      const header = document.getElementById("map-header")?.getBoundingClientRect()
      let top = narrow && header ? Math.max(0, Math.round(header.bottom - mapRect.top)) : 0
      let bottom = narrow && panel ? Math.max(0, Math.round(mapRect.bottom - panel.top)) : 0
      const minBand = 72
      if (top + bottom > mapRect.height - minBand) {
        bottom = Math.max(0, Math.round(mapRect.height - top - minBand))
      }
      const signature = top * 10000 + bottom
      if (lastOverlap >= 0 && Math.abs(signature - lastOverlap) < 12) return
      lastOverlap = signature
      map.easeTo({
        center: [focus.lng, focus.lat],
        zoom: Math.max(map.getZoom(), focus.zoom),
        duration: 700,
        padding: { top, bottom, left: 0, right: 0 },
      })
    }

    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(move)
    })
    const panel = document.getElementById("place-inspector")
    const header = document.getElementById("map-header")
    const observer = window.matchMedia("(max-width: 1023px)").matches ? new ResizeObserver(() => move()) : null
    if (panel) observer?.observe(panel)
    if (header) observer?.observe(header)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [ready, focus])

  return (
    <div className="map-root absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {styleError ? (
        <p className="absolute top-4 left-1/2 z-10 max-w-sm -translate-x-1/2 rounded-xl bg-white px-4 py-3 text-sm shadow-lg">
          底圖暫時未能載入。請檢查網絡後再重新整理。
        </p>
      ) : null}
    </div>
  )
}
