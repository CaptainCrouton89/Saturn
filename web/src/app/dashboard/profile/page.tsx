'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getProfile, updateProfile, type UserProfileDTO } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfileDTO | null>(null)
  const [email, setEmail] = useState('')
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        const { data: { user } } = await supabase.auth.getUser()
        setEmail(user?.email ?? '')

        const p = await getProfile(session.access_token)
        setProfile(p)
        setDisplayName(p.display_name ?? '')
        setBio(p.bio ?? '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleSave() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const updated = await updateProfile(session.access_token, {
        display_name: displayName,
        bio: bio || undefined,
      })
      setProfile(updated)
      setEditing(false)
      setSuccess('Profile updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setDisplayName(profile?.display_name ?? '')
    setBio(profile?.bio ?? '')
    setEditing(false)
    setError('')
    setSuccess('')
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold font-[Merriweather,serif]">Profile</h1>
        <p className="mt-4 text-text-secondary">Loading...</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold font-[Merriweather,serif]">Profile</h1>
      <p className="mt-1 text-text-secondary">Manage your account information</p>

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
          <CardTitle className="font-[Merriweather,serif] text-lg">Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-text-secondary">Email</Label>
            <p className="mt-1 text-sm">{email}</p>
          </div>

          <Separator />

          {editing ? (
            <>
              <div>
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1"
                  placeholder="Your name"
                />
              </div>
              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="mt-1"
                  placeholder="A short bio about yourself"
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving || !displayName.trim()}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="outline" onClick={handleCancel} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label className="text-text-secondary">Display Name</Label>
                <p className="mt-1 text-sm">{profile?.display_name || '—'}</p>
              </div>
              <div>
                <Label className="text-text-secondary">Bio</Label>
                <p className="mt-1 text-sm">{profile?.bio || '—'}</p>
              </div>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit Profile
              </Button>
            </>
          )}

          <Separator />

          <div>
            <Label className="text-text-secondary">Member Since</Label>
            <p className="mt-1 text-sm">
              {profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : '—'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
