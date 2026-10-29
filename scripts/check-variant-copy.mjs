#!/usr/bin/env node
/*
 * Prüft, ob beim Kopieren eines Stands (Szenario) alle variantengebundenen
 * Tabellen mitkopiert werden.
 *
 * Gelesen werden die Migrationen: jede Tabelle, die eine Spalte `variant_id`
 * führt, gehört zu einer Variante und muss in `copyVariantContents` vorkommen.
 * Fehlt eine, meldet das Skript sie und endet mit Code 1 — so fällt es beim
 * Anlegen der Tabelle auf und nicht erst dem Nutzer vor einer halb leeren
 * Kopie.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationen = join(wurzel, 'supabase', 'migrations')
const quelle = join(wurzel, 'src', 'hooks', 'useVariants.ts')

/**
 * Tabellen aus den Migrationen, die eine variant_id führen.
 *
 * Die Migrationen werden in ihrer Reihenfolge gelesen: was eine spätere wieder
 * fallen lässt, zählt nicht mehr — es gab Tabellen, die nur ein paar
 * Migrationen lang existierten.
 */
function variantenTabellen() {
  const gefunden = new Set()
  for (const datei of readdirSync(migrationen).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationen, datei), 'utf8')
    // CREATE TABLE ... ( ... ) — der Rumpf bis zur schliessenden Klammer auf
    // Spalte 1, so wie die Migrationen durchweg gesetzt sind.
    const re = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi
    let m
    while ((m = re.exec(sql)) !== null) {
      const [, tabelle, rumpf] = m
      if (/^\s*variant_id\s/m.test(rumpf)) gefunden.add(tabelle)
    }
    // Nachträglich angehängte Spalten zählen ebenso.
    const alter = /ALTER TABLE ([a-z_]+)[\s\S]*?ADD COLUMN (?:IF NOT EXISTS )?variant_id\s/gi
    while ((m = alter.exec(sql)) !== null) gefunden.add(m[1])
    // Fallen gelassene Tabellen sind aus dem Rennen.
    const drop = /DROP TABLE (?:IF EXISTS )?([a-z_]+)/gi
    while ((m = drop.exec(sql)) !== null) gefunden.delete(m[1])
  }
  return gefunden
}

const code = readFileSync(quelle, 'utf8')
const kopierfunktion = code.slice(
  code.indexOf('export async function copyVariantContents'),
  code.indexOf('export async function copyEtappe'),
)
// Die Liste der einfachen Tabellen steht oberhalb der Funktion.
const liste = code.slice(code.indexOf('const EINFACHE_TABELLEN'), code.indexOf('] as const'))
const abgedeckt = new Set(
  [...`${liste}\n${kopierfunktion}`.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
)

/**
 * Spalten von project_variants, wie sie nach allen Migrationen bestehen.
 * Die Kopie übernimmt sie alle ausser STAND_NEU_VERGEBEN — geprüft wird, dass
 * diese Liste nur echte Spalten nennt und die Kopie wirklich alle Spalten liest.
 */
function standSpalten() {
  const spalten = new Set()
  for (const datei of readdirSync(migrationen).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationen, datei), 'utf8')
    const create = /CREATE TABLE (?:IF NOT EXISTS )?project_variants\s*\(([\s\S]*?)\n\);/i.exec(sql)
    if (create) {
      for (const z of create[1].matchAll(/^\s+([a-z_]+)\s+[a-z]/gm)) {
        if (!['unique', 'primary', 'constraint', 'check', 'foreign'].includes(z[1])) spalten.add(z[1])
      }
    }
    for (const a of sql.matchAll(/ALTER TABLE project_variants\b([\s\S]*?);/gi)) {
      for (const z of a[1].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)/gi)) spalten.add(z[1])
      for (const z of a[1].matchAll(/DROP COLUMN (?:IF EXISTS )?([a-z_]+)/gi)) spalten.delete(z[1])
    }
  }
  return spalten
}

const probleme = []

const fehlend = [...variantenTabellen()].filter((t) => !abgedeckt.has(t)).sort()
if (fehlend.length) {
  probleme.push('Diese Tabellen führen eine variant_id, werden aber nicht kopiert:')
  for (const t of fehlend) probleme.push(`  • ${t}`)
  probleme.push('  → Eintragen in EINFACHE_TABELLEN in src/hooks/useVariants.ts — oder, wenn die')
  probleme.push('    Tabelle eigene Fremdschlüssel hat, in copyVariantContents einbauen.')
}

// Die Felder des Stands selbst: alles geht mit ausser STAND_NEU_VERGEBEN.
const spalten = standSpalten()
const neuStart = code.indexOf('export const STAND_NEU_VERGEBEN')
const neuVergeben = [...code.slice(neuStart, code.indexOf('] as const', neuStart)).matchAll(/'([a-z_]+)'/g)]
  .map((m) => m[1])
const unbekannt = neuVergeben.filter((s) => !spalten.has(s))
if (unbekannt.length) {
  probleme.push('STAND_NEU_VERGEBEN nennt Spalten, die project_variants nicht (mehr) hat:')
  for (const s of unbekannt) probleme.push(`  • ${s}`)
}
const anlegen = code.slice(code.indexOf('async function createVariant'), code.indexOf('async function updateVariant'))
if (!/from\('project_variants'\)\s*\.select\('\*'\)/.test(anlegen)) {
  probleme.push("createVariant liest den Quell-Stand nicht mehr mit select('*') — Felder des Stands")
  probleme.push('gingen beim Kopieren verloren.')
}

if (probleme.length === 0) {
  const mit = [...spalten].filter((s) => !neuVergeben.includes(s)).sort()
  console.log('Stand kopieren: alle variantengebundenen Tabellen sind abgedeckt.')
  console.log(`Felder des Stands, die 1:1 mitgehen: ${mit.join(', ')}`)
  process.exit(0)
}
console.error('Stand kopieren — unvollständig:')
for (const z of probleme) console.error(z)
process.exit(1)
