import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import hero from '@/assets/hero.png'
import logo from '@/assets/framebase-logo.png'
import profile from '@/assets/profile.png'
import { FeatureFrames } from '@/components/landing/FeatureFrames'
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

const FAQ = [
  {
    n: '01',
    question: 'What is Framebase?',
    answer:
      'Framebase is a browser-based video editor built for collaborative editing. Create, edit and work on video projects together, all from one shared workspace.',
  },
  {
    n: '02',
    question: 'Can multiple people edit the same project?',
    answer:
      'Yes! Framebase supports real-time collaboration, letting multiple people work in the same project, see each other’s cursors and follow editing changes as they happen.',
  },
  {
    n: '03',
    question: 'Do I need to install anything?',
    answer:
      'No. Framebase runs directly in your web browser, so you can start editing without downloading or installing a desktop application.',
  },
  {
    n: '04',
    question: 'Can I import my own video and audio files?',
    answer:
      'Absolutely. Import your own footage and audio files into your project and arrange them on the timeline to create your edits.',
  },
  {
    n: '05',
    question: 'Can I export my finished videos?',
    answer: 'Yes. Export your finished projects as MP4 files directly from your browser.',
  },
  {
    n: '06',
    question: 'Where are my projects and media stored?',
    answer:
      'Your project data is synchronized through the cloud, while original media files are stored in your selected local workspace and can be synchronized through cloud storage.',
  },
] as const

const SECTIONS = [
  {
    id: 'about',
    label: 'Home',
  },
  {
    id: 'features',
    label: 'Features',
  },
  {
    id: 'faq',
    label: 'FAQ',
  },
  {
    id: 'feedback',
    label: 'Feedback',
  },
] as const

function FaqList() {
  const [open, setOpen] = useState<string>(FAQ[0].n)

  return (
    <div className="landing-faq-list">
      {FAQ.map((item) => {
        const isOpen = open === item.n
        return (
          <div key={item.n}>
            <button
              type="button"
              className="landing-faq-question"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? '' : item.n)}
            >
              <span className="landing-faq-index">{item.n}</span>
              <span className="landing-faq-copy">{item.question}</span>
              <span className={isOpen ? 'landing-faq-mark is-open' : 'landing-faq-mark'} aria-hidden="true" />
            </button>
            <div className={isOpen ? 'landing-faq-answer is-open' : 'landing-faq-answer'}>
              <p>{item.answer}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FeedbackSection() {
  const [note, setNote] = useState('')
  const [ready, setReady] = useState(false)

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = note.trim()
    if (!text) return
    const url = new URL('https://github.com/varunbuilds/framebase/issues/new')
    url.searchParams.set('title', 'Landing feedback')
    url.searchParams.set('body', text)
    window.open(url, '_blank', 'noopener,noreferrer')
    setReady(true)
  }

  return (
    <section className="landing-section landing-close" aria-label="Feedback">
      <form className="landing-feedback" onSubmit={onSubmit}>
        <label htmlFor="landing-feedback-note">A note</label>
        <textarea
          id="landing-feedback-note"
          name="note"
          rows={4}
          required
          value={note}
          placeholder="What should change?"
          onChange={(event) => {
            setNote(event.target.value)
            setReady(false)
          }}
        />
        <button type="submit">Send</button>
        {ready ? <p>Your note is ready in a new GitHub issue.</p> : null}
      </form>
      <footer className="landing-close-foot">
        <p className="landing-credit">
          Made by
          <a href="https://varunrewadi.com" target="_blank" rel="noreferrer">
            <img src={profile} alt="" />
            <span>Varun</span>
          </a>
        </p>
      </footer>
    </section>
  )
}

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
      const list = event.target instanceof Element ? event.target.closest('.landing-faq-list') : null
      const overFaq = list instanceof HTMLElement
      const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (overFaq && !horizontal) {
        const room = list.scrollHeight - list.clientHeight
        const atTop = list.scrollTop <= 0
        const atBottom = list.scrollTop >= room - 1
        if (room > 1 && ((event.deltaY > 0 && !atBottom) || (event.deltaY < 0 && !atTop))) return
      }
      if (!overFaq && horizontal) {
        window.clearTimeout(snapTimer)
        strip.style.scrollSnapType = ''
        return
      }
      const raw = horizontal ? event.deltaX : event.deltaY
      if (raw === 0) return
      event.preventDefault()
      let delta = raw
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
      const target = event.target
      if (target instanceof Element && target.closest('button, a, input, textarea, label')) return
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
      <div className="landing-edge-fade landing-edge-fade-left" aria-hidden="true" />
      <div className="landing-edge-fade landing-edge-fade-right" aria-hidden="true" />
      <div className="landing-corners" aria-hidden="true">
        <span className="landing-corner landing-corner-tl" />
        <span className="landing-corner landing-corner-tr" />
        <span className="landing-corner landing-corner-bl" />
        <span className="landing-corner landing-corner-br" />
      </div>

      <header className="landing-header">
        <img className="landing-mark" src={logo} alt="" />
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
          ) : section.id === 'faq' ? (
            <section key={section.id} className="landing-section landing-faq" aria-label={section.label}>
              <FaqList />
            </section>
          ) : section.id === 'features' ? (
            <section key={section.id} className="landing-section landing-features" aria-label={section.label}>
              <FeatureFrames />
            </section>
          ) : (
            <FeedbackSection key={section.id} />
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
