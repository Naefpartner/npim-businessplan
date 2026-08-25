// =============================================================================
// Edge Function: invite-user
//
// Lädt einen neuen User per E-Mail ein. Nur Admins dürfen aufrufen.
// Verwendet den service_role-Key, damit auth.admin.* zugänglich ist –
// dieser Key bleibt ausschliesslich auf dem Server.
//
// Aufruf vom Frontend (mit Session-Token):
//   supabase.functions.invoke('invite-user', {
//     body: { email, full_name, role }
//   })
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_URL                  = Deno.env.get('SITE_URL') ?? ''

const ALLOWED_ROLES = ['admin', 'manager', 'viewer'] as const
type Role = (typeof ALLOWED_ROLES)[number]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // 1. Aufrufer authentifizieren
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Nicht angemeldet' }, 401)

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'Nicht angemeldet' }, 401)

  // 2. Admin-Rolle prüfen (server-seitig, nie dem Client vertrauen)
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile)            return json({ error: 'Profil nicht gefunden' }, 403)
  if (!profile.active)                   return json({ error: 'Konto gesperrt' }, 403)
  if (profile.role !== 'admin')          return json({ error: 'Nur Admins dürfen User einladen' }, 403)

  // 3. Eingaben validieren
  let body: { email?: string; full_name?: string; role?: Role }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Ungültiger Request-Body' }, 400)
  }

  const email     = body.email?.trim().toLowerCase()
  const fullName  = body.full_name?.trim() ?? ''
  const role      = body.role

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Ungültige E-Mail-Adresse' }, 400)
  }
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return json({ error: 'Ungültige Rolle' }, 400)
  }

  // 4. Bestehenden User suchen – inviteUserByEmail wirft sonst
  //    "User already registered" und das Frontend bleibt hängen.
  const existing = await findUserByEmail(adminClient, email)
  if (existing) {
    if (existing.email_confirmed_at) {
      return json(
        { error: 'Diese E-Mail-Adresse ist bereits aktiv. Eine erneute Einladung ist nicht möglich.' },
        400,
      )
    }
    // Eingeladen, aber noch nicht bestätigt → alte Karteileiche löschen,
    // damit eine frische Einladung mit gültigem Token versendet wird.
    const { error: delErr } = await adminClient.auth.admin.deleteUser(existing.id)
    if (delErr) {
      return json({ error: `Bestehender Invite konnte nicht zurückgesetzt werden: ${delErr.message}` }, 400)
    }
  }

  // 5. Einladung versenden
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      data: { full_name: fullName, role },
      redirectTo: SITE_URL ? `${SITE_URL}/anmelden` : undefined,
    },
  )

  if (inviteErr) {
    return json({ error: inviteErr.message }, 400)
  }

  return json({ ok: true, user_id: invited.user?.id ?? null })
})

// listUsers ist paginiert und kennt keinen E-Mail-Filter, also seitenweise suchen.
async function findUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
) {
  const perPage = 200
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error || !data?.users) return null
    const found = data.users.find((u) => u.email?.toLowerCase() === email)
    if (found) return found
    if (data.users.length < perPage) return null
  }
  return null
}
