import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Customer } from '@/types'

export type CustomerInput = Omit<
  Customer,
  'id' | 'created_at' | 'updated_at' | 'created_by'
>

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('name', { ascending: true })
    if (error) setError(error.message)
    else setCustomers((data ?? []) as Customer[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function createCustomer(input: CustomerInput): Promise<Customer | null> {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('customers')
      .insert({ ...input, created_by: user?.id ?? null })
      .select()
      .single()
    if (error) { setError(error.message); return null }
    await load()
    return data as Customer
  }

  async function updateCustomer(id: string, patch: Partial<CustomerInput>) {
    const { error } = await supabase.from('customers').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  async function deleteCustomer(id: string) {
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  return { customers, loading, error, reload: load, createCustomer, updateCustomer, deleteCustomer }
}

export async function fetchCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[useCustomers] fetchCustomer:', error.message)
    return null
  }
  return data as Customer | null
}
