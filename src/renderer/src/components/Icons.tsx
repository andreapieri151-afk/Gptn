import type { ReactElement, ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 15, children, ...props }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const PlusIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const SearchIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
)

export const SettingsIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.01a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.54 1z" />
  </Icon>
)

export const TrashIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </Icon>
)

export const PencilIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M14.5 6.5l3 3" />
  </Icon>
)

export const CopyIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" />
  </Icon>
)

export const CheckIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
)

export const StopIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </Icon>
)

export const ArrowUpIcon = (props: IconProps): ReactElement => (
  <Icon {...props} strokeWidth={2}>
    <path d="M12 19V6M6 12l6-6 6 6" />
  </Icon>
)

export const SidebarIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9.5 4v16" />
  </Icon>
)

export const ChevronDownIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
)

export const CloseIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const RefreshIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-2.6 6" />
    <path d="M20 5v6h-6" />
  </Icon>
)

export const DownloadIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 4v11M8 11.5l4 4 4-4" />
    <path d="M5 19h14" />
  </Icon>
)

export const UploadIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 16V5M8 8.5l4-4 4 4" />
    <path d="M5 19h14" />
  </Icon>
)

export const FolderIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l1.6 2H18a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 18 18H6a2.5 2.5 0 0 1-2.5-2.5z" />
  </Icon>
)

export const ExternalIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M14 5h5v5" />
    <path d="M19 5l-7.5 7.5" />
    <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
  </Icon>
)

export const WarningIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 4.5 2.8 20h18.4L12 4.5z" />
    <path d="M12 10v4.2M12 17.2v.1" />
  </Icon>
)

export const SparkIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 11 10.1 9z" />
  </Icon>
)

export const KeyIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <circle cx="8" cy="14" r="3.5" />
    <path d="m10.6 11.4 8-8M17 5.5l2 2M15 7.5l2 2" />
  </Icon>
)

export const InfoIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.1" />
  </Icon>
)

/** GPTN brand mark: an original monogram, not derived from any other product. */
export function BrandMark({ size = 22 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gptn-mark" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7a80ff" />
          <stop offset="1" stopColor="#464dd8" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="url(#gptn-mark)" />
      <path
        d="M12.9 5.4c.5 3 1.6 4.1 4.6 4.6-3 .5-4.1 1.6-4.6 4.6-.5-3-1.6-4.1-4.6-4.6 3-.5 4.1-1.6 4.6-4.6z"
        fill="#fff"
        fillOpacity="0.95"
      />
      <circle cx="8.6" cy="16.2" r="1.35" fill="#fff" fillOpacity="0.9" />
    </svg>
  )
}
