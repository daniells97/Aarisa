import type { SVGProps } from 'react';

const paths = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  swap: 'M4 7h13l-3-3M20 17H7l3 3',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  cash: 'M2 6h20v13H2zM12 10a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  sliders: 'M4 6h10M4 12h4M12 12h8M4 18h12M17 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4M10 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4M18 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4',
  team: 'M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2',
  plus: 'M12 5v14M5 12h14',
  diamond: 'M12 2.5 21.5 12 12 21.5 2.5 12zM12 8.5v4M12 15.5v.3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  signOut: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  close: 'M6 6l12 12M18 6 6 18',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3',
} as const;

export type IconName = keyof typeof paths;

/** Decorative icon; the text next to it carries the meaning. */
export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}
