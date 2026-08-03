import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import apiClient from '@/lib/axios'
import { mapApplicationDetailDto } from '@/lib/mapApplication'
import type { AdvisorApplicationDetail } from '@/types'
import type { AdvisorApplicationDetailDto } from '@/types/api'

export const applicationDetailQueryKey = (id: string) => ['applications', 'detail', id] as const

/** `GET /advisors/applications/{id}` — REAL backend endpoint, admin-only. */
export async function fetchApplicationDetail(id: string): Promise<AdvisorApplicationDetail> {
  const { data } = await apiClient.get<AdvisorApplicationDetailDto>(
    `/advisors/applications/${encodeURIComponent(id)}`,
  )
  return mapApplicationDetailDto(data)
}

/**
 * A single application, for the admin detail panel.
 *
 * REAL today — this used to read whatever `useApplications` had already cached, because no
 * `GET /advisors/applications/{id}` endpoint existed. That meant the detail panel could only ever
 * show the PII-free summary fields (no legal name, DOB, address, license number, or document
 * list), and its own comments said so. Now that the endpoint is real, this is an ordinary query.
 */
export function useApplicationDetail(
  id: string | undefined,
): UseQueryResult<AdvisorApplicationDetail> {
  return useQuery({
    queryKey: applicationDetailQueryKey(id ?? ''),
    queryFn: () => fetchApplicationDetail(id!),
    enabled: !!id,
  })
}
