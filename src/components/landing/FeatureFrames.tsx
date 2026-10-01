import FolderFloat from '@/components/landing/FolderFloat'

const CURSOR_PATH =
  'm.088 1.75 11.25 29.422c.409 1.07 1.908 1.113 2.377.067l5.223-11.653c.13-.288.36-.518.648-.648l11.653-5.223c1.046-.47 1.004-1.968-.067-2.377L1.75.088C.71-.31-.31.71.088 1.75Z'

const FEATURES = [
  {
    id: 'local',
    title: 'Local media',
    body: 'Picture and sound stay on this device. The timeline plays them from here.',
  },
  {
    id: 'shared',
    title: 'Shared projects',
    body: 'Several people on one timeline. The cut you commit is the one the room sees.',
  },
  {
    id: 'browser',
    title: 'In the browser',
    body: 'Nothing to install. Open a project and start cutting from the tab you already have.',
  },
] as const

export function FeatureFrames() {
  return (
    <div className="landing-feature-grid">
      {FEATURES.map((feature) => (
        <article key={feature.id} className="landing-feature">
          <div className="landing-feature-frame">
            {feature.id === 'local' ? <LocalMotion /> : null}
            {feature.id === 'shared' ? <SharedMotion /> : null}
            {feature.id === 'browser' ? <BrowserMotion /> : null}
          </div>
          <h2>{feature.title}</h2>
          <p>{feature.body}</p>
        </article>
      ))}
    </div>
  )
}

function LocalMotion() {
  return (
    <div className="motion motion-local" aria-hidden="true">
      <FolderFloat
        items={['Picture', 'Sound', 'B-roll']}
        label="Framebase"
        sublabel="Project data"
        trigger="auto"
        closeOnSelect={false}
        physics
        drift={0.5}
        folderColor="#1c4b78"
        frontColor="#3f82c7"
        paperColor="#d7e4f0"
        itemColor="#f4f4f4"
        itemTextColor="#11181d"
        labelColor="#f4f4f4"
        width={156}
        height={128}
        radius={12}
        spread={130}
        lift={18}
        tilt={6}
        flapAngle={34}
        restAngle={14}
        openDuration={640}
        stagger={70}
        bounce={0.22}
      />
    </div>
  )
}

function SharedMotion() {
  return (
    <div className="motion motion-shared" aria-hidden="true">
      <div className="motion-lane">
        <span className="motion-clip" />
        <span className="motion-clip is-long" />
      </div>
      <div className="motion-lane">
        <span className="motion-clip is-audio" />
        <span className="motion-clip is-audio is-short" />
      </div>
      <span className="motion-cursor is-a" style={{ color: '#3b97ff' }}>
        <CursorMark />
      </span>
      <span className="motion-cursor is-b" style={{ color: '#ff6f93' }}>
        <CursorMark />
      </span>
    </div>
  )
}

function BrowserMotion() {
  return (
    <div className="motion motion-browser" aria-hidden="true">
      <div className="motion-chrome">
        <span />
        <span />
        <span />
        <i>Google Chrome</i>
      </div>
      <div className="motion-screen" />
      <div className="motion-line">
        <span className="motion-head" />
      </div>
    </div>
  )
}

function CursorMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path fill="currentColor" d={CURSOR_PATH} />
    </svg>
  )
}
