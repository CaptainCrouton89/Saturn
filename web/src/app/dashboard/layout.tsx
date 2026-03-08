'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import type { User } from '@supabase/supabase-js'

const navItems = [
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/api-keys', label: 'API Keys' },
  { href: '/dashboard/integrations', label: 'Integrations' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })
  }, [])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const displayName =
    user?.user_metadata?.display_name || user?.email || 'User'

  return (
    <div className="flex min-h-screen bg-cream">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-white flex flex-col">
        <div className="p-4 border-b border-border">
          <Link href="/" className="text-lg font-bold font-[Merriweather,serif] text-primary">
            Cosmo
          </Link>
          <p className="text-sm text-text-secondary mt-1 truncate">{displayName}</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                pathname === item.href
                  ? 'bg-beige text-primary font-medium'
                  : 'text-text-secondary hover:bg-beige hover:text-text-primary'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-border">
          <Button variant="outline" className="w-full" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
