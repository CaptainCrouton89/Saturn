'use client'

import { ApiKeyList } from '@/components/api-keys/ApiKeyList'
import { GenerateKeyDialog } from '@/components/api-keys/GenerateKeyDialog'
import { NewKeyDialog } from '@/components/api-keys/NewKeyDialog'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { generateApiKey, listApiKeys, revokeApiKey, type ApiKeyDTO } from '@/lib/api'
import { useCallback, useEffect, useState } from 'react'

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showGenerate, setShowGenerate] = useState(false)
  const [newKey, setNewKey] = useState<{ key: string; label: string } | null>(null)

  const getToken = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return session.access_token
  }, [])

  const loadKeys = useCallback(async () => {
    try {
      const token = await getToken()
      const allKeys = await listApiKeys(token)
      setKeys(allKeys.filter((k) => !k.revoked_at))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    loadKeys()
  }, [loadKeys])

  async function handleGenerate(label: string): Promise<boolean> {
    setError('')
    try {
      const token = await getToken()
      const result = await generateApiKey(token, label)
      setNewKey({ key: result.key, label })
      setShowGenerate(false)
      await loadKeys()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate key')
      return false
    }
  }

  async function handleRevoke(keyId: string) {
    setError('')
    setSuccess('')
    try {
      const token = await getToken()
      await revokeApiKey(token, keyId)
      setKeys((prev) => prev.filter((k) => k.id !== keyId))
      setSuccess('API key revoked')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key')
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold font-[Merriweather,serif]">API Keys</h1>
        <p className="mt-4 text-text-secondary">Loading...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-[Merriweather,serif]">API Keys</h1>
          <p className="mt-1 text-text-secondary">Manage keys for external integrations</p>
        </div>
        <Button onClick={() => setShowGenerate(true)}>Generate New Key</Button>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <ApiKeyList keys={keys} onRevoke={handleRevoke} />

      <GenerateKeyDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        onGenerate={handleGenerate}
      />

      <NewKeyDialog newKey={newKey} onClose={() => setNewKey(null)} />
    </div>
  )
}
