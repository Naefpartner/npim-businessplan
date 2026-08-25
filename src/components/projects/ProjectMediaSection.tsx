import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  ChevronLeft, ChevronRight, ChevronDown, Star, StarOff, Trash2, Upload, ImagePlus, MapPin,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectPhotos } from '@/hooks/useProjectPhotos'
import { projectAddressLine, type Project } from '@/types'
import { cn } from '@/lib/utils'

export function ProjectMediaSection({ project, defaultExpanded = false }: { project: Project; defaultExpanded?: boolean }) {
  const { canWrite } = useAuth()
  const { photos, thumbnailPhotoId, loading, error, uploadPhoto, deletePhoto, setThumbnail } =
    useProjectPhotos(project.id)
  const [activeIdx, setActiveIdx] = useState(0)
  const [dragOver, setDragOver]   = useState(false)
  const [busy, setBusy]           = useState(false)
  const [expanded, setExpanded]   = useState(defaultExpanded)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const address = projectAddressLine(project)
  const mapsSrc = address
    ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`
    : null

  const active = photos.length > 0
    ? photos[Math.min(activeIdx, photos.length - 1)]
    : null

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      await uploadPhoto(file)
    }
    setBusy(false)
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    void handleFiles(e.target.files)
    e.target.value = ''
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragOver(false)
    void handleFiles(e.dataTransfer.files)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center gap-2 bg-[#B98C74]">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-slate-900 transition hover:brightness-95"
        >
          {expanded
            ? <ChevronDown className="h-4 w-4 text-slate-700" />
            : <ChevronRight className="h-4 w-4 text-slate-700" />}
          <MapPin className="h-4 w-4 text-slate-700" />
          Lage und Fotos
          {photos.length > 0 && !expanded && (
            <span className="ml-2 inline-flex items-center rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium text-slate-700">
              {photos.length} {photos.length === 1 ? 'Foto' : 'Fotos'}
            </span>
          )}
        </button>
      </header>

      {expanded && (
      <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
      {/* Karte (Google Maps Embed — kein API-Key nötig) */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700">
          <MapPin className="h-4 w-4 text-slate-400" />
          <span>Lage</span>
          {address && <span className="ml-2 truncate text-xs font-normal text-slate-500">{address}</span>}
        </header>
        <div className="aspect-[16/10] w-full bg-slate-100">
          {mapsSrc ? (
            <iframe
              title="Lageplan"
              src={mapsSrc}
              className="h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Keine Adresse erfasst — bitte im Projekt-Stammkopf hinterlegen.
            </div>
          )}
        </div>
      </div>

      {/* Foto-Karussell mit Direkt-Upload */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3 text-sm font-medium text-slate-700">
          <div className="flex items-center gap-2">
            <ImagePlus className="h-4 w-4 text-slate-400" />
            <span>Fotos</span>
            {photos.length > 0 && (
              <span className="text-xs font-normal text-slate-400">({photos.length})</span>
            )}
          </div>
          {canWrite && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {busy ? 'Lädt…' : 'Hochladen'}
              </button>
            </>
          )}
        </header>

        <div
          onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDragOver(true) } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'relative aspect-[16/10] w-full bg-slate-100',
            dragOver && 'ring-2 ring-inset ring-[#8B6956]/60',
          )}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Wird geladen…</div>
          ) : photos.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-500">
              <ImagePlus className="h-8 w-8 text-slate-300" />
              <p>{canWrite ? 'Fotos hierher ziehen oder oben "Hochladen" klicken.' : 'Noch keine Fotos vorhanden.'}</p>
            </div>
          ) : active ? (
            <>
              <img
                src={active.publicUrl}
                alt={active.file_name ?? ''}
                className="h-full w-full object-cover"
              />
              {/* Pfeil-Navigation */}
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveIdx((i) => (i - 1 + photos.length) % photos.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60"
                    title="Vorheriges Foto"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveIdx((i) => (i + 1) % photos.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60"
                    title="Nächstes Foto"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
              {/* Thumbnail-Badge oben rechts */}
              {thumbnailPhotoId === active.id && (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white shadow">
                  <Star className="h-3 w-3 fill-white" />
                  Thumbnail
                </span>
              )}
              {/* Index unten rechts */}
              <span className="absolute bottom-2 right-2 rounded-md bg-black/50 px-2 py-0.5 text-xs text-white">
                {Math.min(activeIdx, photos.length - 1) + 1} / {photos.length}
              </span>
            </>
          ) : null}
        </div>

        {/* Aktionen für aktives Foto + Thumbnail-Streifen */}
        {photos.length > 0 && active && (
          <div className="space-y-2 border-t border-slate-200 p-3">
            {canWrite && (
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setThumbnail(thumbnailPhotoId === active.id ? null : active.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition',
                    thumbnailPhotoId === active.id
                      ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                  title={thumbnailPhotoId === active.id ? 'Als Thumbnail entfernen' : 'Als Thumbnail markieren'}
                >
                  {thumbnailPhotoId === active.id
                    ? <><StarOff className="h-3.5 w-3.5" /> Thumbnail entfernen</>
                    : <><Star className="h-3.5 w-3.5" /> Als Thumbnail</>}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm('Foto wirklich löschen?')) return
                    const ok = await deletePhoto(active.id)
                    if (ok && activeIdx >= photos.length - 1) setActiveIdx(Math.max(0, photos.length - 2))
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  title="Foto löschen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Löschen
                </button>
              </div>
            )}
            <div className="flex gap-1.5 overflow-x-auto">
              {photos.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className={cn(
                    'relative h-12 w-16 shrink-0 overflow-hidden rounded border-2 transition',
                    idx === Math.min(activeIdx, photos.length - 1)
                      ? 'border-[#8B6956]'
                      : 'border-transparent hover:border-slate-300',
                  )}
                >
                  <img src={p.publicUrl} alt="" className="h-full w-full object-cover" />
                  {thumbnailPhotoId === p.id && (
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-amber-500 p-0.5 text-white shadow">
                      <Star className="h-2.5 w-2.5 fill-white" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </div>
      </div>
      )}
    </section>
  )
}
