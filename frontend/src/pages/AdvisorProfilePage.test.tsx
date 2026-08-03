import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { server } from '@/test/mocks/server'
import { MOCK_ADVISOR_DTOS, MOCK_REVIEW_DTOS } from '@/test/mocks/handlers/advisors'
import { loginAs, render, screen, waitFor, within } from '@/test/test-utils'
import type { Booking } from '@/types'
import type { AdvisorReviewDto } from '@/types/api'
import { AdvisorProfilePage } from './AdvisorProfilePage'

/** Exposes the current pathname so CTA navigation targets are assertable. */
function LocationProbe() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

/**
 * Mounts the page under the real route pattern. `path` is required here: the
 * page reads `useParams()`, and without a matching route React Router hands back
 * an empty params object.
 */
function renderProfile(username: string) {
  return render(<AdvisorProfilePage />, {
    initialEntries: [`/advisor/${username}`],
    path: '/advisor/:username',
  })
}

/**
 * Same mount, but with the route table owned by the test so the probe survives
 * navigation. `renderProfile`'s `path` puts everything *inside* the matched
 * route, so a probe there unmounts the moment a CTA navigates away — leaving
 * nothing to assert against.
 */
function renderProfileForNavigation(username: string) {
  return render(
    <>
      <LocationProbe />
      <Routes>
        <Route path="/advisor/:username" element={<AdvisorProfilePage />} />
        <Route path="*" element={null} />
      </Routes>
    </>,
    { initialEntries: [`/advisor/${username}`] },
  )
}

function reviewPage(content: AdvisorReviewDto[]) {
  return {
    content,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
    number: 0,
    size: 20,
  }
}

