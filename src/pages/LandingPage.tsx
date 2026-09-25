import { Link } from '@tanstack/react-router'
import { useAuth } from '@/features/auth/use-auth'

export function LandingPage() {
  const { status } = useAuth()
  const signedIn = status === 'signed-in'

  return (
    <main className="flex h-dvh flex-col overflow-auto bg-fb-app">
      <header className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[11px] font-bold text-black">
            F
          </span>
          <span className="text-[13px] font-semibold text-fb-text">Framebase</span>
        </div>
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Link
              to="/projects"
              className="h-8 rounded-md bg-white px-3 text-[13px] font-medium leading-8 text-black no-underline"
            >
              Open projects
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                search={{ redirect: '' }}
                className="h-8 px-3 text-[13px] text-fb-muted no-underline hover:text-fb-text"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                className="h-8 rounded-md bg-white px-3 text-[13px] font-medium leading-8 text-black no-underline"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>
      <div className="flex flex-1 flex-col justify-center px-6 pb-24">
        <div className="mx-auto w-full max-w-[640px]">
          <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.14em] text-fb-subtle">
            Browser timeline
          </p>
          <h1 className="max-w-[16ch] text-[44px] font-semibold leading-[1.05] tracking-tight text-fb-text">
            Edit picture and sound in one place.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-fb-muted">
            Framebase is a project library and timeline editor. Sign in to keep
            projects, then cut locally in the browser.
          </p>
          {status === 'unconfigured' && (
            <p className="mt-6 text-[13px] text-fb-danger">
              Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before signing in.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
