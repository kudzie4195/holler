import type { ReactNode } from 'react';

/**
 * Holler's own small icon set. Inline SVG, no library: a 24px grid, 1.75px rounded strokes in currentColor, so an icon takes the
 * color of the text around it. Every icon is decorative (aria-hidden, not focusable): the words next to it carry the meaning.
 * Shapes are kept loose and a little round so they sit well beside the main-street illustration.
 * Stroke settings live on the root <svg> only, which keeps each icon to a few hundred bytes of HTML.
 */
export type IconProps = { className?: string; size?: number };

function Svg({ className = '', size = 24, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

const CLOUD = 'M7 15.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5h.4a3.25 3.25 0 0 1 0 6.5z';

/** Weather alert: a cloud with a bolt. */
export function StormCloudIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d={CLOUD} />
      <path d="m12.5 15.5-2 3h3l-2 3" />
    </Svg>
  );
}

/** Hail and wind reports: a cloud dropping stones. */
export function HailIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d={CLOUD} />
      <circle cx="8" cy="19" r=".9" />
      <circle cx="12" cy="21" r=".9" />
      <circle cx="16" cy="19" r=".9" />
    </Svg>
  );
}

/** Disasters and floods: a house in rising water. */
export function FloodIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 13V9l7-5.5L19 9v4" />
      <path d="M10 13v-3h4v3" />
      <path d="M2.5 16.5c1.6 0 1.6-1.25 3.2-1.25s1.6 1.25 3.2 1.25 1.6-1.25 3.1-1.25 1.6 1.25 3.2 1.25 1.6-1.25 3.2-1.25 1.6 1.25 3.1 1.25" />
      <path d="M2.5 20.5c1.6 0 1.6-1.25 3.2-1.25s1.6 1.25 3.2 1.25 1.6-1.25 3.1-1.25 1.6 1.25 3.2 1.25 1.6-1.25 3.2-1.25 1.6 1.25 3.1 1.25" />
    </Svg>
  );
}

/** Earthquake: a seismograph line over a cracked ground. */
export function EarthquakeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 11h4l2-5 3 10 2.5-7 1.5 2h6" />
      <path d="M3 20h7l1.5-2 1.5 2h8" />
    </Svg>
  );
}

/** Airport delays. */
export function PlaneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.5 13.5 4 12l-1-1.5 1.5-.5 6 1L15 6.5c1-1 2.6-1.4 3.2-.8s.2 2.2-.8 3.2L13 13.5l1 6-.5 1.5-1.5-1z" />
      <path d="m7 16-2.5 3.5" />
    </Svg>
  );
}

/** Building permits: a hard hat. */
export function HardHatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 17.5h18v1.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M5 17.5V15a7 7 0 0 1 14 0v2.5" />
      <path d="M10 8.5V6.5a2 2 0 0 1 4 0v2" />
      <path d="M12 9v4" />
    </Svg>
  );
}

/** 311 requests: a megaphone. */
export function MegaphoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 10v4a1 1 0 0 0 1 1h2.5L15 19V5L7.5 9H5a1 1 0 0 0-1 1z" />
      <path d="m8 15 1.5 5h2.5l-1-4" />
      <path d="M18.5 9.5a3.5 3.5 0 0 1 0 5" />
    </Svg>
  );
}

/** Inspections: a clipboard with a tick. */
export function ClipboardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8.5 4.5H7A1.5 1.5 0 0 0 5.5 6v13.5A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-1.5" />
      <rect x="8.5" y="3" width="7" height="3" rx="1" />
      <path d="m9 13.5 2 2 4-4.5" />
    </Svg>
  );
}

/** Federal contracts: a page with a round seal. */
export function ContractIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3h8L19 7.5V11" />
      <path d="M8.5 8h5M8.5 11.5h4" />
      <circle cx="17" cy="15.5" r="2.75" />
      <path d="m15.5 18-.5 3.5 2-1 2 1-.5-3.5" />
    </Svg>
  );
}

/** New business licenses: a shopfront with an awning. */
export function StorefrontIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 10v10h16V10" />
      <path d="M3 6.5 4.5 3.5h15L21 6.5v1a2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0z" />
      <path d="M10 20v-5h4v5" />
    </Svg>
  );
}

/** Permitted events: a pennant flag. */
export function FlagIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 21V3.5" />
      <path d="M5.5 4.5c3-1.5 5.5 1.5 8.5 0s4-1 5-.5v8c-1-.5-2-1-5 .5s-5.5-1.5-8.5 0" />
    </Svg>
  );
}

/** Code violations: a warning triangle. */
export function WarningIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function MapPinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 21a2.2 2.2 0 0 0 4 0" />
    </Svg>
  );
}

export function EnvelopeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </Svg>
  );
}

export function WrenchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 6.5a4 4 0 0 1 5.2-3.2l-2.6 2.6.5 2.4 2.4.5 2.6-2.6a4 4 0 0 1-5.4 5L8.5 19.8a2.1 2.1 0 0 1-3-3l8.6-8.7a4 4 0 0 1 .4-1.6z" />
    </Svg>
  );
}

export function HouseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </Svg>
  );
}

/** Guides: an open book. */
export function BookIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5z" />
      <path d="M12 6.5v13" />
    </Svg>
  );
}

/** Numbers: three bars. */
export function ChartIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 20.5h17" />
      <rect x="5" y="12" width="3.5" height="8.5" rx="1" />
      <rect x="10.25" y="7" width="3.5" height="13.5" rx="1" />
      <rect x="15.5" y="10" width="3.5" height="10.5" rx="1" />
    </Svg>
  );
}

/** Questions: a speech bubble with a question mark. */
export function QuestionIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z" />
      <path d="M10 8.5a2 2 0 1 1 2.5 2c-.4.1-.5.5-.5.9v.3" />
      <path d="M12 14h.01" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 12h15" />
      <path d="m13.5 6 6 6-6 6" />
    </Svg>
  );
}

/**
 * Icon for a record, by kind and (for city records) subtype. Unknown kinds get the bell.
 * Kinds: lib/signals/types.ts. Subtypes: the city open-data adapters (permit, inspection, violation, business, event-permit).
 */
export function RecordIcon({ kind, subtype, ...p }: IconProps & { kind: string; subtype?: string | null }) {
  switch (subtype) {
    case 'inspection':
      return <ClipboardIcon {...p} />;
    case 'violation':
      return <WarningIcon {...p} />;
    case 'business':
      return <StorefrontIcon {...p} />;
    case 'event-permit':
      return <FlagIcon {...p} />;
    case 'permit':
      return <HardHatIcon {...p} />;
  }
  switch (kind) {
    case 'alert':
      return <StormCloudIcon {...p} />;
    case 'report':
      return <HailIcon {...p} />;
    case 'disaster':
      return <FloodIcon {...p} />;
    case 'quake':
      return <EarthquakeIcon {...p} />;
    case 'travel':
      return <PlaneIcon {...p} />;
    case 'permit':
      return <HardHatIcon {...p} />;
    case 'civic':
      return <MegaphoneIcon {...p} />;
    case 'contract':
      return <ContractIcon {...p} />;
    case 'event':
      return <FlagIcon {...p} />;
    case 'ask':
      return <HouseIcon {...p} />;
    default:
      return <BellIcon {...p} />;
  }
}
