// Schweizer Kantons-GIS-Portale (offizielle Karten der Kantone).
// Quellen: jeweilige Geoportale; vom User selbst durch eine konkrete URL
// (mit gewünschter Position/Layer) überschrieben werden.

export interface KantonGisEntry {
  code: string       // Kantonskürzel (ZH, BE, …)
  name: string       // ausgeschrieben
  defaultUrl: string // Start-URL des Kantons-GIS
}

export const KANTON_GIS: KantonGisEntry[] = [
  { code: 'AG', name: 'Aargau',                 defaultUrl: 'https://www.ag.ch/agisviewer4/' },
  { code: 'AI', name: 'Appenzell Innerrhoden',  defaultUrl: 'https://www.geo.ai.ch/' },
  { code: 'AR', name: 'Appenzell Ausserrhoden', defaultUrl: 'https://www.geoportal.ch/ktar' },
  { code: 'BE', name: 'Bern',                   defaultUrl: 'https://map.geo.be.ch/' },
  { code: 'BL', name: 'Basel-Landschaft',       defaultUrl: 'https://geoview.bl.ch/' },
  { code: 'BS', name: 'Basel-Stadt',            defaultUrl: 'https://map.geo.bs.ch/' },
  { code: 'FR', name: 'Freiburg',               defaultUrl: 'https://map.geo.fr.ch/' },
  { code: 'GE', name: 'Genf',                   defaultUrl: 'https://ge.ch/sitg/cartes/' },
  { code: 'GL', name: 'Glarus',                 defaultUrl: 'https://map.geo.gl.ch/' },
  { code: 'GR', name: 'Graubünden',             defaultUrl: 'https://map.geo.gr.ch/' },
  { code: 'JU', name: 'Jura',                   defaultUrl: 'https://geoportail.jura.ch/' },
  { code: 'LU', name: 'Luzern',                 defaultUrl: 'https://map.geo.lu.ch/' },
  { code: 'NE', name: 'Neuenburg',              defaultUrl: 'https://sitn.ne.ch/' },
  { code: 'NW', name: 'Nidwalden',              defaultUrl: 'https://map.geo.nw.ch/' },
  { code: 'OW', name: 'Obwalden',               defaultUrl: 'https://map.geo.ow.ch/' },
  { code: 'SG', name: 'St. Gallen',             defaultUrl: 'https://www.geoportal.ch/ktsg' },
  { code: 'SH', name: 'Schaffhausen',           defaultUrl: 'https://map.geo.sh.ch/' },
  { code: 'SO', name: 'Solothurn',              defaultUrl: 'https://geo.so.ch/map/' },
  { code: 'SZ', name: 'Schwyz',                 defaultUrl: 'https://map.geo.sz.ch/' },
  { code: 'TG', name: 'Thurgau',                defaultUrl: 'https://map.geo.tg.ch/' },
  { code: 'TI', name: 'Tessin',                 defaultUrl: 'https://map.geo.ti.ch/' },
  { code: 'UR', name: 'Uri',                    defaultUrl: 'https://map.geo.ur.ch/' },
  { code: 'VD', name: 'Waadt',                  defaultUrl: 'https://map.geo.vd.ch/' },
  { code: 'VS', name: 'Wallis',                 defaultUrl: 'https://map.geo.vs.ch/' },
  { code: 'ZG', name: 'Zug',                    defaultUrl: 'https://map.geo.zg.ch/' },
  { code: 'ZH', name: 'Zürich',                 defaultUrl: 'https://maps.zh.ch/' },
]

export function findKantonByCode(code: string | null | undefined): KantonGisEntry | null {
  if (!code) return null
  const norm = code.trim().toUpperCase()
  return KANTON_GIS.find((k) => k.code === norm) ?? null
}
