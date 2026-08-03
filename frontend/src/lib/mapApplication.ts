import { mapSectorEnums } from '@/lib/mapAdvisor'
import { getAvatarColor } from '@/lib/utils'
import type { AdvisorApplication, AdvisorApplicationDetail } from '@/types'
import type { AdvisorApplicationDetailDto, AdvisorApplicationSummaryDto } from '@/types/api'

/**
 * `AdvisorApplicationSummaryDto` (wire) → `AdvisorApplication` (UI).
 *
 * Same divergences as `mapAdvisor`, for the same reasons:
 * `professionalTitle`/`title`, `avatarColor`/`color`, and enum sectors that
 * the UI renders as labels. Kept alongside `mapAdvisor.ts` in `lib/` so all
 * DTO translation lives in one place rather than half in `lib/` and half in a
 * feature folder.
 *
 * `realNameBlurred` on the UI type is intentionally not populated: it is a
 * presentation concern for the admin table, not something the backend sends.
 */
export function mapApplicationDto(dto: AdvisorApplicationSummaryDto): AdvisorApplication {
  return {
    id: dto.id,
    username: dto.username,
    title: dto.professionalTitle ?? '',
    bio: dto.bio ?? '',
    sectors: mapSectorEnums(dto.sectors),
    qualification: dto.qualification ?? '',
    experienceYears: dto.experienceYears ?? '',
    previousWork: dto.previousWork ?? '',
    licenseIssuingAuthority: dto.licenseIssuingAuthority,
    licenseState: dto.licenseState,
    licenseVerified: dto.licenseVerified ?? false,
    status: dto.status,
    submittedAt: dto.submittedAt,
    docCount: dto.docCount ?? 0,
    color: dto.avatarColor || getAvatarColor(dto.username ?? ''),
    legalName: dto.legalName,
  }
}

/**
 * `AdvisorApplicationDetailDto` (wire) → `AdvisorApplicationDetail` (UI).
 *
 * The admin detail screen's avatar color is derived the same way `mapApplicationDto` derives it
 * for the list — the detail endpoint has no `avatarColor` field of its own, and re-deriving from
 * `username` keeps the same row looking the same color whether you're seeing it in the list or
 * the detail panel.
 */
export function mapApplicationDetailDto(dto: AdvisorApplicationDetailDto): AdvisorApplicationDetail {
  return {
    id: dto.id,
    userId: dto.userId,
    username: dto.username,
    title: dto.professionalTitle ?? '',
    bio: dto.bio ?? '',
    sectors: mapSectorEnums(dto.sectors),
    qualification: dto.qualification ?? '',
    fieldOfStudy: dto.fieldOfStudy ?? '',
    experienceYears: dto.experienceYears ?? '',
    previousWork: dto.previousWork ?? '',
    legalFirstName: dto.legalFirstName ?? '',
    legalLastName: dto.legalLastName ?? '',
    dateOfBirth: dto.dateOfBirth ?? '',
    addressFull: dto.addressFull ?? '',
    country: dto.country ?? '',
    licenseNumber: dto.licenseNumber,
    licenseIssuingAuthority: dto.licenseIssuingAuthority,
    licenseState: dto.licenseState,
    licenseVerified: dto.licenseVerified ?? false,
    licenseVerifiedAt: dto.licenseVerifiedAt,
    documents: dto.documents ?? [],
    status: dto.status,
    adminNotes: dto.adminNotes,
    submittedAt: dto.submittedAt,
    color: getAvatarColor(dto.username ?? ''),
  }
}
