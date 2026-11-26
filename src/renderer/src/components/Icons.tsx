import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...props
  }
}

export function SearchIcon(props: IconProps) {
  return <svg {...base(props)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
}

export function PlusIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M12 5v14M5 12h14" /></svg>
}

export function SettingsIcon(props: IconProps) {
  return <svg {...base(props)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></svg>
}

export function RefreshIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8a7 7 0 0 1 11.6-1L20 12M4 12l2.3 5a7 7 0 0 0 11.6-1" /></svg>
}

export function TrashIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
}

export function ChevronDownIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m6 9 6 6 6-6" /></svg>
}

export function ChevronRightIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m9 6 6 6-6 6" /></svg>
}

export function BellIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
}

export function ChartIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 4-6" /></svg>
}

export function HistoryIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
}

export function DownloadIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>
}

export function UploadIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M12 21V9M7 14l5-5 5 5M4 3h16" /></svg>
}

export function CloseIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m6 6 12 12M18 6 6 18" /></svg>
}

export function DragIcon(props: IconProps) {
  return <svg {...base(props)}><circle cx="9" cy="6" r="1" fill="currentColor" /><circle cx="15" cy="6" r="1" fill="currentColor" /><circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" /><circle cx="9" cy="18" r="1" fill="currentColor" /><circle cx="15" cy="18" r="1" fill="currentColor" /></svg>
}

export function AlertIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5M12 17.5v.1" /></svg>
}

export function SparkIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></svg>
}

export function ArrowUpRightIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M7 17 17 7M9 7h8v8" /></svg>
}

export function LogoMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-bar b1" />
      <span className="brand-bar b2" />
      <span className="brand-bar b3" />
      <span className="brand-dot" />
    </div>
  )
}
