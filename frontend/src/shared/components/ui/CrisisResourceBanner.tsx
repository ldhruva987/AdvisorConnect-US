import { Phone } from 'lucide-react'

/**
 * Crisis-resource notice shown wherever a user is about to engage a Mental Health advisor.
 *
 * Not a replacement for anything clinical this platform does — it's the minimum a US product
 * touching mental health should surface: the 988 Suicide & Crisis Lifeline is free, available
 * 24/7 by call or text, and exists precisely for the gap between "booked a session next week" and
 * "needs help right now." Nothing here claims AdvisorConnect provides emergency care itself.
 */
export function CrisisResourceBanner() {
  return (
    <div
      role="note"
      aria-label="Crisis support resources"
      className="flex items-start gap-3 rounded-xl border border-warn-600/30 bg-warn-100/40 p-4 mb-6"
    >
      <Phone className="w-5 h-5 text-warn-600 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-ink-700 leading-relaxed">
        If you're in crisis or need immediate support, call or text{' '}
        <strong className="font-semibold">988</strong> (Suicide &amp; Crisis Lifeline) — free,
        confidential, 24/7. This is not a substitute for emergency services; if you or someone
        else is in immediate danger, call 911.
      </p>
    </div>
  )
}
