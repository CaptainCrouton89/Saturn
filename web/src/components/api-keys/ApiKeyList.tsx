'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { ApiKeyDTO } from '@/lib/api'
import { useState } from 'react'

interface ApiKeyListProps {
  keys: ApiKeyDTO[]
  /** Revokes the key; the page reports failure through its own error banner. */
  onRevoke: (keyId: string) => Promise<void>
}

export function ApiKeyList({ keys, onRevoke }: ApiKeyListProps) {
  const [revoking, setRevoking] = useState<string | null>(null)

  async function handleRevoke(keyId: string) {
    await onRevoke(keyId)
    setRevoking(null)
  }

  return (
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
                      <Button size="sm" variant="destructive" onClick={() => handleRevoke(key.id)}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRevoking(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setRevoking(key.id)}>
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
  )
}
