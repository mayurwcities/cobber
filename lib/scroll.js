'use client';

/**
 * Scroll the window so `el` sits `offsetTop` px below the viewport top.
 * Uses explicit `window.scrollTo` rather than `Element.scrollIntoView`
 * because the latter is a visual no-op when the target is already
 * inside the viewport — which is common for in-card error boxes that
 * appear just below a sticky-ish header after a form submit. The
 * explicit scroll brings the element to a consistent position every
 * time so the user always sees a visible jump.
 */
export function scrollToElement(el, offsetTop = 80) {
  if (!el || typeof window === 'undefined') return;
  // Give React one frame to paint the ErrorBox / Drop-in state change
  // before we measure, otherwise getBoundingClientRect can be stale.
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    const top = Math.max(0, rect.top + window.scrollY - offsetTop);
    window.scrollTo({ top, behavior: 'smooth' });
  });
}
