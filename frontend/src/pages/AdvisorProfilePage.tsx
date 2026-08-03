import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Star, MessageCircle, Video, Clock, Award, UserX } from 'lucide-react'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { CrisisResourceBanner } from '@/shared/components/ui/CrisisResourceBanner'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { ErrorBanner } from '@/shared/components/ui/ErrorBanner'
import { Skeleton } from '@/shared/components/ui/Skeleton'
import { Navbar } from '@/shared/components/layout/Navbar'
import { useAdvisorProfile } from '@/features/advisor-profile/hooks/useAdvisorProfile'
import { useAdvisorReviews } from '@/features/advisor-profile/hooks/useAdvisorReviews'
import { ReviewModal } from '@/features/advisor-profile/components/ReviewModal'
import { useMyBookings } from '@/features/booking/hooks/useMyBookings'
import { getErrorMessage } from '@/lib/getErrorMessage'
import { useAuthStore } from '@/stores/authStore'

/** ISO timestamp → `Mar 10, 2026`. Falls back to the raw string if unparseable. */
function formatReviewDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** `1247` → `1.2k`. Keeps the stat row narrow without inventing precision. */
function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function ProfileSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-ink-200 overflow-hidden mb-6" role="status" aria-label="Loading advisor profile">
      <div className="h-32 bg-ink-100" />
      <div className="px-6 pb-6">
        <div className="flex items-end justify-between -mt-10 mb-4">
          <Skeleton className="w-20 h-20 rounded-xl border-4 border-white" />
        </div>
        <Skeleton className="h-6 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-5" />
        <Skeleton className="h-16 w-full rounded-xl mb-6" />
        <div className="flex gap-2 mb-6">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  )
}

