import type { ReactNode, Ref } from 'react'

export function AppChrome({
  children,
  className,
  signOpen = false,
  rootRef,
}: {
  children: ReactNode
  className?: string
  signOpen?: boolean
  rootRef?: Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={rootRef}
      className={['app-page', signOpen ? 'is-sign-open' : null, className].filter(Boolean).join(' ')}
    >
      <div className="app-grain" aria-hidden="true" />
      <div className="app-edge app-edge-left" aria-hidden="true" />
      <div className="app-edge app-edge-right" aria-hidden="true" />
      <div className="app-edge-fade app-edge-fade-left" aria-hidden="true" />
      <div className="app-edge-fade app-edge-fade-right" aria-hidden="true" />
      <div className="app-corners" aria-hidden="true">
        <span className="app-corner app-corner-tl" />
        <span className="app-corner app-corner-tr" />
        <span className="app-corner app-corner-bl" />
        <span className="app-corner app-corner-br" />
      </div>
      {children}
    </div>
  )
}
