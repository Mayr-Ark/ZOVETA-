# Zeveto Design System — v2 ("Boardroom")

Blueprint written **before** development, per pre-dev workflow.
Product: multi-tenant WhatsApp auto-reply bot for Nigerian businesses.
Brand feeling: **dependable, premium, in-control.** Not a WhatsApp clone — a business
tool that happens to plug into WhatsApp.

---

## 1. Stack

| Layer     | Choice                                   |
|-----------|------------------------------------------|
| Framework | Next.js (App Router) + TypeScript         |
| Styling   | Tailwind CSS + CSS custom-property tokens |
| Type      | Sora (display) / Inter (body)             |
| Icons     | Inline SVG, 1.8 stroke                    |
| Motion    | CSS only, spring curve, reveal-on-scroll  |

## 2. Typography

| Role      | Font   | Weights        | Notes                          |
|-----------|--------|----------------|--------------------------------|
| Display   | Sora   | 600, 700       | Headings, logo, plan prices    |
| Body      | Inter  | 400, 500, 600  | Copy, UI labels                |

- H1: clamp(2.6rem → 3.6rem), tracking −0.04em, line-height 1.08
- H2: clamp(1.9rem → 2.4rem), tracking −0.03em
- Body: 1rem/1.65; small: 0.875rem
- Eyebrow: 0.75rem, 700, letter-spacing 0.16em, uppercase, accent

## 3. Colors

Boardroom palette: deep ink navy canvas statements, warm paper surfaces,
one confident cobalt accent, brass reserved for highlights. **No green.**

| Token         | Value     | Use                                   |
|---------------|-----------|---------------------------------------|
| `ink`         | `#0C1226` | Headings, dark sections, footer       |
| `ink-soft`    | `#3D4459` | Muted text on light                   |
| `paper`       | `#FAFAF7` | Page background                       |
| `surface`     | `#FFFFFF` | Cards, header                         |
| `surface-alt` | `#F1F2EE` | Alt sections, hovers                  |
| `border`      | `#E3E4DE` | Hairlines, dividers                   |
| `accent`      | `#2B50E0` | Primary buttons, links, eyebrows      |
| `accent-deep` | `#1D3AAE` | Hover state                           |
| `accent-soft` | `#E8EDFC` | Icon chips, badges                    |
| `brass`       | `#C99A2C` | "Most popular", highlights, micro-accents |
| `night`       | `#0C1226` | CTA band background (same as ink)     |
| `mist`        | `#AAB4D4` | Muted text on dark                    |

Contrast: accent on white ≥ 5.4:1; white on ink ≥ 15:1. Brass only on ink or as
text on white at ≥ 0.875rem bold.

## 4. Spacing & Layout

- Scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96
- Container: `min(1180px, 100% − 32px)`; section padding 96px (64px mobile)
- Radii: sm 8 / md 12 / lg 20 / pill 999
- Shadows: card `0 6px 24px rgba(12,18,38,.07)`, float `0 20px 50px rgba(12,18,38,.14)`

## 5. Components

- **Buttons**: primary (accent fill), secondary (white, border), ghost (on dark).
  Min height 44px, radius 10px, hover lift −2px.
- **Cards**: white, 1px border, radius 12, shadow-card, hover lift −5px.
- **Chips/badges**: pill, accent-soft bg, accent text, 0.75rem semibold.
- **Icon chips**: 40–44px square, radius 10, accent-soft bg, accent icon.
- **Header**: sticky, blur, 68px, hairline border.
- **Pricing cards**: popular = accent ring + brass badge.
- **CTA band**: full-bleed ink background, grid mask, accent glow.

## 6. Animations

- Curve: `cubic-bezier(0.22, 1, 0.36, 1)` (spring).
- Reveal on scroll: opacity + translateY 8px, 320ms, 55ms stagger.
- Card hover lift, button hover lift, FAQ grid-rows expand.
- `prefers-reduced-motion`: everything off.

## 7. Responsive Rules

- Hero: 2-col ≥ lg, stacks below; chat mockup max-width 500px.
- Steps: 4 → 2 → 1 columns. Features: 2 → 1. Pricing: 4 → 2 → 1.
- Mobile nav: collapsible panel under header, max-height transition.

## 8. Development Plan

1. Tokens into `tailwind.config.ts` + `globals.css` (this blueprint, applied).
2. Layout: fonts via `next/font` (Sora + Inter), metadata refresh.
3. Page sections in order: Header → Hero → How it works → Features →
   Pricing → FAQ → CTA → Footer, using tokens only — no ad-hoc hex.
4. Motion pass last; then production build check.

## 9. Dashboard & Onboarding (applied v2)

- Same tokens as the site: cobalt accent, ink, paper canvas, brass for
  "Best capacity". Success green kept only for status semantics (Connected /
  Answered), never as brand color.
- **Dashboard home is Manus-style**: centered greeting ("Good morning,
  {business}"), a command-bar composer (type to jump to any section, Enter to
  go), quick-action chips, then live cards — recent activity, usage progress,
  connection health. Pages beyond home keep classic layouts with display
  headings.
- Onboarding: same 5 steps, restyled — ink logo tile, cobalt stepper, display
  headings. Logic untouched.

