import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { server } from '@/test/mocks/server'
import { MOCK_APPLICATION_DETAIL_DTOS, MOCK_APPLICATION_DTOS } from '@/test/mocks/handlers/advisors'
import { Toaster } from '@/shared/components/ui/Toast'
import { render, screen, waitFor, within } from '@/test/test-utils'
import type {
  AdminStatsDto,
  AdvisorApplicationDetailDto,
  AdvisorApplicationSummaryDto,
  Page,
} from '@/types/api'
import { AdminDashboardPage } from './AdminDashboardPage'

/**
 * The two fixture applications differ in every field the detail panel renders
 * (`application-1` / noor_haddad / PENDING vs `application-2` / dev_kapoor /
 * UNDER_REVIEW). That is load-bearing for the regression test below: the bug
 * being guarded against rendered `MOCK_APPLICATIONS[0]` for every row, so a
 * fixture set where the rows looked alike would not have caught it.
 */
const [FIRST_APPLICATION, SECOND_APPLICATION] = MOCK_APPLICATION_DTOS

/**
 * `Toaster` is mounted next to the page because it lives at the app root in
 * production. Asserting on rendered toast text rather than on
 * `useToastStore.getState()` keeps these tests about what an admin sees.
 */
function renderAdmin() {
  return render(
    <>
      <AdminDashboardPage />
      <Toaster />
    </>,
  )
}

function pageOf(content: AdvisorApplicationSummaryDto[]): Page<AdvisorApplicationSummaryDto> {
  return { content, totalElements: content.length, totalPages: 1, number: 0, size: 20 }
}

/**
 * Swap in a stats response with all four figures populated. The default
 * handler mirrors today's partial backend (`approvedAdvisors` only), which is
 * right for the hook's own tests but leaves three of the four tiles at the
 * `0` fallback — useless for proving a tile renders the value it was given.
 */
const FULL_STATS: AdminStatsDto = {
  pendingApplications: 7,
  activeAdvisors: 42,
  totalUsers: 1284,
  platformRevenue: 953_400, // minor units → $9,534
}

function useFullStats() {
  server.use(http.get('*/api/admin/stats', () => HttpResponse.json(FULL_STATS)))
}

function failStats(message = 'Stats unavailable') {
  server.use(
    http.get('*/api/admin/stats', () => HttpResponse.json({ message }, { status: 500 })),
  )
}

/**
 * Replaces the application-list handler with one that records every request,
 * so a refetch is assertable as a real second network call rather than
 * inferred from the DOM.
 */
function captureApplicationRequests(): URL[] {
  const urls: URL[] = []
  server.use(
    http.get('*/api/advisors/applications', ({ request }) => {
      const url = new URL(request.url)
      urls.push(url)
      const status = url.searchParams.get('status')
      return HttpResponse.json(
        pageOf(status ? MOCK_APPLICATION_DTOS.filter((a) => a.status === status) : MOCK_APPLICATION_DTOS),
      )
    }),
  )
  return urls
}

interface DecisionCall {
  id: string
  decision: string
  notes: unknown
}

/** Records approve/reject calls so the id and notes actually sent are assertable. */
function captureDecisions(status = 204): DecisionCall[] {
  const calls: DecisionCall[] = []
  server.use(
    http.put('*/api/advisors/applications/:id/:decision', async ({ request, params }) => {
      const body = (await request.json()) as { notes?: unknown } | null
      calls.push({
        id: String(params.id),
        decision: String(params.decision),
        notes: body?.notes,
      })
      if (status !== 204) {
        return HttpResponse.json({ message: 'Decision rejected by server' }, { status })
      }
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

/**
 * The tile whose label is `label`. Scoped lookups matter here: the pending
 * count also appears in the sidebar badge, so a bare `getByText('7')` is
 * ambiguous — and would still pass if the tile rendered nothing.
 */
function statTile(label: string): HTMLElement {
  // Scoped through the grid rather than looked up globally: "Pending
  // Applications" is both a tile label and the preview card's heading.
  // "Active Advisors" appears only on a tile, so it locates the grid.
  const grid = screen.getByText('Active Advisors').parentElement!.parentElement as HTMLElement
  return within(grid).getByText(label).parentElement as HTMLElement
}

/** Navigate from the overview to the full Applications table. */
async function openApplicationsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^applications/i }))
  return screen.findByRole('button', { name: `Review ${SECOND_APPLICATION.username}` })
}

