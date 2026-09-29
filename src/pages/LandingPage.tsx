import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import hero from '@/assets/hero.png'
import logo from '@/assets/framebase-logo.png'
import { useAuth } from '@/features/auth/use-auth'
import { formatTimecode } from '@/utils/time'

const RULER_TICKS = Array.from({ length: 33 }, (_, index) => ({
  index,
  major: index % 4 === 0,
  label: index % 4 === 0 && index < 32 ? formatTimecode(index * 500) : null,
}))

const PRESENCE = [
  { name: 'Neel', color: '#3b97ff', top: '18%', left: '50%', delay: '0s' },
  { name: 'Rob', color: '#2fce86', top: '80%', left: '38%', delay: '-2.4s' },
  { name: 'Marc', color: '#ff6f93', top: '22%', left: '12%', delay: '-4.6s' },
] as const

const SECTIONS = [
  {
    id: 'about',
    label: 'Home',
  },
  {
    id: 'features',
    label: 'Features',
    body: 'A project holds the timeline, the media, and the cut. Import a file, place the clips, and keep working locally.',
  },
  {
    id: 'team',
    label: 'Team',
    body: 'The committed timeline is what the room shares. A drag stays on your machine until you release it.',
  },
  {
    id: 'services',
    label: 'Services',
    body: 'Play through the timeline, step across gaps, and export an MP4 from the browser.',
  },
] as const

