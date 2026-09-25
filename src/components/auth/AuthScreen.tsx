import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

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
    <main className="flex h-dvh items-center justify-center overflow-auto bg-fb-app px-6 py-10">
      <div className="w-full max-w-[380px]">
        <Link to="/" className="mb-8 flex items-center gap-2 no-underline">
          <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[11px] font-bold text-black">
            F
          </span>
          <span className="text-[13px] font-semibold text-fb-text">Framebase</span>
        </Link>
        <h1 className="mb-6 text-[22px] font-semibold tracking-tight text-fb-text">
          {title}
        </h1>
        {children}
        <p className="mt-6 text-[13px] text-fb-muted">{footer}</p>
      </div>
    </main>
  )
}

export const authFieldClass =
  'h-10 w-full rounded-md border border-fb-border-strong bg-fb-surface px-3 text-[13px] text-fb-text outline-none placeholder:text-fb-subtle'

export const authButtonClass =
  'h-10 w-full rounded-md bg-white text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50'