describe('AdminDashboardPage', () => {
  /* ---------------------------------------------------------------------- */
  /* Stat cards                                                             */
  /* ---------------------------------------------------------------------- */

  describe('stat cards', () => {
    it('renders the figures returned by /admin/stats', async () => {
      useFullStats()
      renderAdmin()

      // Minor units are divided down, not printed raw.
      expect(await screen.findByText('$9,534')).toBeInTheDocument()
      expect(screen.queryByText('953400')).not.toBeInTheDocument()
      expect(within(statTile('Pending Applications')).getByText('7')).toBeInTheDocument()
      expect(within(statTile('Active Advisors')).getByText('42')).toBeInTheDocument()
      expect(within(statTile('Total Users')).getByText('1,284')).toBeInTheDocument()
    })

    it('shows placeholders before the request settles, not zeroes', () => {
      useFullStats()
      renderAdmin()

      expect(screen.queryByText('1,284')).not.toBeInTheDocument()
      expect(screen.queryByText('0')).not.toBeInTheDocument()
    })

    it('surfaces a retryable error and renders no invented figures when stats fail', async () => {
      failStats()
      renderAdmin()

      const banner = await screen.findByRole('alert')
      expect(within(banner).getByText('Stats unavailable')).toBeInTheDocument()
      expect(within(banner).getByRole('button', { name: /try again/i })).toBeInTheDocument()
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    })

    it('badges the Applications nav with the real pending count', async () => {
      useFullStats()
      renderAdmin()

      // The badge is part of the button's accessible name once it renders, so
      // waiting on the name proves the count came from the stats response
      // rather than the hardcoded "3" the old sidebar shipped.
      expect(await screen.findByRole('button', { name: 'Applications 7' })).toBeInTheDocument()
    })
  })

  /* ---------------------------------------------------------------------- */
  /* Applications table                                                     */
  /* ---------------------------------------------------------------------- */

  describe('applications table', () => {
    it('previews only pending applications on the overview', async () => {
      renderAdmin()

      expect(await screen.findByText(FIRST_APPLICATION.username)).toBeInTheDocument()
      // `application-2` is UNDER_REVIEW, so the pending preview must exclude it.
      expect(screen.queryByText(SECOND_APPLICATION.username)).not.toBeInTheDocument()
    })

    it('lists every application on the Applications tab', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)

      expect(screen.getByText(FIRST_APPLICATION.username)).toBeInTheDocument()
      expect(screen.getByText(SECOND_APPLICATION.username)).toBeInTheDocument()
    })

    it('filters server-side — the status goes on the request, not through a client array', async () => {
      const user = userEvent.setup()
      const urls = captureApplicationRequests()
      renderAdmin()
      await openApplicationsTab(user)

      await user.click(screen.getByRole('button', { name: 'Under Review' }))

      await waitFor(() => {
        expect(urls.some((u) => u.searchParams.get('status') === 'UNDER_REVIEW')).toBe(true)
      })
      await waitFor(() => {
        expect(screen.queryByText(FIRST_APPLICATION.username)).not.toBeInTheDocument()
      })
      expect(screen.getByText(SECOND_APPLICATION.username)).toBeInTheDocument()
    })

    it('shows an empty state rather than a blank table when a filter matches nothing', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)

      await user.click(screen.getByRole('button', { name: 'Rejected' }))

      expect(await screen.findByText(/no applications match this filter/i)).toBeInTheDocument()
    })
  })

  /* ---------------------------------------------------------------------- */
  /* The headline regression                                                */
  /* ---------------------------------------------------------------------- */

  describe('detail panel row selection', () => {
    /**
     * REGRESSION: the detail view used to read `MOCK_APPLICATIONS[0]`, so every
     * "Review" click — whichever row it came from — opened the first applicant.
     * An admin could approve the wrong person while looking at someone else's
     * credentials.
     */
    it('opens the application whose row was clicked, not the first one', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)

      await user.click(screen.getByRole('button', { name: `Review ${SECOND_APPLICATION.username}` }))

      expect(await screen.findByText(SECOND_APPLICATION.bio!)).toBeInTheDocument()
      expect(screen.getByText(SECOND_APPLICATION.legalName!)).toBeInTheDocument()
      expect(screen.getByText(SECOND_APPLICATION.qualification!)).toBeInTheDocument()
      // The first applicant must be nowhere in the detail view.
      expect(screen.queryByText(FIRST_APPLICATION.bio!)).not.toBeInTheDocument()
      expect(screen.queryByText(FIRST_APPLICATION.legalName!)).not.toBeInTheDocument()
    })

    it('re-targets when a different row is reviewed, so the panel is not sticky', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)

      await user.click(screen.getByRole('button', { name: `Review ${SECOND_APPLICATION.username}` }))
      expect(await screen.findByText(SECOND_APPLICATION.legalName!)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /back to applications/i }))
      await user.click(screen.getByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))

      expect(await screen.findByText(FIRST_APPLICATION.legalName!)).toBeInTheDocument()
      expect(screen.queryByText(SECOND_APPLICATION.legalName!)).not.toBeInTheDocument()
    })

    it('shows the applicant PII the detail endpoint now actually returns', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)
      await user.click(screen.getByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))

      // GET /advisors/applications/{id} is real now — date of birth and address used to be
      // unavailable to the detail panel entirely; now they render from the real response.
      expect(await screen.findByText('1988-04-02')).toBeInTheDocument()
      expect(screen.getByText('1 Example Street, Dublin')).toBeInTheDocument()
    })

    it('reports the real document list, not a fabricated one', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)
      await user.click(screen.getByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))

      expect(await screen.findByText('Submitted Documents (3)')).toBeInTheDocument()
      expect(screen.getByText('degree.pdf')).toBeInTheDocument()
      expect(screen.getByText(/document viewing.*is not available yet/i)).toBeInTheDocument()
    })
  })

  /* ---------------------------------------------------------------------- */
  /* License verification (Finance / Mental Health applications only)      */
  /* ---------------------------------------------------------------------- */

  describe('license verification', () => {
    const UNVERIFIED_FINANCE_SUMMARY: AdvisorApplicationSummaryDto = {
      ...FIRST_APPLICATION,
      id: 'application-finance',
      username: 'rae_finch',
      sectors: ['FINANCE'],
      licenseVerified: false,
    }

    const UNVERIFIED_FINANCE_DETAIL: AdvisorApplicationDetailDto = {
      ...MOCK_APPLICATION_DETAIL_DTOS[0],
      id: 'application-finance',
      username: 'rae_finch',
      sectors: ['FINANCE'],
      licenseNumber: 'CPA-99231',
      licenseIssuingAuthority: 'State Board of Accountancy',
      licenseState: 'CA',
      licenseVerified: false,
    }

    function useUnverifiedFinanceApplication() {
      server.use(
        http.get('*/api/advisors/applications', () =>
          HttpResponse.json(pageOf([UNVERIFIED_FINANCE_SUMMARY])),
        ),
        http.get('*/api/advisors/applications/:id', ({ params }) =>
          params.id === 'application-finance'
            ? HttpResponse.json(UNVERIFIED_FINANCE_DETAIL)
            : HttpResponse.json({ message: 'not found' }, { status: 404 }),
        ),
      )
    }

    it('disables Approve for an unverified Finance application and explains why', async () => {
      const user = userEvent.setup()
      useUnverifiedFinanceApplication()
      renderAdmin()
      await user.click(screen.getByRole('button', { name: /^applications/i }))
      await user.click(await screen.findByRole('button', { name: 'Review rae_finch' }))

      expect(await screen.findByText('Not Verified')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /approve application/i })).toBeDisabled()
      expect(
        screen.getByText(/license must be verified before this application can be approved/i),
      ).toBeInTheDocument()
    })

    it('marking the license as verified enables Approve', async () => {
      const user = userEvent.setup()
      useUnverifiedFinanceApplication()
      server.use(
        http.put('*/api/advisors/applications/:id/verify-license', () =>
          new HttpResponse(null, { status: 200 }),
        ),
      )
      // Once verified, the detail refetch must reflect it — the mutation invalidates the
      // detail query, so the next GET has to answer differently from the first.
      let verified = false
      server.use(
        http.get('*/api/advisors/applications/:id', () =>
          HttpResponse.json({ ...UNVERIFIED_FINANCE_DETAIL, licenseVerified: verified }),
        ),
        http.put('*/api/advisors/applications/:id/verify-license', () => {
          verified = true
          return new HttpResponse(null, { status: 200 })
        }),
      )
      renderAdmin()
      await user.click(screen.getByRole('button', { name: /^applications/i }))
      await user.click(await screen.findByRole('button', { name: 'Review rae_finch' }))

      expect(await screen.findByText('Not Verified')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /mark license as verified/i }))

      expect(await screen.findByText('Verified')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /approve application/i })).toBeEnabled()
    })
  })

  /* ---------------------------------------------------------------------- */
  /* Decisions                                                              */
  /* ---------------------------------------------------------------------- */

  describe('approve / reject', () => {
    it('approves the selected application with the notes that were typed', async () => {
      const user = userEvent.setup()
      const calls = captureDecisions()
      renderAdmin()
      await openApplicationsTab(user)
      await user.click(screen.getByRole('button', { name: `Review ${SECOND_APPLICATION.username}` }))

      await user.type(await screen.findByLabelText(/admin notes/i), 'Credentials verified.')
      await user.click(screen.getByRole('button', { name: /approve application/i }))

      await waitFor(() => expect(calls).toHaveLength(1))
      // The id must be the reviewed row's, not the first application's.
      expect(calls[0]).toEqual({
        id: SECOND_APPLICATION.id,
        decision: 'approve',
        notes: 'Credentials verified.',
      })
      expect(calls[0].id).not.toBe(FIRST_APPLICATION.id)
    })

    it('confirms with a success toast and refetches the list', async () => {
      const user = userEvent.setup()
      const urls = captureApplicationRequests()
      captureDecisions()
      renderAdmin()
      await openApplicationsTab(user)
      const requestsBeforeDecision = urls.length

      await user.click(screen.getByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))
      await user.click(await screen.findByRole('button', { name: /approve application/i }))

      expect(await screen.findByText('Application approved.')).toBeInTheDocument()
      // `useApplicationDecision` invalidates ['applications'], so the table
      // reloads without a page refresh.
      await waitFor(() => expect(urls.length).toBeGreaterThan(requestsBeforeDecision))
      // …and drops back to the list rather than stranding the admin on a
      // detail panel for an application they just decided.
      expect(await screen.findByText(SECOND_APPLICATION.username)).toBeInTheDocument()
    })

    it('rejects through the reject endpoint, not the approve one', async () => {
      const user = userEvent.setup()
      const calls = captureDecisions()
      renderAdmin()
      await openApplicationsTab(user)
      await user.click(screen.getByRole('button', { name: `Review ${SECOND_APPLICATION.username}` }))

      await user.click(await screen.findByRole('button', { name: /reject application/i }))

      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0].decision).toBe('reject')
      expect(calls[0].id).toBe(SECOND_APPLICATION.id)
      expect(await screen.findByText('Application rejected.')).toBeInTheDocument()
    })

    it('decides straight from a table row without opening the detail panel', async () => {
      const user = userEvent.setup()
      const calls = captureDecisions()
      renderAdmin()
      await openApplicationsTab(user)

      await user.click(screen.getByRole('button', { name: `Approve ${SECOND_APPLICATION.username}` }))

      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0]).toEqual({ id: SECOND_APPLICATION.id, decision: 'approve', notes: '' })
    })

    it('reports a failed decision as an error and claims no success', async () => {
      const user = userEvent.setup()
      captureDecisions(500)
      renderAdmin()
      await openApplicationsTab(user)
      await user.click(screen.getByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))

      await user.click(await screen.findByRole('button', { name: /approve application/i }))

      expect(await screen.findByText('Decision rejected by server')).toBeInTheDocument()
      expect(screen.queryByText('Application approved.')).not.toBeInTheDocument()
      // Still on the detail panel — a failed decision must not look resolved.
      expect(screen.getByText(FIRST_APPLICATION.legalName!)).toBeInTheDocument()
    })

    it('offers no decision controls for an application already decided', async () => {
      const user = userEvent.setup()
      const approvedDetail = { ...MOCK_APPLICATION_DETAIL_DTOS[0], status: 'APPROVED' as const }
      server.use(
        http.get('*/api/advisors/applications', () =>
          HttpResponse.json(
            pageOf([{ ...FIRST_APPLICATION, status: 'APPROVED' } as AdvisorApplicationSummaryDto]),
          ),
        ),
        // The detail panel's status now comes from GET /advisors/applications/{id} directly,
        // not from the list cache — both have to agree for canDecide() to see APPROVED.
        http.get('*/api/advisors/applications/:id', () => HttpResponse.json(approvedDetail)),
      )
      renderAdmin()
      await user.click(screen.getByRole('button', { name: /^applications/i }))
      await user.click(await screen.findByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))

      expect(await screen.findByText(/this application was already approved/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /approve application/i })).not.toBeInTheDocument()
    })
  })

  /* ---------------------------------------------------------------------- */
  /* Honesty about what isn't built                                         */
  /* ---------------------------------------------------------------------- */

  describe('features with no backend yet', () => {
    it('shows an empty activity feed rather than fabricated events', async () => {
      renderAdmin()

      expect(await screen.findByText(/activity feed coming soon/i)).toBeInTheDocument()
    })

    it('renders "Request More Information" visibly disabled instead of as a dead button', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)
      await user.click(screen.getByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))

      const button = await screen.findByRole('button', { name: /request more information/i })
      expect(button).toBeDisabled()
      expect(within(button).getByText(/coming soon/i)).toBeInTheDocument()
    })

    it('replaces the no-op "Save Notes" button with an explanation of where notes go', async () => {
      const user = userEvent.setup()
      renderAdmin()
      await openApplicationsTab(user)
      await user.click(screen.getByRole('button', { name: `Review ${FIRST_APPLICATION.username}` }))

      expect(await screen.findByLabelText(/admin notes/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /save notes/i })).not.toBeInTheDocument()
      expect(screen.getByText(/notes are submitted with your approve or reject decision/i)).toBeInTheDocument()
    })

    it('sends unbuilt nav destinations to a coming-soon panel', async () => {
      const user = userEvent.setup()
      renderAdmin()

      await user.click(screen.getByRole('button', { name: /all advisors/i }))

      expect(await screen.findByText(/advisor directory is not available yet/i)).toBeInTheDocument()
    })
  })
})
