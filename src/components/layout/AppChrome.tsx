import type { ReactNode } from 'react'

export function AppChrome({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className ? `app-page ${className}` : 'app-page'}>
      <div className="app-grain" aria-hidden="true" />
      <div className="app-edge app-edge-left" aria-hidden="true" />
      <div className="app-edge app-edge-right" aria-hidden="true" />
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
