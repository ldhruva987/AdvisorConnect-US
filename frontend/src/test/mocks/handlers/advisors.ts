import { http, HttpResponse } from 'msw'
import type {
  AdvisorApplicationDetailDto,
  AdvisorApplicationSummaryDto,
  AdvisorPublicDto,
  AdvisorReviewDto,
  Page,
} from '@/types/api'

/**
 * Advisor search / profile / reviews / applications.
 *
 * `GET /advisors` and `GET /advisors/{username}` are real today; reviews and
 * the admin application list are pending backend Phases 9 and 5 respectively
 * and are mocked here against their target shapes.
 *
 * Fixtures are deliberately tiny (three advisors, two reviews) and chosen so
 * every filter dimension the UI exposes is distinguishable: different sectors,
 * different `q`-matchable text, one unverified/offline advisor.
 */

export const MOCK_ADVISOR_DTOS: AdvisorPublicDto[] = [
  {
    id: 'advisor-1',
    username: 'maya_chen',
    professionalTitle: 'Career Transition Coach',
    bio: 'Fifteen years helping people leave jobs that no longer fit.',
    tags: ['interviewing', 'negotiation'],
    sectors: ['CAREER'],
    languages: ['English', 'Mandarin'],
    averageRating: 4.8,
    reviewCount: 132,
    chatCount: 940,
    responseTimeMinutes: 12,
    experienceYears: 15,
    isOnline: true,
    isVerified: true,
    avatarColor: '#005e8f',
  },
  {
    id: 'advisor-2',
    username: 'sam_okafor',
    professionalTitle: 'Licensed Therapist',
    bio: 'Anxiety, burnout, and the space between the two.',
    tags: ['anxiety', 'burnout'],
    sectors: ['MENTAL_HEALTH', 'LIFE_COACHING'],
    languages: ['English'],
    averageRating: 4.9,
    reviewCount: 87,
    chatCount: 410,
    responseTimeMinutes: 30,
    experienceYears: 9,
    isOnline: false,
    isVerified: true,
    avatarColor: '#4d4f94',
  },
  {
    id: 'advisor-3',
    username: 'rio_alvarez',
    professionalTitle: 'Financial Planner',
    bio: 'Debt, savings, and first-time investing without the jargon.',
    tags: ['budgeting', 'investing'],
    sectors: ['FINANCE'],
    languages: ['English', 'Spanish'],
    averageRating: 4.6,
    reviewCount: 41,
    chatCount: 205,
    responseTimeMinutes: 45,
    experienceYears: 6,
    isOnline: true,
    isVerified: false,
    avatarColor: '#516000',
  },
]

export const MOCK_REVIEW_DTOS: AdvisorReviewDto[] = [
  {
    id: 'review-1',
    reviewerUsername: 'quiet_fox',
    reviewerColor: '#8a3f24',
    rating: 5,
    text: 'Gave me a concrete plan in one session.',
    createdAt: '2026-07-01T10:00:00Z',
  },
  {
    id: 'review-2',
    reviewerUsername: 'ninth_wave',
    reviewerColor: '#73417e',
    rating: 4,
    text: 'Good listener, practical advice.',
    createdAt: '2026-06-18T14:30:00Z',
  },
]

export const MOCK_APPLICATION_DTOS: AdvisorApplicationSummaryDto[] = [
  {
    id: 'application-1',
    username: 'noor_haddad',
    professionalTitle: 'Parenting Consultant',
    bio: 'Sleep, boundaries, and the toddler years.',
    sectors: ['PARENTING'],
    qualification: 'MA Child Development',
    experienceYears: '5-10',
    previousWork: 'Community family centre, 2018-2024.',
    licenseVerified: false,
    status: 'PENDING',
    submittedAt: '2026-07-20T09:00:00Z',
    docCount: 3,
    avatarColor: '#784f00',
    legalName: 'Noor Haddad',
  },
  {
    id: 'application-2',
    username: 'dev_kapoor',
    professionalTitle: 'Wellness Coach',
    bio: 'Habit design for people who hate habit trackers.',
    sectors: ['HEALTH_WELLNESS', 'LIFE_COACHING'],
    qualification: 'BSc Nutrition',
    experienceYears: '2-5',
    previousWork: 'Independent practice since 2021.',
    licenseVerified: false,
    status: 'UNDER_REVIEW',
    submittedAt: '2026-07-22T16:45:00Z',
    docCount: 2,
    avatarColor: '#006970',
    legalName: 'Devansh Kapoor',
  },
]

/**
 * `GET /advisors/applications/{id}` fixtures — REAL backend endpoint, admin-only.
 *
 * Kept field-for-field consistent with the matching {@link MOCK_APPLICATION_DTOS} entry (same
 * `bio`, `qualification`, doc count, and `legalName` split into first/last) so tests asserting on
 * the summary and the detail view see the same applicant.
 */
