'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { listApiKeys, generateApiKey, revokeApiKey, type ApiKeyDTO } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Generate dialog state
  const [showGenerate, setShowGenerate] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [generating, setGenerating] = useState(false)

  // New key display dialog
  const [newKey, setNewKey] = useState<{ key: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Revoke confirmation
  const [revoking, setRevoking] = useState<string | null>(null)

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

  async function handleGenerate() {
    if (!newLabel.trim()) return
    setError('')
    setGenerating(true)
    try {
      const token = await getToken()
      const result = await generateApiKey(token, newLabel.trim())
      setNewKey({ key: result.key, label: newLabel.trim() })
      setShowGenerate(false)
      setNewLabel('')
      await loadKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate key')
    } finally {
      setGenerating(false)
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
      setRevoking(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key')
      setRevoking(null)
    }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-[Merriweather,serif] text-lg">Active Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-text-secondary">No API keys yet. Generate one to get started.</p>
          ) : (
            <div className="space-y-3">
              {keys.map((key, i) => (
                <div key={key.id}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{key.label}</span>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {key.key_prefix}...
                        </Badge>
                      </div>
                      <div className="text-xs text-text-secondary">
                        Created {new Date(key.created_at).toLocaleDateString()}
                        {key.last_used_at && (
                          <> · Last used {new Date(key.last_used_at).toLocaleDateString()}</>
                        )}
                      </div>
                    </div>
                    {revoking === key.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary">Are you sure?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRevoke(key.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRevoking(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRevoking(key.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate Key Dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-[Merriweather,serif]">Generate API Key</DialogTitle>
            <DialogDescription>
              Give your key a label to help you identify it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="keyLabel">Label</Label>
              <Input
                id="keyLabel"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Omi Wearable"
                className="mt-1"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowGenerate(false)}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={generating || !newLabel.trim()}>
                {generating ? 'Generating...' : 'Generate'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Key Display Dialog */}
      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-[Merriweather,serif]">Your New API Key</DialogTitle>
            <DialogDescription>
              Copy this key now — it won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-text-secondary">Label</Label>
              <p className="text-sm mt-1">{newKey?.label}</p>
            </div>
            <div>
              <Label className="text-text-secondary">API Key</Label>
              <div className="mt-1 flex gap-2">
                <code className="flex-1 rounded-md bg-beige px-3 py-2 text-sm font-mono break-all">
                  {newKey?.key}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => newKey && handleCopy(newKey.key)}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
            <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
              Save this key somewhere safe. You will not be able to see it again.
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setNewKey(null)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