describe('AdvisorProfilePage', () => {
  describe('resolving the advisor from the URL', () => {
    /**
     * The bug this covers: the page never called `useParams()`, so whichever
     * advisor you clicked in Explore, you landed on one fixed hardcoded
     * profile. Two distinct usernames are asserted because a page that ignores
     * the param still passes a single-username test.
     */
    it('renders maya_chen for /advisor/maya_chen', async () => {
      renderProfile('maya_chen')

      expect(await screen.findByRole('heading', { name: 'maya_chen' })).toBeInTheDocument()
      expect(screen.getByText('Career Transition Coach')).toBeInTheDocument()
      expect(screen.getByText(/Fifteen years helping people/)).toBeInTheDocument()
      // The other fixture advisors must not be on screen.
      expect(screen.queryByText('sam_okafor')).not.toBeInTheDocument()
      expect(screen.queryByText('Licensed Therapist')).not.toBeInTheDocument()
    })

    it('renders sam_okafor for /advisor/sam_okafor', async () => {
      renderProfile('sam_okafor')

      expect(await screen.findByRole('heading', { name: 'sam_okafor' })).toBeInTheDocument()
      expect(screen.getByText('Licensed Therapist')).toBeInTheDocument()
      expect(screen.getByText(/Anxiety, burnout/)).toBeInTheDocument()
      expect(screen.queryByText('maya_chen')).not.toBeInTheDocument()
      expect(screen.queryByText('Career Transition Coach')).not.toBeInTheDocument()
    })

    it('requests the username from the URL, not a hardcoded one', async () => {
      const requested: string[] = []
      server.use(
        http.get('*/api/advisors/:username', ({ params }) => {
          requested.push(String(params.username))
          const advisor = MOCK_ADVISOR_DTOS.find((a) => a.username === params.username)
          if (!advisor) return HttpResponse.json({ message: 'Advisor not found' }, { status: 404 })
          return HttpResponse.json(advisor)
        }),
      )
      renderProfile('rio_alvarez')

      await screen.findByRole('heading', { name: 'rio_alvarez' })
      expect(requested).toContain('rio_alvarez')
      // Never a request for a literal `undefined` — the hook's `enabled` guard.
      expect(requested).not.toContain('undefined')
    })
  })

  describe('profile content', () => {
    it('renders the stat row from API values', async () => {
      renderProfile('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })

      expect(screen.getByText('4.8★')).toBeInTheDocument()
      // chatCount 940 stays exact; only four figures and up are abbreviated.
      expect(screen.getByText('940')).toBeInTheDocument()
      expect(screen.getByText('12m')).toBeInTheDocument()
      expect(screen.getByText('15yr')).toBeInTheDocument()
    })

    it('abbreviates a four-figure chat count', async () => {
      server.use(
        http.get('*/api/advisors/:username', () =>
          HttpResponse.json({ ...MOCK_ADVISOR_DTOS[0], chatCount: 1247 }),
        ),
      )
      renderProfile('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })

      expect(screen.getByText('1.2k')).toBeInTheDocument()
    })

    it('renders sector labels and tags as badges', async () => {
      renderProfile('sam_okafor')
      await screen.findByRole('heading', { name: 'sam_okafor' })

      // Backend enums are mapped to display labels before they reach the page.
      expect(screen.getByText('Mental Health')).toBeInTheDocument()
      expect(screen.getByText('Life Coaching')).toBeInTheDocument()
      expect(screen.queryByText('MENTAL_HEALTH')).not.toBeInTheDocument()
      expect(screen.getByText('anxiety')).toBeInTheDocument()
      expect(screen.getByText('burnout')).toBeInTheDocument()
    })

    it('renders languages', async () => {
      renderProfile('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })

      expect(screen.getByRole('heading', { name: 'Languages' })).toBeInTheDocument()
      expect(screen.getByText('Mandarin')).toBeInTheDocument()
    })

    it('shows the online pill only for an online advisor', async () => {
      renderProfile('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })
      expect(screen.getByText('Online now')).toBeInTheDocument()
    })

    it('hides the online pill for an offline advisor', async () => {
      renderProfile('sam_okafor')
      await screen.findByRole('heading', { name: 'sam_okafor' })
      expect(screen.queryByText('Online now')).not.toBeInTheDocument()
    })

    it('claims no credential the API did not return', async () => {
      renderProfile('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })

      // `isVerified` is the only credential signal in the payload. The two
      // specific credentials that used to be hardcoded here would otherwise be
      // asserted for every advisor alike.
      expect(screen.getByText('Credentials verified')).toBeInTheDocument()
      const text = document.body.textContent ?? ''
      expect(text).not.toMatch(/Ph\.?D/i)
      expect(text).not.toMatch(/Clinical Psychology/i)
      expect(text).not.toMatch(/licen[cs]e (no|number|#)/i)
    })

    it('omits the credentials block for an unverified advisor', async () => {
      renderProfile('rio_alvarez')
      await screen.findByRole('heading', { name: 'rio_alvarez' })

      expect(screen.queryByText('Credentials verified')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Verified')).not.toBeInTheDocument()
    })
  })

  describe('crisis resources', () => {
    it('shows the 988 crisis banner for a Mental Health advisor', async () => {
      renderProfile('sam_okafor')
      await screen.findByRole('heading', { name: 'sam_okafor' })

      expect(screen.getByRole('note', { name: /crisis support resources/i })).toBeInTheDocument()
      expect(screen.getByText('988')).toBeInTheDocument()
    })

    it('does not show the crisis banner for an advisor outside Mental Health', async () => {
      renderProfile('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })

      expect(screen.queryByRole('note', { name: /crisis support resources/i })).not.toBeInTheDocument()
    })
  })

  describe('loading', () => {
    it('shows a profile skeleton before the request settles', () => {
      renderProfile('maya_chen')

      expect(screen.getByRole('status', { name: /loading advisor profile/i })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'maya_chen' })).not.toBeInTheDocument()
    })
  })

  describe('not found', () => {
    it('renders an EmptyState for an unknown username', async () => {
      renderProfile('nobody_here')

      // Title plus the server's own message, which happens to read the same.
      await waitFor(() => expect(screen.getAllByText('Advisor not found')).toHaveLength(2))
      expect(screen.getByRole('button', { name: /back to explore/i })).toBeInTheDocument()
      // No half-rendered profile chrome behind it.
      expect(screen.queryByRole('button', { name: /free chat/i })).not.toBeInTheDocument()
    })

    it('sends "Back to Explore" to /explore', async () => {
      const user = userEvent.setup()
      renderProfileForNavigation('nobody_here')

      await user.click(await screen.findByRole('button', { name: /back to explore/i }))

      expect(screen.getByTestId('pathname')).toHaveTextContent('/explore')
    })

    it('falls back to generic copy when the failure carries no message', async () => {
      server.use(
        http.get('*/api/advisors/:username', () => new HttpResponse(null, { status: 500 })),
      )
      renderProfile('maya_chen')

      expect(await screen.findByText('Advisor not found')).toBeInTheDocument()
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    })
  })

  describe('calls to action', () => {
    /**
     * The bug this covers: "Free Chat" navigated to a bare `/chat`, dropping the
     * advisor entirely and opening an empty inbox.
     */
    it('sends "Free Chat" to /chat/:id', async () => {
      const user = userEvent.setup()
      renderProfileForNavigation('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })

      await user.click(screen.getByRole('button', { name: /free chat/i }))

      expect(screen.getByTestId('pathname')).toHaveTextContent('/chat/advisor-1')
      expect(screen.getByTestId('pathname')).not.toHaveTextContent(/^\/chat$/)
    })

    it('carries the id of the advisor actually on screen, not a fixed one', async () => {
      const user = userEvent.setup()
      renderProfileForNavigation('rio_alvarez')
      await screen.findByRole('heading', { name: 'rio_alvarez' })

      await user.click(screen.getByRole('button', { name: /free chat/i }))

      expect(screen.getByTestId('pathname')).toHaveTextContent('/chat/advisor-3')
    })

    it('sends "Book Video" to /book/:id', async () => {
      const user = userEvent.setup()
      renderProfileForNavigation('maya_chen')
      await screen.findByRole('heading', { name: 'maya_chen' })

      await user.click(screen.getByRole('button', { name: /book video/i }))

      expect(screen.getByTestId('pathname')).toHaveTextContent('/book/advisor-1')
    })
  })

  describe('reviews', () => {
    it('renders reviews fetched for the resolved advisor id', async () => {
      const requestedIds: string[] = []
      server.use(
        http.get('*/api/advisors/:advisorId/reviews', ({ params }) => {
          requestedIds.push(String(params.advisorId))
          return HttpResponse.json(reviewPage(MOCK_REVIEW_DTOS))
        }),
      )
      renderProfile('maya_chen')

      expect(await screen.findByText('quiet_fox')).toBeInTheDocument()
      expect(screen.getByText('Gave me a concrete plan in one session.')).toBeInTheDocument()
      expect(screen.getByText('ninth_wave')).toBeInTheDocument()
      // Keyed off the advisor's id, which only exists once the profile resolved.
      expect(requestedIds).toEqual(['advisor-1'])
    })

    it('shows the review total from the reviews endpoint', async () => {
      renderProfile('maya_chen')
      await screen.findByText('quiet_fox')

      expect(screen.getByText('(2)')).toBeInTheDocument()
    })

    it('formats review dates', async () => {
      renderProfile('maya_chen')
      await screen.findByText('quiet_fox')

      expect(screen.getByText('Jul 1, 2026')).toBeInTheDocument()
    })

    it('shows an EmptyState when the advisor has no reviews', async () => {
      server.use(
        http.get('*/api/advisors/:advisorId/reviews', () => HttpResponse.json(reviewPage([]))),
      )
      renderProfile('maya_chen')

      expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
    })

    it('shows an ErrorBanner with a working retry when reviews fail', async () => {
      let attempt = 0
      server.use(
        http.get('*/api/advisors/:advisorId/reviews', () => {
          attempt += 1
          if (attempt === 1) return new HttpResponse(null, { status: 500 })
          return HttpResponse.json(reviewPage(MOCK_REVIEW_DTOS))
        }),
      )
      const user = userEvent.setup()
      renderProfile('maya_chen')

      const banner = await screen.findByRole('alert')
      expect(banner).toHaveTextContent('Something went wrong. Please try again.')
      // A failed reviews fetch must not take the whole profile down.
      expect(screen.getByRole('heading', { name: 'maya_chen' })).toBeInTheDocument()

      await user.click(within(banner).getByRole('button', { name: /try again/i }))

      expect(await screen.findByText('quiet_fox')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  /**
   * Eligibility is inferred client-side from `useMyBookings()`: the contract
   * exposes no "can I review this advisor" flag and `Booking` has no
   * review-linkage field, so "a COMPLETED booking with this advisor" is the
   * strongest signal available. The backend's duplicate rejection is the real
   * guard; these tests pin the inference, not a guarantee.
   */
  describe('leave-a-review CTA', () => {
    function bookingWith(advisorId: string, status: Booking['status']): Booking {
      return {
        id: `booking-${advisorId}-${status}`,
        advisorId,
        advisorUsername: 'maya_chen',
        sessionDate: '2026-07-02T15:00:00Z',
        durationMinutes: 60,
        amountCharged: 9000,
        status,
        createdAt: '2026-06-28T11:20:00Z',
      }
    }

    function serveMyBookings(bookings: Booking[]) {
      server.use(http.get('*/api/bookings/me', () => HttpResponse.json(bookings)))
    }

    const cta = () => screen.queryByRole('button', { name: /leave a review/i })

    it('appears when the viewer has a completed booking with this advisor', async () => {
      loginAs()
      serveMyBookings([bookingWith('advisor-1', 'COMPLETED')])
      renderProfile('maya_chen')

      await screen.findByRole('heading', { name: 'maya_chen' })
      await waitFor(() => expect(cta()).toBeInTheDocument())
    })

    it('is absent for a signed-out visitor', async () => {
      renderProfile('maya_chen')

      await screen.findByText('quiet_fox')
      expect(cta()).not.toBeInTheDocument()
    })

    /** `/bookings/me` is authenticated; a public page must not call it blind. */
    it('does not request the viewer bookings when signed out', async () => {
      let calls = 0
      server.use(
        http.get('*/api/bookings/me', () => {
          calls += 1
          return HttpResponse.json([])
        }),
      )
      renderProfile('maya_chen')

      await screen.findByText('quiet_fox')
      expect(calls).toBe(0)
    })

    it('is absent when the completed booking belongs to a different advisor', async () => {
      loginAs()
      serveMyBookings([bookingWith('advisor-2', 'COMPLETED')])
      renderProfile('maya_chen')

      await screen.findByText('quiet_fox')
      await waitFor(() => expect(screen.getByRole('heading', { name: 'maya_chen' })).toBeInTheDocument())
      expect(cta()).not.toBeInTheDocument()
    })

    it('is absent when the booking with this advisor has not completed', async () => {
      loginAs()
      serveMyBookings([bookingWith('advisor-1', 'CONFIRMED')])
      renderProfile('maya_chen')

      await screen.findByText('quiet_fox')
      expect(cta()).not.toBeInTheDocument()
    })

    it('opens ReviewModal for the eligible booking and submits against this advisor', async () => {
      const submitted: Array<{ advisorId: string; bookingId: string }> = []
      server.use(
        http.post('*/api/advisors/:advisorId/reviews', async ({ request, params }) => {
          const body = (await request.json()) as { bookingId: string }
          submitted.push({ advisorId: String(params.advisorId), bookingId: body.bookingId })
          return HttpResponse.json({ id: 'review-new' }, { status: 201 })
        }),
      )
      loginAs()
      serveMyBookings([bookingWith('advisor-1', 'COMPLETED')])
      const user = userEvent.setup()
      renderProfile('maya_chen')

      await screen.findByRole('heading', { name: 'maya_chen' })
      await waitFor(() => expect(cta()).toBeInTheDocument())
      await user.click(cta()!)

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText(/session with maya_chen/)).toBeInTheDocument()

      await user.click(within(dialog).getByRole('radio', { name: '5 stars' }))
      await user.click(within(dialog).getByRole('button', { name: /submit review/i }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(submitted).toEqual([
        { advisorId: 'advisor-1', bookingId: 'booking-advisor-1-COMPLETED' },
      ])
    })
  })
})
