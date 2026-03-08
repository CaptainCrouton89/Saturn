'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function IntegrationsPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold font-[Merriweather,serif]">Integrations</h1>
      <p className="mt-1 text-text-secondary">Connect external devices and services</p>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-beige">
                <span className="text-lg">🎧</span>
              </div>
              <CardTitle className="font-[Merriweather,serif] text-lg">Omi Wearable</CardTitle>
            </div>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            Connect your Omi wearable to automatically capture conversations and add them to your
            knowledge graph. Omi records ambient audio, transcribes it, and sends the content
            directly to Cosmo for memory extraction.
          </p>
          <Separator className="my-4" />
          <div className="text-sm text-text-secondary space-y-2">
            <p className="font-medium text-text-primary">How it works:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Omi records and transcribes your conversations</li>
              <li>Transcripts are sent to Cosmo via your API key</li>
              <li>Cosmo extracts entities, relationships, and insights into your knowledge graph</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
