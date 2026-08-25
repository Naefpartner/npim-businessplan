# NPIM-Businessplan

Web-Anwendung zur Erstellung und Bewirtschaftung von **Projektbusinessplänen** für Immobilienprojekte (Naef & Partner).

Architektonisch parallel zur Portfolio-Anwendung (`immo-portfolio`) aufgebaut, aber als eigenständiges Tool. Eine spätere lose Verknüpfung (Daten aus Businessplan in ein Portfolio-Szenario laden) ist geplant.

## Stack

| Bereich          | Technologie                                                  |
| ---------------- | ------------------------------------------------------------ |
| Frontend         | Vite + React 19 + TypeScript                                 |
| Styling          | Tailwind v4, shadcn/ui (Radix Primitives + cva)              |
| Routing          | react-router-dom v7                                          |
| Backend          | Supabase (Postgres, Auth, Edge Functions, Storage)           |
| Reports          | @react-pdf/renderer (kommt in späterer Phase)                |
| Charts           | Recharts (kommt in späterer Phase)                           |
| Auth-Modell      | Invite-only, Rollen `admin` / `manager` / `viewer`, RLS hart |

## Projektstruktur

```
src/
├── App.tsx                 # Routing
├── main.tsx                # React-Entry
├── index.css               # Tailwind + Theme-Variablen
├── assets/                 # Logo, Login-Hintergrund
├── components/
│   ├── auth/               # ProtectedRoute
│   ├── layout/             # AppLayout / Sidebar / Header
│   └── ui/                 # shadcn-Primitives (Button, Card, Dialog, …)
├── contexts/               # AuthContext, ThemeContext
├── hooks/                  # useProjects, useVariants
├── lib/                    # supabase-Client, utils (cn, format*)
├── pages/                  # Dashboard, Projekte, Projekt-Detail, Variante, …
└── types/                  # zentrale TypeScript-Typen
supabase/
├── migrations/             # 001_auth_and_roles.sql, 002_projects_and_variants.sql
└── functions/invite-user/  # Edge Function für Admin-Einladungen
```

## Setup

### 1. Repository klonen und Dependencies installieren

```bash
npm install
```

### 2. Supabase-Projekt anlegen

1. Neues Projekt unter <https://supabase.com> erstellen
2. Im Dashboard **Authentication → Providers → Email**: "Allow new users to sign up" auf **OFF** stellen
3. Migrationen ausführen — entweder via Supabase-CLI oder manuell im SQL-Editor in dieser Reihenfolge:
   - `supabase/migrations/001_auth_and_roles.sql`
   - `supabase/migrations/002_projects_and_variants.sql`
4. **Edge Function deployen**:
   ```bash
   supabase functions deploy invite-user
   supabase secrets set SITE_URL=https://deine-app-url
   ```

### 3. `.env.local` anlegen

```bash
cp .env.example .env.local
```

Werte aus dem Supabase-Dashboard (**Project Settings → API**) eintragen.

### 4. Erste Admin-Einladung

Nach erstem manuellen Anlegen eines Users (z. B. via Supabase-Dashboard "Add user → Invite") und Login:

```sql
UPDATE profiles SET role = 'admin' WHERE id = '<deine-uid>';
```

Ab dann kann der Admin neue User über die Benutzerverwaltung einladen.

### 5. Dev-Server

```bash
npm run dev
```

## Skripte

| Skript          | Wirkung                          |
| --------------- | -------------------------------- |
| `npm run dev`     | Vite Dev-Server                  |
| `npm run build`   | Produktions-Build (`dist/`)      |
| `npm run preview` | Preview des Build                |
| `npm run lint`    | ESLint                           |

## Implementierungsphasen

| Phase | Inhalt                                                                | Status     |
| ----- | --------------------------------------------------------------------- | ---------- |
| 0     | Repo-Setup, Stack, Auth, Layout                                       | erledigt   |
| 1     | Projekte & Varianten (CRUD, Snapshot, Vergleich-Skelett)              | erledigt   |
| 2     | Stammdaten (Parzellen, Bestandsgebäude, Baurecht, Mieterspiegel)      | offen      |
| 3     | Mengengerüst (Areal/Baufeld/Gebäude/Geschoss/Einheit)                 | offen      |
| 4     | Anlagekostenberechnung (BKP-H), KPI-Matrix, Phasen-Cashflow           | offen      |
| 5     | Wirtschaftlichkeit, Mittelfluss, Risiko, Kostenoptimierung, Reports   | offen      |

## CI / Layout

Reports übernehmen das Corporate-Design der Portfolio-Anwendung. Format-Vorgaben aus dem Briefing:

- A4 hochformat als Standard
- Detailseiten (z. B. Anlagekostenberechnung) A3 hochformat
- Keine Linien, fixierte Abstände
- Bausteine vor PDF-Export individuell auswählbar