export const MOCK_APPLICATION_DETAIL_DTOS: AdvisorApplicationDetailDto[] = [
  {
    id: 'application-1',
    userId: 'user-noor',
    username: 'noor_haddad',
    professionalTitle: 'Parenting Consultant',
    bio: 'Sleep, boundaries, and the toddler years.',
    sectors: ['PARENTING'],
    qualification: 'MA Child Development',
    fieldOfStudy: 'Child Development',
    experienceYears: '5-10',
    previousWork: 'Community family centre, 2018-2024.',
    legalFirstName: 'Noor',
    legalLastName: 'Haddad',
    dateOfBirth: '1988-04-02',
    addressFull: '1 Example Street, Dublin',
    country: 'IE',
    licenseVerified: false,
    documents: [
      { fileName: 'degree.pdf', mimeType: 'application/pdf', sizeBytes: 204_800, uploadedAt: '2026-07-20T09:00:00Z' },
      { fileName: 'id-front.png', mimeType: 'image/png', sizeBytes: 51_200, uploadedAt: '2026-07-20T09:00:00Z' },
      { fileName: 'id-back.png', mimeType: 'image/png', sizeBytes: 51_200, uploadedAt: '2026-07-20T09:00:00Z' },
    ],
    status: 'PENDING',
    submittedAt: '2026-07-20T09:00:00Z',
  },
  {
    id: 'application-2',
    userId: 'user-dev',
    username: 'dev_kapoor',
    professionalTitle: 'Wellness Coach',
    bio: 'Habit design for people who hate habit trackers.',
    sectors: ['HEALTH_WELLNESS', 'LIFE_COACHING'],
    qualification: 'BSc Nutrition',
    fieldOfStudy: 'Nutrition Science',
    experienceYears: '2-5',
    previousWork: 'Independent practice since 2021.',
    legalFirstName: 'Devansh',
    legalLastName: 'Kapoor',
    dateOfBirth: '1994-11-15',
    addressFull: '22 MG Road, Bengaluru',
    country: 'IN',
    licenseVerified: false,
    documents: [
      { fileName: 'certificate.pdf', mimeType: 'application/pdf', sizeBytes: 153_600, uploadedAt: '2026-07-22T16:45:00Z' },
      { fileName: 'id-front.png', mimeType: 'image/png', sizeBytes: 51_200, uploadedAt: '2026-07-22T16:45:00Z' },
    ],
    status: 'UNDER_REVIEW',
    submittedAt: '2026-07-22T16:45:00Z',
  },
]

function page<T>(content: T[], pageNumber = 0, size = 20): Page<T> {
  return {
    content,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : Math.ceil(content.length / size),
    number: pageNumber,
    size,
  }
}

export const advisorHandlers = [
  // ── Applications list (backend Phase 5) ─────────────────────────────────
  // MUST precede the `/:username` handler below: MSW matches in order, and
  // `/advisors/applications` would otherwise be swallowed as a username.
  http.get('*/api/advisors/applications', ({ request }) => {
    const status = new URL(request.url).searchParams.get('status')
    const content = status
      ? MOCK_APPLICATION_DTOS.filter((a) => a.status === status)
      : MOCK_APPLICATION_DTOS
    return HttpResponse.json(page(content))
  }),

  // ── Application detail (REAL today, admin-only) ─────────────────────────
  // MUST also precede `/:username` below, for the same reason as the list handler above.
  http.get('*/api/advisors/applications/:id', ({ params }) => {
    const detail = MOCK_APPLICATION_DETAIL_DTOS.find((a) => a.id === params.id)
    if (!detail) return HttpResponse.json({ message: 'Application not found' }, { status: 404 })
    return HttpResponse.json(detail)
  }),

  http.put('*/api/advisors/applications/:id/verify-license', () => new HttpResponse(null, { status: 200 })),

  // ── Reviews (backend Phase 9) ───────────────────────────────────────────
  http.get('*/api/advisors/:advisorId/reviews', () => HttpResponse.json(page(MOCK_REVIEW_DTOS))),

  http.post('*/api/advisors/:advisorId/reviews', async ({ request }) => {
    const body = (await request.json()) as { bookingId: string; rating: number; text: string }
    return HttpResponse.json(
      {
        id: 'review-new',
        reviewerUsername: 'test_user',
        reviewerColor: '#843b61',
        rating: body.rating,
        text: body.text,
        createdAt: '2026-08-01T12:00:00Z',
      } satisfies AdvisorReviewDto,
      { status: 201 },
    )
  }),

  // ── Onboarding application submission (real today) ──────────────────────
  http.post('*/api/advisors/apply', () => HttpResponse.json('application-new', { status: 201 })),

  // ── Search (real today) ─────────────────────────────────────────────────
  http.get('*/api/advisors', ({ request }) => {
    const params = new URL(request.url).searchParams
    const sector = params.get('sector')
    const q = params.get('q')?.toLowerCase()

    let content = MOCK_ADVISOR_DTOS
    if (sector) content = content.filter((a) => a.sectors.includes(sector as never))
    if (q) {
      content = content.filter(
        (a) =>
          a.username.toLowerCase().includes(q) ||
          a.professionalTitle.toLowerCase().includes(q) ||
          a.bio.toLowerCase().includes(q),
      )
    }

    return HttpResponse.json(page(content, Number(params.get('page') ?? 0)))
  }),

  // ── Profile by username (real today) ────────────────────────────────────
  http.get('*/api/advisors/:username', ({ params }) => {
    const advisor = MOCK_ADVISOR_DTOS.find((a) => a.username === params.username)
    if (!advisor) return HttpResponse.json({ message: 'Advisor not found' }, { status: 404 })
    return HttpResponse.json(advisor)
  }),
]
