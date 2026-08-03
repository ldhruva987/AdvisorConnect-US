import type { AdvisorSectorEnum } from '@/lib/sectors'
import type { ApplicationStatus, Booking, SessionDuration } from '@/types'

/**
 * Wire shapes exactly as the backend emits them.
 *
 * Kept separate from `@/types` (which holds the shapes the *UI* renders)
 * because several of them differ: `AdvisorPublicDto.professionalTitle` vs
 * `AdvisorPublic.title`, enum sectors vs label sectors, and so on. Hooks own
 * the translation between the two so pages never see a DTO.
 */

/** Spring Data's `Page<T>` envelope. */
export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  number: number
  size: number
  first?: boolean
  last?: boolean
  empty?: boolean
}

/** `POST /auth/login` and `POST /auth/register`. */
export interface TokenResponse {
  accessToken: string
  refreshToken: string
  userId: string
  role: 'user' | 'advisor' | 'admin'
  expiresIn: number
}

/** `GET /advisors` (paged) and `GET /advisors/{username}`. */
export interface AdvisorPublicDto {
  id: string
  username: string
  professionalTitle: string
  bio: string
  tags: string[]
  /** Backend enum values, e.g. `"MENTAL_HEALTH"`. */
  sectors: AdvisorSectorEnum[]
  languages: string[]
  averageRating: number
  reviewCount: number
  chatCount: number
  responseTimeMinutes: number
  experienceYears: number
  isOnline: boolean
  isVerified: boolean
  avatarColor: string
}

/** `GET /advisors/{id}/reviews` — pending backend Phase 9. */
export interface AdvisorReviewDto {
  id: string
  reviewerUsername: string
  reviewerColor: string
  rating: number
  text: string
  createdAt: string
}

/**
 * `POST /advisors/{id}/reviews` body — pending backend Phase 9.
 *
 * `bookingId` is required because the backend gates review creation on a
 * completed, not-yet-reviewed booking between this reviewer and this advisor.
 */
export interface SubmitReviewRequest {
  bookingId: string
  rating: number
  text: string
}

/** `POST /bookings/availability` is a GET; this is `POST /bookings/payment-intent`. */
export interface CreatePaymentIntentRequest {
  advisorId: string
  durationMinutes: SessionDuration
  /** ISO-8601 instant for the chosen slot, as returned by the availability API. */
  slot: string
}

/** `POST /bookings/payment-intent` — pending backend Phase 4. */
export interface PaymentIntentResponse {
  clientSecret: string
  /** Minor units (cents), as Stripe reports them. */
  amount: number
}

/** `POST /bookings` request body. */
export interface CreateBookingRequest {
  advisorId: string
  /** ISO-8601 instant for the start of the session. */
  sessionDateTime: string
  durationMinutes: SessionDuration
  stripePaymentMethodId?: string
}

/**
 * `POST /bookings` response — deliberately a union, because this endpoint's
 * shape is mid-migration.
 *
 * TODAY the backend returns a bare `Booking`. Once backend Phase 4 (real
 * Stripe PaymentIntents) lands it returns `{ booking, clientSecret }` so the
 * client can confirm the payment. Modelling both here means the switchover is
 * absorbed entirely by `normalizeCreateBookingResponse` in
 * `features/booking/hooks/useCreateBooking.ts` — no caller changes, and no
 * window where the frontend is broken against one shape or the other.
 */
export type CreateBookingResponse = Booking | { booking: Booking; clientSecret: string }

/** `GET /chats` — pending backend Phase 8. */
export interface ConversationDto {
  id: string
  advisorId: string
  advisorUsername: string
  advisorColor: string
  lastMessage: string
  lastMessageAt: string
  unreadCount: number
  isAdvisorOnline: boolean
}

/** `GET /chats/{advisorId}/messages` — pending backend Phase 8. */
export interface MessageDto {
  id: string
  conversationId: string
  senderId: string
  senderType: 'user' | 'advisor'
  text: string
  createdAt: string
}

/** `GET /advisors/applications` — pending backend Phase 5. */
export interface AdvisorApplicationSummaryDto {
  id: string
  username: string
  professionalTitle: string
  bio: string
  sectors: AdvisorSectorEnum[]
  qualification: string
  experienceYears: string
  previousWork: string
  /** Non-null only when `sectors` includes FINANCE or MENTAL_HEALTH. */
  licenseIssuingAuthority?: string
  licenseState?: string
  licenseVerified: boolean
  status: ApplicationStatus
  submittedAt: string
  docCount: number
  avatarColor: string
  legalName?: string
}

