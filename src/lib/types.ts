export type LineCode =
  | "AEL"
  | "TCL"
  | "TML"
  | "TKL"
  | "EAL"
  | "SIL"
  | "TWL"
  | "ISL"
  | "KTL"
  | "DRL"

export type Station = {
  code: string
  nameZh: string
  nameEn: string
  lat: number
  lng: number
  lines: LineCode[]
}

export type RailLine = {
  code: LineCode
  nameZh: string
  nameEn: string
  color: string
  upLabel: string
  downLabel: string
  paths: string[][]
}

export type Network = {
  lines: RailLine[]
  stations: Station[]
}

export type TrafficCamera = {
  key: string
  region: string
  district: string
  description: string
  lat: number
  lng: number
}

export type Train = {
  destination: string
  platform: string
  minutes: string
  time: string
  delayed: boolean
}

export type ScheduleView = {
  kind: "ready"
  delay: boolean
  updated: string
  up: Train[]
  down: Train[]
}

export type ScheduleResult =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | ScheduleView

export type Selection =
  | { kind: "station"; code: string; line: LineCode }
  | { kind: "camera"; key: string }

export type MapFocus = {
  nonce: number
  lng: number
  lat: number
  zoom: number
}
