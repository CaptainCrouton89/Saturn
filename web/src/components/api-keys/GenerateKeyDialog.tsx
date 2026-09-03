'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState } from 'react'

interface GenerateKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolves true when the key was created; the label is kept on failure so it can be retried. */
  onGenerate: (label: string) => Promise<boolean>
}

export function GenerateKeyDialog({ open, onOpenChange, onGenerate }: GenerateKeyDialogProps) {
  const [label, setLabel] = useState('')
  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    if (!label.trim()) return
    setGenerating(true)
    const created = await onGenerate(label.trim())
    setGenerating(false)
    if (created) setLabel('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Omi Wearable"
              className="mt-1"
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={generating || !label.trim()}>
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
