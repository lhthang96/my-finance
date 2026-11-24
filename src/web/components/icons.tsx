// Inline stroke icons (24px grid). Add a name here before referencing it from routes or pages.
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z',
  receipt: 'M6 2.5h12v19l-2.5-1.7L13 21.5l-2.5-1.7-2.5 1.7-2.5-1.7zM9 8h6M9 12h6M9 16h3.5',
  plan: 'M3 18 9 12l4 4 8-9M15 7h6v6',
  assets: 'M3.5 7.5A2.5 2.5 0 0 1 6 5h12.5v3.5M3.5 7.5V18a2.5 2.5 0 0 0 2.5 2.5h13.5V8.5H6a2.5 2.5 0 0 1-2.5-1zM16 14.5h2.5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4.5V9h4.5M12 7.5V12l3 2',
  plus: 'M12 5v14M5 12h14',
  backspace: 'M20.5 6H9.5L4 12l5.5 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zM12.5 9.5l5 5M17.5 9.5l-5 5',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 10 17.5 19.5 7',
  calendar: 'M4 6.5h16v13H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3.1L13.7 3.9a2 2 0 0 0-3.4 0z',
  cloudOff: 'M3 3l18 18M7 18.5h10.5a4 4 0 0 0 .8-7.9A6 6 0 0 0 7.1 9.5 4.5 4.5 0 0 0 7 18.5zM12 5.5a6 6 0 0 1 5.6 3.8',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
