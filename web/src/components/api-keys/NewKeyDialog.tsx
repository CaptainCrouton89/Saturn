'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useState } from 'react'

interface NewKeyDialogProps {
  /** The one time the plaintext key is available; null closes the dialog. */
  newKey: { key: string; label: string } | null
  onClose: () => void
}

export function NewKeyDialog({ newKey, onClose }: NewKeyDialogProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={!!newKey} onOpenChange={onClose}>
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
              <Button size="sm" variant="outline" onClick={() => newKey && handleCopy(newKey.key)}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
          <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
            Save this key somewhere safe. You will not be able to see it again.
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