export function AdvisorProfilePage() {
  const navigate = useNavigate()
  // The page is mounted at `/advisor/:username`. Reading the param is what makes
  // it show the advisor that was actually clicked rather than one fixed profile.
  const { username } = useParams<{ username: string }>()

  const { data: advisor, isLoading, isError, error } = useAdvisorProfile(username)
  // Reviews key off the advisor's id, which only exists once the profile has
  // resolved; the hook's `enabled` guard keeps this from firing early.
  const reviewsQuery = useAdvisorReviews(advisor?.id)

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)

  // Skipped entirely for signed-out visitors: `/bookings/me` is authenticated,
  // and a guaranteed 401 on a public profile page is pure noise.
  const myBookingsQuery = useMyBookings({ enabled: isAuthenticated })

  /**
   * Client-side review eligibility, and deliberately a stopgap.
   *
   * There is no "can I review this advisor" flag on any endpoint, and `Booking`
   * carries no review-linkage field, so the strongest inference available is
   * "you have a completed session with this advisor". A session you already
   * reviewed still matches, which means the CTA can appear when it shouldn't;
   * the backend rejects the duplicate and `ReviewModal` shows that rejection,
   * which is the correct safety net. The inverse error — hiding the button from
   * someone entitled to review — would be silent and unrecoverable, so this
   * errs toward showing it.
   */
  const reviewableBooking = useMemo(() => {
    if (!advisor) return undefined
    return (myBookingsQuery.data ?? []).find(
      (booking) => booking.advisorId === advisor.id && booking.status === 'COMPLETED',
    )
  }, [myBookingsQuery.data, advisor])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ink-50">
        <Navbar />
        <div className="pt-16 max-w-4xl mx-auto px-4 py-8">
          <ProfileSkeleton />
        </div>
      </div>
    )
  }

  // A 404 and a transport failure land in the same place on purpose: from the
  // reader's point of view there is no profile to show either way.
  if (isError || !advisor) {
    return (
      <div className="min-h-screen bg-ink-50">
        <Navbar />
        <div className="pt-16 max-w-4xl mx-auto px-4 py-8">
          <EmptyState
            icon={<UserX className="w-8 h-8" />}
            title="Advisor not found"
            description={
              error
                ? getErrorMessage(error)
                : 'This profile may have been removed or the link may be incorrect.'
            }
            action={
              <Button variant="outline" onClick={() => navigate('/explore')}>
                Back to Explore
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const reviews = reviewsQuery.data?.reviews ?? []
  const reviewTotal = reviewsQuery.data?.totalElements ?? advisor.reviewCount

  const stats = [
    { icon: Star, label: 'Rating', value: `${advisor.rating}★`, color: 'text-warn-600' },
    { icon: MessageCircle, label: 'Chats', value: formatCount(advisor.chatCount), color: 'text-oxblood-700' },
    { icon: Award, label: 'Reviews', value: String(advisor.reviewCount), color: 'text-pine-600' },
    { icon: Clock, label: 'Response', value: `${advisor.responseTimeMinutes}m`, color: 'text-ink-700' },
    { icon: Award, label: 'Experience', value: `${advisor.experienceYears}yr`, color: 'text-ink-600' },
  ]

  return (
    <div className="min-h-screen bg-ink-50">
      <Navbar />
      <div className="pt-16 max-w-4xl mx-auto px-4 py-8">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-ink-500 hover:text-ink-900 transition-colors text-sm font-medium mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {advisor.sectors.includes('Mental Health') && <CrisisResourceBanner />}

        {/* Main card */}
        <div className="bg-white rounded-xl border border-ink-200 overflow-hidden mb-6">
          {/* Cover */}
          <div className="h-32 bg-gradient-to-r from-ink-900 to-oxblood-700" />

          {/* Profile header */}
          <div className="px-6 pb-6">
            <div className="flex items-end justify-between -mt-10 mb-4">
              <Avatar
                username={advisor.username}
                color={advisor.color}
                size="xl"
                className="border-4 border-white rounded-full"
              />
              {advisor.isOnline && (
                <div className="flex items-center gap-1.5 bg-pine-100 text-pine-600 text-xs font-semibold px-3 py-1.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-pine-600" />
                  Online now
                </div>
              )}
            </div>

            {/* Name + verified */}
            <div className="flex items-center gap-2 mb-1">
              <h1 className="font-heading font-medium text-2xl text-ink-900">{advisor.username}</h1>
              {advisor.isVerified && (
                <CheckCircle className="w-5 h-5 text-pine-600" aria-label="Verified" />
              )}
            </div>
            <p className="text-ink-500 mb-5">{advisor.title}</p>

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-0 mb-6 bg-ink-50 rounded-xl overflow-hidden border border-ink-100">
              {stats.map((stat, i) => (
                <div
                  key={stat.label}
                  className={`flex-1 min-w-[80px] text-center py-3 px-2 ${i < stats.length - 1 ? 'border-r border-ink-100' : ''}`}
                >
                  <p className={`font-heading font-medium text-lg ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-ink-400 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Sectors + tags. `mapAdvisorDto` has already turned backend enums
                into display labels, so these render straight through. */}
            {(advisor.sectors.length > 0 || advisor.tags.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-6">
                {advisor.sectors.map((sector) => (
                  <Badge key={sector} variant="brand">{sector}</Badge>
                ))}
                {advisor.tags.map((tag) => (
                  <Badge key={tag} variant="default">{tag}</Badge>
                ))}
              </div>
            )}

            {/* About */}
            {advisor.bio && (
              <div className="mb-6">
                <h3 className="font-heading font-semibold text-ink-900 mb-3">About</h3>
                {advisor.bio.split('\n\n').map((para, i) => (
                  <p key={i} className="text-ink-600 text-sm leading-relaxed mb-2">{para}</p>
                ))}
              </div>
            )}

            {/* Languages */}
            {advisor.languages.length > 0 && (
              <div className="mb-6">
                <h3 className="font-heading font-semibold text-ink-900 mb-2">Languages</h3>
                <div className="flex gap-2">
                  {advisor.languages.map((lang) => (
                    <Badge key={lang} variant="default">{lang}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Verification. The two specific credentials that used to sit here
                ("Ph.D. in Clinical Psychology", a license number) were hardcoded
                and would now be claimed by every advisor alike; `isVerified` is
                the only credential signal the API actually returns. */}
            {advisor.isVerified && (
              <div className="mb-6">
                <h3 className="font-heading font-semibold text-ink-900 mb-3">Credentials</h3>
                <div className="flex items-start gap-3 p-3 bg-pine-100 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CheckCircle className="w-4 h-4 text-pine-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink-900">Credentials verified</p>
                    <p className="text-xs text-ink-500">
                      Qualifications and identity checked by AdvisorConnect. Documents are kept private.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Reviews */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-heading font-semibold text-ink-900">
                  Reviews <span className="text-ink-400 font-normal">({reviewTotal})</span>
                </h3>
                <div className="flex items-center gap-3">
                  {reviewableBooking && (
                    <Button variant="outline" size="sm" onClick={() => setReviewModalOpen(true)}>
                      <Star className="w-4 h-4" />
                      Leave a review
                    </Button>
                  )}
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-warn-500 fill-warn-500" />
                    <span className="font-semibold text-ink-900">{advisor.rating}</span>
                  </div>
                </div>
              </div>

              {reviewsQuery.isError ? (
                <ErrorBanner
                  message={getErrorMessage(reviewsQuery.error)}
                  onRetry={() => void reviewsQuery.refetch()}
                />
              ) : reviewsQuery.isLoading ? (
                <div className="space-y-4" role="status" aria-label="Loading reviews">
                  {Array.from({ length: 2 }, (_, i) => (
                    <div key={i} className="border border-ink-100 rounded-xl p-4 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))}
                </div>
              ) : reviews.length === 0 ? (
                <EmptyState
                  title="No reviews yet"
                  description="This advisor hasn't been reviewed yet."
                  className="py-8"
                />
              ) : (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div key={review.id} className="border border-ink-100 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ background: review.reviewerColor }}
                          >
                            {review.reviewerUsername.replace('@', '').slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm font-semibold text-ink-800">{review.reviewerUsername}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: review.rating }).map((_, i) => (
                            <Star key={i} className="w-3 h-3 text-warn-500 fill-warn-500" />
                          ))}
                          <span className="text-xs text-ink-400 ml-1">{formatReviewDate(review.createdAt)}</span>
                        </div>
                      </div>
                      <p className="text-sm text-ink-600 leading-relaxed">{review.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-ink-200 px-4 py-4 flex gap-3 max-w-4xl mx-auto">
        <Button
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={() => navigate(`/chat/${advisor.id}`)}
        >
          <MessageCircle className="w-4 h-4" />
          Free Chat
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          onClick={() => navigate(`/book/${advisor.id}`)}
        >
          <Video className="w-4 h-4" />
          Book Video $39
        </Button>
      </div>
      {/* Spacer for sticky bar */}
      <div className="h-24" />

      {reviewModalOpen && reviewableBooking && (
        <ReviewModal
          advisorId={advisor.id}
          bookingId={reviewableBooking.id}
          advisorUsername={advisor.username}
          onClose={() => setReviewModalOpen(false)}
        />
      )}
    </div>
  )
}
