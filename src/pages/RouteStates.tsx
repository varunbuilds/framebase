import { Link } from '@tanstack/react-router'
import { AppChrome } from '@/components/layout/AppChrome'

export function SessionLoading() {
  return (
    <AppChrome>
      <main className="relative z-[1] grid h-dvh place-items-center text-[14px] text-[rgba(243,244,244,0.72)]">
        Checking your session…
      </main>
    </AppChrome>
  )
}

export function RouteError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return (
    <AppChrome>
      <main className="relative z-[1] grid h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-[32px] font-bold tracking-[-0.04em] text-[#f4f4f4]">
            Something went wrong
          </h1>
          <p className="mt-3 max-w-[42ch] text-[14px] text-fb-danger">{message}</p>
          <Link to="/" className="app-btn mt-8">
            Home
          </Link>
        </div>
      </main>
    </AppChrome>
  )
}
