function Bone({ className }: { className: string }) {
  return (
    <span
      className={`block animate-pulse rounded bg-white/[0.08] motion-reduce:animate-none ${className}`}
    />
  )
}

export function ToolbarNameSkeleton() {
  return <Bone className="h-4 w-36" />
}

export function MediaPanelSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3" aria-hidden>
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="rounded-md border border-transparent p-1">
          <Bone className="aspect-video w-full rounded-[5px]" />
          <Bone className="mt-2 h-2.5 w-4/5" />
          <Bone className="mt-1.5 h-2 w-1/2" />
        </li>
      ))}
    </ul>
  )
}

export function PreviewFrameSkeleton() {
  return (
    <div className="absolute inset-0 animate-pulse bg-white/[0.04] motion-reduce:animate-none" aria-hidden>
      <div className="absolute inset-6 rounded-sm border border-white/[0.06]" />
    </div>
  )
}

export function TimelineSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-hidden>
      <div className="flex h-7 shrink-0 items-end gap-6 border-b border-fb-border bg-fb-ruler px-24 pb-1">
        <Bone className="mb-1 h-2 w-8" />
        <Bone className="mb-1 h-2 w-8" />
        <Bone className="mb-1 h-2 w-8" />
      </div>
      {[0, 1].map((track) => (
        <div key={track} className="flex h-[104px] shrink-0 border-b border-fb-border">
          <div className="flex w-[88px] shrink-0 items-center border-r border-fb-border px-2">
            <Bone className="h-2.5 w-12" />
          </div>
          <div className="flex flex-1 items-center px-4">
            <Bone className={`h-16 rounded-md ${track === 0 ? 'w-2/5' : 'w-1/4'}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function InspectorSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3" aria-hidden>
      <Bone className="h-2.5 w-16" />
      <Bone className="h-7 w-full" />
      <Bone className="h-16 w-full" />
      <Bone className="h-2.5 w-24" />
      <Bone className="h-7 w-full" />
      <Bone className="h-2.5 w-20" />
      <Bone className="h-7 w-full" />
    </div>
  )
}
