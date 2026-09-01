import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, ExternalLink, Map as MapIcon, Save, Upload,
  Trash2, ChevronLeft, ChevronRight as ArrowRight,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { KANTON_GIS, findKantonByCode } from '@/lib/kantonGis'
import { useProjectGisScreenshots } from '@/hooks/useProjectGisScreenshots'
import {
  GIS_KATEGORIEN, GIS_KATEGORIE_LABEL,
  type GisKategorie, type Project,
} from '@/types'
import { cn } from '@/lib/utils'

export function ProjectGisSection({
  project,
  onProjectUpdated,
  defaultExpanded = false,
}: {
  project: Project
  onProjectUpdated?: (next: Project) => void
  defaultExpanded?: boolean
}) {
  const { canWrite } = useAuth()
  const [expanded, setExpanded]   = useState(defaultExpanded)
  const [draftUrl, setDraftUrl]   = useState(project.gis_url ?? '')
  const [savedUrl, setSavedUrl]   = useState(project.gis_url ?? '')
  const [parcelKanton, setParcelKanton] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sectionRef = useRef<HTMLDivElement | null>(null)

  const { items: screenshots, upload, remove, beschriften, error: shotsError } =
    useProjectGisScreenshots(project.id)

  // Kanton aus erster erfasster Parzelle ableiten — nur als Vorschlag.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('parcels')
      .select('kanton')
      .eq('project_id', project.id)
      .not('kanton', 'is', null)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const k = data?.kanton ? String(data.kanton).trim().toUpperCase() : null
        setParcelKanton(k)
      })
    return () => { cancelled = true }
  }, [project.id])

  useEffect(() => {
    setDraftUrl(project.gis_url ?? '')
    setSavedUrl(project.gis_url ?? '')
  }, [project.gis_url])

  // activeIndex sicher in Range halten, wenn Bilder dazukommen/wegfallen
  useEffect(() => {
    if (screenshots.length === 0) { setActiveIndex(0); return }
    if (activeIndex >= screenshots.length) setActiveIndex(screenshots.length - 1)
  }, [screenshots.length, activeIndex])

  // Globaler Paste-Handler: nur aktiv, solange die Sektion offen ist.
  // Greift nur, wenn ein Bild im Clipboard ist – Text-Paste in URL-Feld bleibt unberührt.
  useEffect(() => {
    if (!expanded || !canWrite) return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            void runUpload(file)
          }
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, canWrite])

  const suggested = findKantonByCode(parcelKanton)
  const isDirty   = draftUrl.trim() !== (savedUrl ?? '').trim()

  const safeIndex = Math.min(activeIndex, Math.max(0, screenshots.length - 1))
  const current   = screenshots[safeIndex]

  async function handleSaveUrl() {
    if (!canWrite) return
    setSaving(true)
    setError(null)
    const next = draftUrl.trim() || null
    const { data, error } = await supabase
      .from('projects')
      .update({ gis_url: next })
      .eq('id', project.id)
      .select('*')
      .single()
    setSaving(false)
    if (error) { setError(error.message); return }
    setSavedUrl(next ?? '')
    if (data && onProjectUpdated) onProjectUpdated(data as Project)
  }

  function applyKantonDefault(code: string) {
    const k = findKantonByCode(code)
    if (k) setDraftUrl(k.defaultUrl)
  }

  async function runUpload(file: File) {
    setUploading(true)
    setError(null)
    // Neue Bilder landen zunächst unter „Weiteres"; das Thema wird danach am
    // Bild selbst gesetzt.
    const ok = await upload(file, 'weitere')
    setUploading(false)
    if (ok) setActiveIndex(screenshots.length) // neues Bild wird angefügt
  }

  async function runDelete() {
    if (!current) return
    if (!window.confirm('Diesen GIS-Screenshot wirklich löschen?')) return
    setUploading(true)
    setError(null)
    await remove(current.id)
    setUploading(false)
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void runUpload(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!canWrite) return
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (file) void runUpload(file)
  }

  const combinedError = error ?? shotsError

  return (
    <section ref={sectionRef} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between bg-[#B98C74] pr-5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-slate-900 transition hover:brightness-95"
        >
          {expanded
            ? <ChevronDown className="h-4 w-4 text-slate-700" />
            : <ChevronRight className="h-4 w-4 text-slate-700" />}
          <MapIcon className="h-4 w-4 text-slate-700" />
          GIS-Informationen
          {savedUrl && !expanded && (
            <span className="ml-2 truncate text-xs font-normal text-slate-700">
              {(() => {
                try { return new URL(savedUrl).hostname }
                catch { return savedUrl }
              })()}
            </span>
          )}
          {screenshots.length > 0 && !expanded && (
            <span className="ml-2 inline-flex items-center rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-slate-100">
              {screenshots.length} {screenshots.length === 1 ? 'Bild' : 'Bilder'}
            </span>
          )}
        </button>
        {savedUrl && (
          <a
            href={savedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F2D3C2] px-3 py-1.5 text-xs font-medium text-slate-900 shadow-sm transition hover:bg-[#E7AF90]"
            onClick={(e) => e.stopPropagation()}
            title="Gespeicherten GIS-Stand in neuem Tab öffnen"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            GIS öffnen
          </a>
        )}
      </header>

      {expanded && (
        <div
          className="space-y-4 p-5"
          onDragOver={(e) => { if (canWrite) e.preventDefault() }}
          onDrop={onDrop}
        >
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Kantons-GIS:</span>
              {suggested && (
                <button
                  type="button"
                  onClick={() => applyKantonDefault(suggested.code)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#B98C74] bg-[#F2D3C2] px-2 py-1 text-xs font-medium text-slate-900 hover:bg-[#E7AF90]"
                  title={`Vorschlag aus Parzelle Kanton ${suggested.code}`}
                >
                  Vorschlag: {suggested.name}
                </button>
              )}
              <select
                onChange={(e) => { if (e.target.value) applyKantonDefault(e.target.value); e.target.value = '' }}
                defaultValue=""
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#8B6956]"
              >
                <option value="">— Kanton wählen —</option>
                {KANTON_GIS.map((k) => (
                  <option key={k.code} value={k.code}>{k.code} — {k.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="url"
              placeholder="https://maps.zh.ch/?…"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              disabled={!canWrite}
              className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50"
            />
            {canWrite && (
              <Button
                size="sm"
                onClick={handleSaveUrl}
                disabled={!isDirty || saving}
                className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Speichert…' : 'URL speichern'}
              </Button>
            )}
            {savedUrl && (
              <a
                href={savedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                title="Gespeicherten GIS-Stand in neuem Tab öffnen"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                GIS öffnen
              </a>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Kantons-GIS verbieten meist das Einbetten. Lade hier Karten-Screenshots
            hoch — entweder per <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono text-[10px]">⌘V</kbd> einfügen,
            Drag &amp; Drop oder über den Button.
          </p>

          {/* Karussell */}
          <div className="rounded-lg border border-slate-200 bg-slate-50">
            {screenshots.length > 0 ? (
              <div className="space-y-2 p-3">
                <div className="relative">
                  <a
                    href={current?.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Screenshot in voller Grösse öffnen"
                    className="block overflow-hidden rounded-md border border-slate-200 bg-white"
                  >
                    {current && (
                      <img
                        src={current.publicUrl}
                        alt={`GIS-Screenshot ${safeIndex + 1} / ${screenshots.length}`}
                        className="block max-h-[600px] w-full object-contain"
                      />
                    )}
                  </a>
                  {screenshots.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveIndex((i) => (i - 1 + screenshots.length) % screenshots.length)}
                        aria-label="Vorheriges Bild"
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow-sm ring-1 ring-slate-200 transition hover:bg-white"
                      >
                        <ChevronLeft className="h-4 w-4 text-slate-700" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveIndex((i) => (i + 1) % screenshots.length)}
                        aria-label="Nächstes Bild"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow-sm ring-1 ring-slate-200 transition hover:bg-white"
                      >
                        <ArrowRight className="h-4 w-4 text-slate-700" />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">
                        {safeIndex + 1} / {screenshots.length}
                      </div>
                    </>
                  )}
                </div>

                {/* Thema und Beschriftung des angezeigten Ausschnitts. Der
                    Bericht greift darüber gezielt auf ein Bild zu. */}
                {current && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <select
                      value={current.kategorie}
                      disabled={!canWrite}
                      onChange={(e) => void beschriften(current.id, {
                        kategorie: e.target.value as GisKategorie,
                      })}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none disabled:opacity-60"
                    >
                      {GIS_KATEGORIEN.map((k) => (
                        <option key={k} value={k}>{GIS_KATEGORIE_LABEL[k]}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      defaultValue={current.bezeichnung ?? ''}
                      key={current.id}
                      disabled={!canWrite}
                      placeholder={current.kategorie === 'weitere'
                        ? 'Beschriftung (z. B. Lärmbelastung)'
                        : 'Zusatz (optional)'}
                      onBlur={(e) => {
                        const wert = e.target.value.trim() || null
                        if (wert !== (current.bezeichnung ?? null)) {
                          void beschriften(current.id, { bezeichnung: wert })
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-slate-400 focus:outline-none disabled:opacity-60"
                    />
                  </div>
                )}

                {screenshots.length > 1 && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                    {screenshots.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setActiveIndex(i)}
                        aria-label={`Zu Bild ${i + 1} springen`}
                        className={cn(
                          'h-2 w-2 rounded-full transition',
                          i === safeIndex ? "bg-[#F2D3C2]" : 'bg-slate-300 hover:bg-slate-400',
                        )}
                      />
                    ))}
                  </div>
                )}

                {canWrite && (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {uploading ? 'Lädt…' : 'Bild hinzufügen'}
                    </Button>
                    {current && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={runDelete}
                        disabled={uploading}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Aktuelles löschen
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 p-8 text-center">
                <MapIcon className="h-8 w-8 text-slate-300" />
                <div className="text-sm text-slate-500">
                  Noch kein Screenshot. Füge mit{' '}
                  <kbd className="rounded border border-slate-300 bg-white px-1 font-mono text-[10px]">⌘V</kbd>
                  {' '}ein Bild ein, ziehe eines hierher oder wähle eine Datei.
                </div>
                {canWrite && (
                  <Button
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {uploading ? 'Lädt…' : 'Screenshot hochladen'}
                  </Button>
                )}
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileSelected}
            className="hidden"
          />

          {combinedError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {combinedError}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
