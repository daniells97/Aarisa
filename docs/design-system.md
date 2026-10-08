# Design system: "Bay Area dispatch"

Visual language taken from California road signage: Barlow type, freeway-green route plates,
and amber warning diamonds reserved for things that need a person. Everything else stays quiet.
Reference screens: `design/screens/*.dc.html` and the
[design canvas](https://claude.ai/artifact/YHRUwyMjLV3t4jDmrD7u2y).

## Tokens (`src/styles/tokens.css`)

```css
:root {
  /* ink */
  --ink: #1C2226;          /* text, dark surfaces */
  --ink-2: #3A4449;        /* body on white */
  --ink-3: #4A5459;        /* secondary text */
  --ink-4: #5F696E;        /* captions; min 4.5:1 on white */
  /* surfaces */
  --base: #F3F4F2;         /* app background */
  --surface: #FFFFFF;
  --line: #DADFDB;         /* panel borders */
  --line-soft: #EEF0EE;    /* row dividers */
  --control: #CDD3CF;      /* input and button borders */
  /* brand and status */
  --green: #0D5C46;        /* brand, primary action, confirmed */
  --green-hover: #08402F;
  --green-tint: #E3F0EA;
  --green-ai: #F2F8F5;     /* fields filled by AI */
  --chart-hovership: #3E9C78;
  --amber: #F2A900;        /* warning diamond, badges: needs a person */
  --amber-tint: #FFF4D6;
  --amber-wash: #FFF8E6;
  --amber-ink: #6B4600;
  --blue: #1F5FA8;         /* waiting, info, focus ring */
  --blue-tint: #E6EEF8;
  --red: #B42318;          /* negative money only */
  --red-tint: #FDECEA;
  --violet: #4B3F72;       /* contractor */
  --violet-tint: #EEEAF6;
  /* type */
  --font: 'Barlow', system-ui, sans-serif;
  --font-cond: 'Barlow Condensed', 'Barlow', sans-serif;
  /* radius */
  --r-sm: 7px; --r-md: 10px; --r-lg: 12px; --r-sheet: 24px;
}
```

Fonts: `Barlow` 400/500/600 and `Barlow Condensed` 500/600/700 from Google Fonts.
All numbers use `font-variant-numeric: tabular-nums lining-nums`.

## Type scale

| Use | Font | Size / weight |
|---|---|---|
| Page title (desktop) | Condensed | 40 / 600 |
| Page title (phone) | Condensed | 36 / 600 |
| Panel title | Condensed | 22 / 600 |
| Big figure | Condensed | 34–40 / 600 |
| Body | Barlow | 15 / 400 |
| Table | Barlow | 14.5 / 400, headers 13 / 500 |
| Caption | Barlow | 13–13.5 / 400, `--ink-4` |

Sentence case everywhere. No all-caps labels, no middle-dot meta strings.

## Components

| Component | Spec |
|---|---|
| **RoutePlate** | Green rounded rect, white Barlow Condensed 700, inner 1px white keyline (`box-shadow: inset 0 0 0 2px var(--green), inset 0 0 0 3px rgba(255,255,255,.75)`). Sizes 20/24/30 px high. Amber variant for a route that needs a driver. Used for every T-Force route code. |
| **WarningDiamond** | 24–26 px amber rhombus with ink outline and `!`. Only for exceptions, late money and blockers. `aria-hidden`, the text next to it carries the meaning. |
| **Pill** | 26 px high, dot + label, tinted: ok (green), waiting (blue), warn (amber), contractor (violet), muted (grey), bad (red). Never color alone. |
| **Badge** | Amber count in the sidebar next to sections with open items. |
| **Button** | 40 px desktop / 48–54 px phone. Primary green, secondary white with `--control` border. Label says the action; money actions include the amount. |
| **Panel** | White, 1px `--line`, radius 12. Figures inside one panel are split by `--line-soft` rules, not separate cards. |
| **Toast** | Ink background, white text, one action (Undo). 10 seconds. `role="status"`. |
| **Sheet (phone)** | Bottom sheet, radius 24, grab handle, close button 44 px. |
| **AI-filled field** | `--green-ai` background, `#B9D7C9` border, banner saying where the data came from. |
| **Tab bar (phone)** | Today, Extra jobs, Exceptions, Week. 66 px, labels always visible. |

## Layout

- Desktop: white sidebar 248–300 px (logo, ⌘K search, grouped nav: T-Force, Hovership,
  Money, Settings; user at the bottom). Content max 1240 px, padding 32/40 px.
- Phone: large title header on `--base`, content in white sections, primary action pinned
  above the tab bar.
- Breakpoints by content: sidebar and side panels wrap under the main content below ~900 px.

## Accessibility floor

WCAG 2.2 AA. Focus ring `3px solid var(--blue)` offset 2 px on every focusable element.
Real `<button>`, `<a href>`, `<label>`. Touch targets ≥ 44 px on phone. Respect
`prefers-reduced-motion`. Disabled buttons always explain why next to them.
