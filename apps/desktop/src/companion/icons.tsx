/**
 * Her window's line icons on a 24 grid (Bell's set, athena-mini-window), drawn inline so a static
 * render shows them too, and the labelled stand-in for a page capture. The seal is not here: it is
 * its own component (`seal.tsx`).
 */
const ICONS = {
  up: <path d="M6 15l6-6 6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  chevron: <path d="M8 5l8 7-8 7" />,
  away: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <path d="M4 4l16 16" />
    </>
  ),
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  hand: (
    <path d="M7 11V6a1.5 1.5 0 013 0v4m0-1V4.5a1.5 1.5 0 013 0V10m0-1.5a1.5 1.5 0 013 0V13m0-2.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.5A6 6 0 017 17.5L4.5 13a1.5 1.5 0 012.5-1.5" />
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  pin: (
    <>
      <path d="M9 4h6l-1 5 3 3H7l3-3-1-5Z" />
      <path d="M12 12v8" />
    </>
  ),
  record: (
    <>
      <path d="M6 4h9l3 3v13H6Z" />
      <path d="M9 10h6M9 14h6M9 18h4" />
    </>
  ),
  apps: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5Z" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warn: (
    <>
      <path d="M12 4 3.5 19h17Z" />
      <path d="M12 10v4M12 16.6v.4" />
    </>
  ),
  wait: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

/** A stand-in for the page capture, labelled as one wherever it is shown. */
export function Sketch() {
  return (
    <svg className="sketch" viewBox="0 0 116 66" aria-hidden="true">
      <rect className="sk-page" x=".75" y=".75" width="114.5" height="64.5" rx="4" />
      <rect className="sk-bar" x="1" y="1" width="114" height="11" rx="3" />
      <rect className="sk-line strong" x="8" y="18" width="46" height="4" rx="2" />
      <rect className="sk-line" x="8" y="27" width="98" height="3" rx="1.5" />
      <rect className="sk-line" x="8" y="34" width="90" height="3" rx="1.5" />
      <rect className="sk-line human" x="8" y="41" width="70" height="3" rx="1.5" />
      <rect className="sk-btn" x="8" y="49" width="34" height="10" rx="3" />
    </svg>
  );
}
