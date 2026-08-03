import { describe, expect, it } from 'vitest'
import { createQueryWrapper, renderHook, waitFor } from '@/test/test-utils'
import { useApplicationDetail } from './useApplicationDetail'

describe('useApplicationDetail', () => {
  it('fetches and returns the mapped application matching the id', async () => {
    const { result } = renderHook(() => useApplicationDetail('application-2'), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.username).toBe('dev_kapoor')
  })

  it('returns a *different* record for a different id', async () => {
    // The bug this replaces: AdminDashboardPage always rendered
    // MOCK_APPLICATIONS[0] regardless of which row was clicked.
    const first = renderHook(() => useApplicationDetail('application-1'), {
      wrapper: createQueryWrapper(),
    })
    const second = renderHook(() => useApplicationDetail('application-2'), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(first.result.current.data?.username).toBe('noor_haddad')
    expect(second.result.current.data?.username).toBe('dev_kapoor')
    expect(first.result.current.data?.id).not.toBe(second.result.current.data?.id)
  })

  it('returns the mapped UI shape, not the raw DTO', async () => {
    const { result } = renderHook(() => useApplicationDetail('application-1'), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.title).toBe('Parenting Consultant')
    expect(result.current.data?.sectors).toEqual(['Parenting'])
  })

  it('carries license and document fields the PII-free summary never has', async () => {
    const { result } = renderHook(() => useApplicationDetail('application-1'), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.legalFirstName).toBe('Noor')
    expect(result.current.data?.legalLastName).toBe('Haddad')
    expect(result.current.data?.licenseVerified).toBe(false)
    expect(result.current.data?.documents).toHaveLength(3)
  })

  it('does not fetch when no id is selected', () => {
    const { result } = renderHook(() => useApplicationDetail(undefined), {
      wrapper: createQueryWrapper(),
    })

    expect(result.current.isFetching).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('surfaces an error for an id the backend does not have', async () => {
    const { result } = renderHook(() => useApplicationDetail('application-999'), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
