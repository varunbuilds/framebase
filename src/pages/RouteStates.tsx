import { Link } from '@tanstack/react-router'

export function SessionLoading() {
  return (
    <main className="grid h-dvh place-items-center bg-fb-app text-[13px] text-fb-muted">
      Checking your session…
    </main>
  )
}

export function RouteError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return (
    <main className="grid h-dvh place-items-center bg-fb-app px-6 text-center">
      <div>
        <h1 className="text-[20px] font-semibold text-fb-text">Something went wrong</h1>
        <p className="mt-2 max-w-[42ch] text-[13px] text-fb-danger">{message}</p>
        <Link to="/" className="mt-6 inline-block text-[13px] text-fb-text">
          Home
        </Link>
      </div>
    </main>
  )
}