/**
 * `GET /advisors/applications/{id}` — REAL backend endpoint, admin-only.
 *
 * The full application record: everything {@link AdvisorApplicationSummaryDto} withholds
 * (legal name, DOB, address, country, license number, document metadata) because the summary is a
 * PII-free triage list and this is the actual review screen. `documents` never carries the S3 key
 * — see the backend DTO's javadoc — so full document *viewing* still isn't available, only
 * filename/type/size/upload time.
 */
export interface AdvisorApplicationDetailDto {
  id: string
  userId: string
  username: string
  professionalTitle: string
  bio: string
  sectors: AdvisorSectorEnum[]
  qualification: string
  fieldOfStudy: string
  experienceYears: string
  previousWork: string

  legalFirstName: string
  legalLastName: string
  dateOfBirth: string
  addressFull: string
  country: string

  licenseNumber?: string
  licenseIssuingAuthority?: string
  licenseState?: string
  licenseVerified: boolean
  licenseVerifiedAt?: string
  licenseVerifiedBy?: string

  documents: DocumentSummaryDto[]

  status: ApplicationStatus
  adminNotes?: string
  submittedAt: string
  reviewedAt?: string
  reviewedBy?: string
}

export interface DocumentSummaryDto {
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedAt: string
}

/**
 * `PUT /advisors/applications/{id}/approve` and `.../reject` body — REAL today
 * (`AdminDecisionRequest` in advisor-service).
 */
export interface AdminDecisionRequest {
  notes: string
}

/**
 * One uploaded identity document, as described to the backend after the file has been PUT to its
 * pre-signed S3 URL. Mirrors advisor-service's `DocumentMetadataRequest` field-for-field.
 */
export interface DocumentMetadataRequest {
  s3Key: string
  fileName: string
  sizeBytes: number
  mimeType: string
}

/**
 * `POST /advisors/apply` body — REAL today, mirrors advisor-service's
 * `SubmitApplicationRequest` field-for-field (including the PII block, which
 * the backend stores encrypted and never echoes back in a public DTO).
 * Responds `201` with the new application's UUID as a bare JSON string.
 *
 * `documents` (not a bare key list): the backend's `@NotEmpty @Valid List<DocumentMetadataRequest>`
 * rejects anything else with a 400 — a plain `string[]` of object keys used to be sent here, which
 * the backend has never accepted; every real submission failed validation.
 */
export interface SubmitApplicationRequest {
  username: string
  professionalTitle: string
  /** Backend enforces 50–2000 characters. */
  bio: string
  sectors: AdvisorSectorEnum[]
  qualification: string
  fieldOfStudy: string
  /** A free-text band, e.g. `"5-10"` — not a number, per the backend contract. */
  experienceYears: string
  previousWork?: string
  legalFirstName: string
  legalLastName: string
  /** `YYYY-MM-DD`. */
  dateOfBirth: string
  addressFull: string
  country: string
  /** Required only when `sectors` includes FINANCE or MENTAL_HEALTH — enforced server-side. */
  licenseNumber?: string
  licenseIssuingAuthority?: string
  licenseState?: string
  documents: DocumentMetadataRequest[]
}

/**
 * `GET /admin/stats` — the shape the endpoint returns **today**, which is only
 * a partial view of the dashboard's needs. Backend Phase 10 expands it to
 * cover the full `AdminStats` UI shape; until then `useAdminStats` widens this
 * into that target shape so no page has to know about the gap.
 */
export interface AdminStatsDto {
  /** Present today. Closest available stand-in for `AdminStats.activeAdvisors`. */
  approvedAdvisors?: number
  /** Present today. Not surfaced on the dashboard. */
  totalAdminActions?: number
  // ── Everything below arrives with backend Phase 10 ──
  pendingApplications?: number
  activeAdvisors?: number
  totalUsers?: number
  /** Minor units (cents). */
  platformRevenue?: number
  pendingApplicationsDelta?: string
  activeAdvisorsDelta?: string
  totalUsersDelta?: string
  platformRevenueDelta?: string
}

/** `POST /advisors/apply/upload-url` body — pending backend. */
export interface PresignedUploadRequest {
  fileName: string
  mimeType: string
  docType: UploadDocType
}

/** `GET /notifications` — pending backend Phase 6. */
export interface NotificationDto {
  id: string
  userId: string
  type: string
  title: string
  body: string
  read: boolean
  createdAt: string
}

/** `POST /advisors/apply/upload-url` — pending backend. */
export interface PresignedUploadResponse {
  uploadUrl: string
  objectKey: string
  expiresAt: string
}

/** Document categories the onboarding flow can upload. */
export type UploadDocType = 'ID_PROOF' | 'QUALIFICATION' | 'EXPERIENCE' | 'OTHER'
