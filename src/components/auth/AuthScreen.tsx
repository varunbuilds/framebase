import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import logo from '@/assets/framebase-logo.png'
import { AppChrome } from '@/components/layout/AppChrome'

export function AuthScreen({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <AppChrome>
      <main className="relative z-[1] flex min-h-dvh items-center justify-center overflow-auto px-6 py-16">
        <div className="w-full max-w-[420px]">
          <Link to="/" className="mb-10 inline-flex no-underline">
            <img className="app-mark" src={logo} alt="Framebase" />
          </Link>
          <h1 className="mb-8 text-[32px] font-bold leading-none tracking-[-0.04em] text-[#f4f4f4]">
            {title}
          </h1>
          {children}
          <p className="mt-8 text-[14px] text-[rgba(243,244,244,0.72)]">{footer}</p>
        </div>
      </main>
    </AppChrome>
  )
}

export const authFieldClass = 'app-field h-11 px-3.5'

export const authButtonClass = 'app-btn app-btn-block disabled:opacity-50'
