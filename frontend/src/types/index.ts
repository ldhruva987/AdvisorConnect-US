// ─── Auth ────────────────────────────────────────────────────────────────────
export type UserRole = 'user' | 'advisor' | 'admin'

export interface AuthState {
  userId: string | null
  role: UserRole | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
}

// ─── Advisor ─────────────────────────────────────────────────────────────────
export interface AdvisorPublic {
  id: string
  username: string
  title: string
  bio: string
  tags: string[]
  rating: number
  reviewCount: number
  chatCount: number
  responseTimeMinutes: number
  experienceYears: number
  isOnline: boolean
  isVerified: boolean
  color: string         // deterministic avatar color
  sectors: AdvisorSector[]
  languages: string[]
}

export type AdvisorSector = 'Career' | 'Relationships' | 'Finance' | 'Mental Health' | 'Life Coaching' | 'Parenting' | 'Health & Wellness'

export interface AdvisorReview {
  id: string
  reviewerUsername: string
  reviewerColor: string
  rating: number
  text: string
  createdAt: string
}

// ─── Credential / Onboarding ─────────────────────────────────────────────────
export type ApplicationStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'NEEDS_MORE_INFO'

export interface AdvisorApplication {
  id: string
  username: string
  title: string
  bio: string
  sectors: AdvisorSector[]
  qualification: string
  experienceYears: string
  previousWork: string
  /** Non-empty only when `sectors` includes Finance or Mental Health. */
  licenseIssuingAuthority?: string
  licenseState?: string
  licenseVerified: boolean
  status: ApplicationStatus
  submittedAt: string
  docCount: number
  color: string
  // Admin-only fields (never returned by public API)
  legalName?: string
  realNameBlurred?: string
}

/** One submitted identity/qualification document, filename and size only — never the S3 key. */
export interface ApplicationDocumentSummary {
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedAt: string
}

/**
 * The full application record for the admin review screen — backed by the real
 * `GET /advisors/applications/{id}` endpoint, admin-only. Carries the PII and license
 * credentials `AdvisorApplication` (the PII-free list row) deliberately withholds.
 */
export interface AdvisorApplicationDetail {
  id: string
  userId: string
  username: string
  title: string
  bio: string
  sectors: AdvisorSector[]
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

  documents: ApplicationDocumentSummary[]

  status: ApplicationStatus
  adminNotes?: string
  submittedAt: string
  color: string
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export interface Message {
  id: string
  conversationId: string
  senderId: string
  senderType: 'user' | 'advisor'
  text: string
  createdAt: string
}

export interface Conversation {
  id: string
  advisorId: string
  advisorUsername: string
  advisorColor: string
  lastMessage: string
  lastMessageAt: string
  unreadCount: number
  isAdvisorOnline: boolean
}

// ─── Booking ─────────────────────────────────────────────────────────────────
export type SessionDuration = 30 | 60

export interface TimeSlot {
  time: string   // e.g. "9:00 AM"
  taken: boolean
}

export interface Booking {
  id: string
  advisorId: string
  advisorUsername: string
  sessionDate: string
  durationMinutes: SessionDuration
  amountCharged: number
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
  createdAt: string
}

// ─── Admin ────────────────────────────────────────────────────────────────────
export interface AdminStats {
  pendingApplications: number
  activeAdvisors: number
  totalUsers: number
  platformRevenue: number
  pendingApplicationsDelta: string
  activeAdvisorsDelta: string
  totalUsersDelta: string
  platformRevenueDelta: string
}

export interface ActivityItem {
  id: string
  icon: string
  iconBg: string
  text: string
  time: string
}
