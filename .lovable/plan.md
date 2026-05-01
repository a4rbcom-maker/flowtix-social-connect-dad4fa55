
# Premium Landing Page Enhancements + Light Mode Default

## Changes Overview

### 1. Default to Light Mode
- Change default theme from `"dark"` to `"light"` in `src/lib/theme.tsx`

### 2. Add CSS Animations to `src/styles.css`
- Custom keyframes: `float`, `pulse-glow`, `slide-up`, `fade-in-up`, `shimmer`, `count-up`
- Animated gradient background for hero
- Smooth scroll behavior on `html`

### 3. Hero Section — Premium Upgrade
- Animated floating gradient orbs (CSS `float` animation with staggered delays)
- Badge with shimmer/glow pulse effect
- Title lines staggered fade-in-up animation on mount (using `useEffect` + state)
- Animated counter for stats (counting up from 0 to final value)
- CTA buttons with hover scale + glow shadow animation
- Decorative floating particles/dots in background

### 4. Features Section — Card Animations
- Scroll-triggered fade-in-up using IntersectionObserver hook
- Staggered card entry (each card appears with a slight delay)
- Icon container: animated gradient border on hover + rotation
- Card hover: lift up with enhanced shadow + subtle border glow

### 5. How It Works Section — Step Animations
- Animated connecting line between steps (dashed, animated stroke)
- Step numbers: pulse-glow animation on mount
- Each step fades in from bottom with stagger

### 6. Pricing Section — Premium Cards
- Popular card: animated gradient border (rotating gradient via `@keyframes`)
- Price number: count-up animation on scroll into view
- Hover: cards lift with shadow depth increase
- CTA buttons: gradient shift animation on hover

### 7. FAQ Section
- Smooth accordion open/close with height transition (using `grid-rows` trick)
- Subtle fade for answer text

### 8. Navbar Enhancement
- Shrink on scroll (reduce padding, add stronger backdrop blur)
- Nav links: underline slide animation on hover

### 9. Footer
- Subtle top border gradient (animated shimmer)

### 10. Reusable `useInView` Hook
- Create `src/hooks/use-in-view.tsx` with IntersectionObserver for scroll-triggered animations
- Used by Features, How It Works, Pricing, FAQ sections

## Technical Approach
- Pure CSS animations where possible (no extra dependencies)
- `useInView` hook for scroll-triggered reveals
- `useState` + `useEffect` for mount animations in Hero
- All animations respect `prefers-reduced-motion`
