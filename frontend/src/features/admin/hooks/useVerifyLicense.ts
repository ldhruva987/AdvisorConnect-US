import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import apiClient from '@/lib/axios'
import { applicationDetailQueryKey } from './useApplicationDetail'

/** `PUT /advisors/applications/{id}/verify-license`. REAL backend endpoint, admin-only. */
export async function putVerifyLicense(id: string): Promise<void> {
  await apiClient.put(`/advisors/applications/${encodeURIComponent(id)}/verify-license`)
}

/**
 * Records that an admin has checked a FINANCE or MENTAL_HEALTH application's license against its
 * issuing authority. `approveAdvisor` on the backend refuses to promote such an application until
 * this has been called — so this has to run, and succeed, before the Approve button can.
 *
 * Invalidates the detail query (not the list): `licenseVerified` is a detail-only field the list
 * row doesn't otherwise need to refetch for.
 */
export function useVerifyLicense(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: putVerifyLicense,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: applicationDetailQueryKey(id) })
      void queryClient.invalidateQueries({ queryKey: ['applications'] })
    },
  })
}