export function LandingPage() {
  const { status } = useAuth()
  const signedIn = status === 'signed-in'
  const rootRef = useRef<HTMLElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const linkRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [progress, setProgress] = useState(0)
  const [playheadLeft, setPlayheadLeft] = useState(0)
  const [clock, setClock] = useState('')

  useEffect(() => {
    const paint = () => {
      setClock(
        new Date().toLocaleTimeString('en-GB', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      )
    }
    paint()
    const id = window.setInterval(paint, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    const strip = stripRef.current
    if (!root || !strip) return

    let snapTimer = 0
    const settle = () => {
      const width = strip.clientWidth
      strip.style.scrollSnapType = ''
      if (width <= 0) return
      const max = Math.max(0, strip.scrollWidth - width)
      const left = Math.min(max, Math.max(0, Math.round(strip.scrollLeft / width) * width))
      strip.scrollTo({ left, behavior: 'smooth' })
    }
    const onWheel = (event: WheelEvent) => {
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        window.clearTimeout(snapTimer)
        strip.style.scrollSnapType = ''
        return
      }
      if (event.deltaY === 0) return
      event.preventDefault()
      let delta = event.deltaY
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 40
      else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= strip.clientWidth
      strip.style.scrollSnapType = 'none'
      strip.scrollLeft += delta
      window.clearTimeout(snapTimer)
      snapTimer = window.setTimeout(settle, 120)
    }

    root.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.clearTimeout(snapTimer)
      strip.style.scrollSnapType = ''
      root.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return

    const placePlayhead = () => {
      const max = strip.scrollWidth - strip.clientWidth
      const next = max <= 0 ? 0 : strip.scrollLeft / max
      setProgress(next)
      const nav = navRef.current
      const links = linkRefs.current.filter((link) => link != null)
      if (!nav || links.length === 0) return
      const navBox = nav.getBoundingClientRect()
      const starts = links.map((link) => link.getBoundingClientRect().left - navBox.left)
      const last = starts.length - 1
      const exact = next * last
      const index = Math.min(last - 1, Math.floor(exact))
      const blend = exact - index
      const left =
        index >= last ? starts[last] : starts[index] + (starts[index + 1] - starts[index]) * blend
      setPlayheadLeft(left ?? 0)
    }

    const onScroll = () => {
      placePlayhead()
    }

    onScroll()
    strip.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    let dragX = 0
    let dragScroll = 0
    let dragging = false
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragging = true
      dragX = event.clientX
      dragScroll = strip.scrollLeft
      strip.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      strip.scrollLeft = dragScroll - (event.clientX - dragX)
    }
    const onPointerUp = () => {
      dragging = false
    }
    strip.addEventListener('pointerdown', onPointerDown)
    strip.addEventListener('pointermove', onPointerMove)
    strip.addEventListener('pointerup', onPointerUp)
    strip.addEventListener('pointercancel', onPointerUp)

    return () => {
      strip.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      strip.removeEventListener('pointerdown', onPointerDown)
      strip.removeEventListener('pointermove', onPointerMove)
      strip.removeEventListener('pointerup', onPointerUp)
      strip.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  const activeLink = Math.round(progress * (SECTIONS.length - 1))

  const scrollToLink = (index: number) => {
    const strip = stripRef.current
    if (!strip) return
    const max = strip.scrollWidth - strip.clientWidth
    const left = SECTIONS.length <= 1 ? 0 : (index / (SECTIONS.length - 1)) * max
    strip.scrollTo({ left, behavior: 'smooth' })
  }

  return (
    <main ref={rootRef} className="landing-page">
      <div className="landing-grain" aria-hidden="true" />
      <div className="landing-edge landing-edge-left" aria-hidden="true" />
      <div className="landing-edge landing-edge-right" aria-hidden="true" />
      <div className="landing-corners" aria-hidden="true">
        <span className="landing-corner landing-corner-tl" />
        <span className="landing-corner landing-corner-tr" />
        <span className="landing-corner landing-corner-bl" />
        <span className="landing-corner landing-corner-br" />
      </div>

      <header className="landing-header">
        <img className="landing-mark" src={logo} alt="" />
        <p>FRAMEBASE</p>
        <div className="landing-contact">
          {signedIn ? (
            <Link to="/projects" className="landing-contact-link">
              Open projects
            </Link>
          ) : (
            <Link to="/login" search={{ redirect: '' }} className="landing-contact-link">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <div ref={stripRef} className="landing-stage">
        {SECTIONS.map((section) =>
          section.id === 'about' ? (
            <section
              key={section.id}
              className="landing-section landing-home"
              aria-labelledby={`landing-${section.id}`}
            >
              <div className="landing-home-copy">
                <h1 id={`landing-${section.id}`}>A browser-based collaborative video editor.</h1>
                <p>Everyone is on the same timeline in the browser. The cut you commit is the one the room sees.</p>
                {status === 'unconfigured' ? (
                  <p className="landing-note">
                    Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before signing in.
                  </p>
                ) : null}
              </div>
              <img className="landing-hero" src={hero} alt="Framebase editor" draggable={false} />
              <div className="landing-presence" aria-hidden="true">
                {PRESENCE.map((person) => (
                  <span
                    key={person.name}
                    className="landing-cursor"
                    style={
                      {
                        top: person.top,
                        left: person.left,
                        color: person.color,
                        '--cursor': person.color,
                        animationDelay: person.delay,
                      } as CSSProperties
                    }
                  >
                    <svg viewBox="0 0 32 32" className="landing-cursor-pointer" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="m.088 1.75 11.25 29.422c.409 1.07 1.908 1.113 2.377.067l5.223-11.653c.13-.288.36-.518.648-.648l11.653-5.223c1.046-.47 1.004-1.968-.067-2.377L1.75.088C.71-.31-.31.71.088 1.75Z"
                      />
                    </svg>
                    <span className="landing-cursor-name">{person.name}</span>
                  </span>
                ))}
              </div>
            </section>
          ) : (
            <section key={section.id} className="landing-section" aria-labelledby={`landing-${section.id}`}>
              <h1 id={`landing-${section.id}`}>{section.label}</h1>
              <p>{section.body}</p>
            </section>
          ),
        )}
      </div>

      <footer className="landing-footer">
        <span className="landing-footer-side">EN</span>
        <nav ref={navRef} className="landing-nav" aria-label="Sections">
          <div className="landing-ruler" aria-hidden="true">
            {RULER_TICKS.map((tick) => (
              <span
                key={tick.index}
                className={tick.major ? 'landing-ruler-mark is-major' : 'landing-ruler-mark'}
                style={{ left: `${(tick.index / (RULER_TICKS.length - 1)) * 100}%` }}
              >
                {tick.label ? <span>{tick.label}</span> : null}
              </span>
            ))}
          </div>
          <span className="landing-nav-track" aria-hidden="true" />
          <span
            className="landing-playhead"
            style={{ transform: `translateX(${playheadLeft}px)` }}
            aria-hidden="true"
          />
          {SECTIONS.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                linkRefs.current[index] = node
              }}
              type="button"
              className="landing-nav-link"
              aria-current={index === activeLink ? 'true' : undefined}
              onClick={() => scrollToLink(index)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <time className="landing-footer-side landing-clock" dateTime={clock}>
          {clock}
        </time>
      </footer>
    </main>
  )
}
