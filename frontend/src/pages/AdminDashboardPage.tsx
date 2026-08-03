import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart2, FileText, GraduationCap, Users, Flag, Settings,
  ArrowLeft, FileIcon, CheckCircle, XCircle, AlertTriangle,
  Eye, Inbox, Activity,
} from 'lucide-react'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, StatusBadge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { ErrorBanner } from '@/shared/components/ui/ErrorBanner'
import { Skeleton, SkeletonRow } from '@/shared/components/ui/Skeleton'
import { useAdminStats } from '@/features/admin/hooks/useAdminStats'
import { useApplications } from '@/features/admin/hooks/useApplications'
import { useApplicationDetail } from '@/features/admin/hooks/useApplicationDetail'
import {
  useApplicationDecision,
  type ApplicationDecision,
} from '@/features/admin/hooks/useApplicationDecision'
import { useVerifyLicense } from '@/features/admin/hooks/useVerifyLicense'
import { getErrorMessage } from '@/lib/getErrorMessage'
import { useToastStore } from '@/stores/toastStore'
import type { AdvisorApplication, ApplicationStatus } from '@/types'

type AdminPage = 'dashboard' | 'applications' | 'detail' | 'placeholder'
type AdminNav = 'dashboard' | 'applications' | 'advisors' | 'users' | 'reports' | 'settings'
type FilterStatus = 'All' | ApplicationStatus

/**
 * Every status the backend can return gets a filter pill, derived from one
 * array so the pills and the labels below can't drift. The old UI only offered
 * three of them, which made an `UNDER_REVIEW` or `NEEDS_MORE_INFO` application
 * reachable *only* under "All".
 */
const STATUS_FILTERS: ApplicationStatus[] = [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_MORE_INFO',
]

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  NEEDS_MORE_INFO: 'Needs Info',
}

/** How many rows the dashboard overview previews before "see all". */
const PREVIEW_ROWS = 5

const NAV_ITEMS: { id: AdminNav; icon: React.ReactNode; label: string }[] = [
  { id: 'dashboard', icon: <BarChart2 className="w-4 h-4" />, label: 'Dashboard' },
  { id: 'applications', icon: <FileText className="w-4 h-4" />, label: 'Applications' },
  { id: 'advisors', icon: <GraduationCap className="w-4 h-4" />, label: 'All Advisors' },
  { id: 'users', icon: <Users className="w-4 h-4" />, label: 'All Users' },
  { id: 'reports', icon: <Flag className="w-4 h-4" />, label: 'Reports' },
  { id: 'settings', icon: <Settings className="w-4 h-4" />, label: 'Settings' },
]

/** Nav destinations with no backend behind them yet. */
const PLACEHOLDER_NAV: Partial<Record<AdminNav, string>> = {
  advisors: 'The advisor directory is not available yet.',
  users: 'The user directory is not available yet.',
  reports: 'Content reports are not available yet.',
  settings: 'Platform settings are not available yet.',
}

/** Which application id the detail panel / decision buttons apply to. */
interface SelectedApplication {
  id: string
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/** `AdminStats.platformRevenue` is minor units (cents), per the DTO contract. */
function formatRevenue(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatFileSizeKb(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(1)} KB`
}

/** Approve/reject only make sense while the application is still open. */
function canDecide(status: ApplicationStatus): boolean {
  return status !== 'APPROVED' && status !== 'REJECTED'
}

/** Username + avatar cell, shared by the overview preview and the full table. */
function ApplicantCell({ application }: { application: AdvisorApplication }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar username={application.username} color={application.color} size="sm" />
      <div className="min-w-0">
        <p className="font-medium text-ink-900 truncate">{application.username}</p>
        <p className="text-xs text-ink-400 truncate">{application.title || 'No title provided'}</p>
      </div>
    </div>
  )
}

export function AdminDashboardPage() {
  const [adminNav, setAdminNav] = useState<AdminNav>('dashboard')
  const [adminPage, setAdminPage] = useState<AdminPage>('dashboard')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('All')
  const [adminNotes, setAdminNotes] = useState('')
  const [selected, setSelected] = useState<SelectedApplication | null>(null)

  const showToast = useToastStore((s) => s.show)

  const stats = useAdminStats()

  const listScope: ApplicationStatus | undefined = filterStatus === 'All' ? undefined : filterStatus

  // When `filterStatus` is 'PENDING' the two share a key and TanStack dedupes
  // them into one request.
  const applications = useApplications(listScope)
  const pendingPreview = useApplications('PENDING')

  const detail = useApplicationDetail(selected?.id)
  const decision = useApplicationDecision()
  const verifyLicense = useVerifyLicense()

  // Only the row currently being decided should show a busy state, not every row.
  const decidingId = decision.isPending ? decision.variables?.id : undefined

  const handleNavClick = (id: AdminNav) => {
    setAdminNav(id)
    if (id === 'dashboard') setAdminPage('dashboard')
    else if (id === 'applications') setAdminPage('applications')
    else setAdminPage('placeholder')
  }

  /**
   * The fix for the headline bug: the detail panel used to render
   * `MOCK_APPLICATIONS[0]` no matter which row's "Review" was clicked. It now
   * renders whichever id was actually selected.
   */
  const openApplication = (id: string) => {
    setSelected({ id })
    setAdminNotes('')
    setAdminNav('applications')
    setAdminPage('detail')
  }

  const submitDecision = (
    id: string,
    verdict: ApplicationDecision,
    notes: string,
    { returnToList = false } = {},
  ) => {
    decision.mutate(
      { id, decision: verdict, notes },
      {
        // The hook's own `onSuccess` invalidates `['applications']` and
        // `['admin','stats']`, so the table and the stat tiles refetch without
        // a reload. Nothing to duplicate here beyond the user-facing feedback.
        onSuccess: () => {
          showToast(
            verdict === 'approve' ? 'Application approved.' : 'Application rejected.',
            'success',
          )
          if (returnToList) {
            setSelected(null)
            setAdminNotes('')
            setAdminNav('applications')
            setAdminPage('applications')
          }
        },
        onError: (error) => showToast(getErrorMessage(error), 'error'),
      },
    )
  }

  const statCards = [
    {
      label: 'Pending Applications',
      value: stats.data ? formatCount(stats.data.pendingApplications) : null,
      delta: stats.data?.pendingApplicationsDelta ?? '',
      color: 'text-warn-600',
      bg: 'bg-warn-100',
    },
    {
      label: 'Active Advisors',
      value: stats.data ? formatCount(stats.data.activeAdvisors) : null,
      delta: stats.data?.activeAdvisorsDelta ?? '',
      color: 'text-pine-600',
      bg: 'bg-pine-100',
    },
    {
      label: 'Total Users',
      value: stats.data ? formatCount(stats.data.totalUsers) : null,
      delta: stats.data?.totalUsersDelta ?? '',
      color: 'text-oxblood-700',
      bg: 'bg-oxblood-50',
    },
    {
      label: 'Platform Revenue',
      value: stats.data ? formatRevenue(stats.data.platformRevenue) : null,
      delta: stats.data?.platformRevenueDelta ?? '',
      color: 'text-ink-700',
      bg: 'bg-ink-100',
    },
  ]

  const previewApplications = (pendingPreview.data?.applications ?? []).slice(0, PREVIEW_ROWS)
  const listApplications = applications.data?.applications ?? []
  const pendingCount = stats.data?.pendingApplications ?? 0
  const detailApp = detail.data

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="flex h-screen bg-ink-50 overflow-hidden">
      {/* Dark sidebar */}
      <aside className="w-64 bg-ink-900 text-white flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="p-5 border-b border-white/10">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-1">Admin Panel</p>
          <p className="font-heading font-medium text-lg">AdvisorConnect</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                adminNav === item.id
                  ? 'bg-white/10 text-white font-semibold'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {item.icon}
                {item.label}
              </div>
              {/* The only badge with a real number behind it. The old "Reports 3"
                  badge was invented, so it's gone rather than fabricated. */}
              {item.id === 'applications' && pendingCount > 0 && (
                <span className="min-w-5 h-5 px-1 bg-oxblood-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Exit */}
        <div className="p-4 border-t border-white/10">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Exit admin
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {/* DASHBOARD VIEW */}
        {adminPage === 'dashboard' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="font-heading font-medium text-2xl text-ink-900">Admin Overview</h1>
                <p className="text-ink-500 text-sm mt-0.5">{today}</p>
              </div>
            </div>

            {stats.isError && (
              <ErrorBanner
                className="mb-4"
                message={getErrorMessage(stats.error)}
                onRetry={() => void stats.refetch()}
              />
            )}

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {statCards.map((stat) => (
                <div key={stat.label} className={`${stat.bg} rounded-xl p-5`}>
                  <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">{stat.label}</p>
                  {stat.value === null ? (
                    stats.isError ? (
                      <p className={`font-heading font-medium text-2xl ${stat.color}`}>—</p>
                    ) : (
                      <Skeleton className="h-8 w-20" />
                    )
                  ) : (
                    <p className={`font-heading font-medium text-2xl ${stat.color}`}>{stat.value}</p>
                  )}
                  {/* Deltas stay blank until the backend computes them — an
                      invented "+3 today" is worse than no trend at all. */}
                  {stat.delta && <p className="text-xs text-ink-500 mt-1">{stat.delta}</p>}
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-3 gap-5">
              {/* Pending applications table */}
              <div className="lg:col-span-2">
                <Card padding="none">
                  <CardHeader>
                    <h2 className="font-semibold text-ink-900">Pending Applications</h2>
                    {pendingPreview.data && (
                      <Badge variant="pending">
                        {formatCount(pendingPreview.data.totalElements)} pending
                      </Badge>
                    )}
                  </CardHeader>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-ink-100 bg-ink-50">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Applicant</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Sector</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Applied</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Status</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100">
                        {pendingPreview.isLoading &&
                          Array.from({ length: 3 }, (_, i) => <SkeletonRow key={i} columns={5} />)}

                        {!pendingPreview.isLoading && pendingPreview.isError && (
                          <tr>
                            <td colSpan={5} className="px-4 py-5">
                              <ErrorBanner
                                message={getErrorMessage(pendingPreview.error)}
                                onRetry={() => void pendingPreview.refetch()}
                              />
                            </td>
                          </tr>
                        )}

                        {!pendingPreview.isLoading &&
                          !pendingPreview.isError &&
                          previewApplications.length === 0 && (
                            <tr>
                              <td colSpan={5}>
                                <EmptyState
                                  icon={<Inbox className="w-8 h-8" />}
                                  title="No pending applications"
                                  description="New advisor applications will show up here."
                                  className="py-10"
                                />
                              </td>
                            </tr>
                          )}

                        {previewApplications.map((app) => (
                          <tr key={app.id} className="hover:bg-ink-50 transition-colors">
                            <td className="px-4 py-3">
                              <ApplicantCell application={app} />
                            </td>
                            <td className="px-4 py-3 text-ink-600">
                              {app.sectors.join(', ') || '—'}
                            </td>
                            <td className="px-4 py-3 text-ink-400 text-xs">{formatDate(app.submittedAt)}</td>
                            <td className="px-4 py-3">
                              <StatusBadge status={app.status} />
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => openApplication(app.id)}
                                aria-label={`Review ${app.username}`}
                                className="text-oxblood-700 font-semibold text-xs hover:text-oxblood-600 transition-colors"
                              >
                                Review →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              {/* Activity feed — nothing produces these events yet */}
              <div>
                <Card padding="none">
                  <CardHeader>
                    <h2 className="font-semibold text-ink-900">Recent Activity</h2>
                  </CardHeader>
                  {/*
                    No endpoint emits pre-formatted activity entries, and building
                    an audit-log adapter is beyond a page-rewiring change. An
                    empty state is the honest rendering; the previous hardcoded
                    feed described approvals and payments that never happened.
                  */}
                  <EmptyState
                    icon={<Activity className="w-8 h-8" />}
                    title="Activity feed coming soon"
                    description="Platform events will appear here once the audit feed is available."
                    className="py-12"
                  />
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* APPLICATIONS VIEW */}
        {adminPage === 'applications' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h1 className="font-heading font-medium text-2xl text-ink-900">Applications</h1>
            </div>

            {/* Filter buttons — `status` goes to the server, not a client filter */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {(['All', ...STATUS_FILTERS] as FilterStatus[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  aria-pressed={filterStatus === f}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    filterStatus === f
                      ? 'bg-ink-900 text-white border-ink-900'
                      : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400'
                  }`}
                >
                  {f === 'All' ? 'All' : STATUS_LABELS[f]}
                </button>
              ))}
            </div>

            <Card padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-100 bg-ink-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Applicant</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Sector</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Qualification</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Applied</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Docs</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {applications.isLoading &&
                      Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} columns={7} />)}

                    {!applications.isLoading && applications.isError && (
                      <tr>
                        <td colSpan={7} className="px-4 py-5">
                          <ErrorBanner
                            message={getErrorMessage(applications.error)}
                            onRetry={() => void applications.refetch()}
                          />
                        </td>
                      </tr>
                    )}

                    {!applications.isLoading && !applications.isError && listApplications.length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            icon={<Inbox className="w-8 h-8" />}
                            title="No applications match this filter"
                            description={
                              filterStatus === 'All'
                                ? 'No advisor applications have been submitted yet.'
                                : `No applications are currently ${STATUS_LABELS[filterStatus].toLowerCase()}.`
                            }
                            className="py-12"
                          />
                        </td>
                      </tr>
                    )}

                    {listApplications.map((app) => (
                      <tr key={app.id} className="hover:bg-ink-50 transition-colors">
                        <td className="px-4 py-3">
                          <ApplicantCell application={app} />
                        </td>
                        <td className="px-4 py-3 text-ink-600">{app.sectors.join(', ') || '—'}</td>
                        <td className="px-4 py-3 text-ink-600 text-xs">{app.qualification || '—'}</td>
                        <td className="px-4 py-3 text-ink-400 text-xs">{formatDate(app.submittedAt)}</td>
                        <td className="px-4 py-3">
                          <span className="bg-ink-100 text-ink-600 text-xs font-semibold px-2 py-0.5 rounded-full">
                            {app.docCount} docs
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={app.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => openApplication(app.id)}
                              aria-label={`Review ${app.username}`}
                              className="text-oxblood-700 font-semibold text-xs hover:text-oxblood-600 transition-colors flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              Review
                            </button>
                            {canDecide(app.status) && (
                              <>
                                <button
                                  onClick={() => submitDecision(app.id, 'approve', '')}
                                  disabled={decidingId === app.id}
                                  aria-label={`Approve ${app.username}`}
                                  className="text-pine-600 font-semibold text-xs hover:text-pine-600/80 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  Approve
                                </button>
                                <button
                                  onClick={() => submitDecision(app.id, 'reject', '')}
                                  disabled={decidingId === app.id}
                                  aria-label={`Reject ${app.username}`}
                                  className="text-danger-600 font-semibold text-xs hover:text-danger-600/80 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <XCircle className="w-3 h-3" />
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* DETAIL VIEW */}
        {adminPage === 'detail' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => setAdminPage('applications')}
                className="flex items-center gap-2 text-ink-500 hover:text-ink-900 transition-colors text-sm font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Applications
              </button>
              {detailApp && <StatusBadge status={detailApp.status} />}
            </div>

            {detail.isLoading ? (
              <div className="grid lg:grid-cols-2 gap-5">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
            ) : !detailApp ? (
              <Card>
                <EmptyState
                  icon={<Inbox className="w-8 h-8" />}
                  title="Application unavailable"
                  description="This application could not be loaded. Go back and pick it again."
                />
              </Card>
            ) : (
              <div className="grid lg:grid-cols-2 gap-5">
                {/* LEFT COLUMN */}
                <div className="space-y-5">
                  {/* Public profile card */}
                  <Card>
                    <h3 className="font-heading font-semibold text-ink-900 mb-4">Public Profile</h3>
                    <div className="flex items-start gap-3 mb-4">
                      <Avatar username={detailApp.username} color={detailApp.color} size="lg" />
                      <div>
                        <p className="font-heading font-semibold text-ink-900">{detailApp.username}</p>
                        <p className="text-sm text-ink-500">{detailApp.title || 'No title provided'}</p>
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                          {detailApp.sectors.map((sector) => (
                            <Badge key={sector} variant="brand">{sector}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-ink-600 leading-relaxed">
                      {detailApp.bio || 'No bio provided.'}
                    </p>
                  </Card>

                  {/* Identity — real backend data now that GET /advisors/applications/{id} exists */}
                  <Card className="border-danger-600/30">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-heading font-semibold text-ink-900">Identity Verification</h3>
                      <Badge variant="danger">Admin Eyes Only</Badge>
                    </div>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-ink-100">
                        <tr>
                          <td className="py-2.5 pr-4 text-xs font-semibold text-ink-500 uppercase tracking-wider whitespace-nowrap">
                            Legal Name
                          </td>
                          <td className="py-2.5 text-ink-800">
                            {detailApp.legalFirstName || detailApp.legalLastName
                              ? `${detailApp.legalFirstName} ${detailApp.legalLastName}`.trim()
                              : '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2.5 pr-4 text-xs font-semibold text-ink-500 uppercase tracking-wider whitespace-nowrap">
                            Date of Birth
                          </td>
                          <td className="py-2.5 text-ink-800">{detailApp.dateOfBirth || '—'}</td>
                        </tr>
                        <tr>
                          <td className="py-2.5 pr-4 text-xs font-semibold text-ink-500 uppercase tracking-wider whitespace-nowrap">
                            Address
                          </td>
                          <td className="py-2.5 text-ink-800">{detailApp.addressFull || '—'}</td>
                        </tr>
                        <tr>
                          <td className="py-2.5 pr-4 text-xs font-semibold text-ink-500 uppercase tracking-wider whitespace-nowrap">
                            Country
                          </td>
                          <td className="py-2.5 text-ink-800">{detailApp.country || '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </Card>

                  {/* Credentials card */}
                  <Card>
                    <h3 className="font-heading font-semibold text-ink-900 mb-4">Credentials</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-ink-400">Qualification</span>
                        <span className="font-medium text-ink-800 text-right">
                          {detailApp.qualification || '—'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-ink-400">Experience</span>
                        <span className="font-medium text-ink-800 text-right">
                          {detailApp.experienceYears ? `${detailApp.experienceYears} years` : '—'}
                        </span>
                      </div>
                      <div className="mt-3 pt-3 border-t border-ink-100">
                        <p className="text-xs font-semibold text-ink-500 mb-1 uppercase tracking-wider">Previous Work</p>
                        <p className="text-sm text-ink-600 leading-relaxed">
                          {detailApp.previousWork || 'Not provided.'}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/*
                    License card — only for Finance/Mental Health applications. The backend
                    refuses to approve either without this being verified, so the Approve button
                    below is disabled until it is.
                  */}
                  {(detailApp.licenseNumber || detailApp.licenseIssuingAuthority) && (
                    <Card className={detailApp.licenseVerified ? 'border-pine-600/30' : 'border-warn-600/40'}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-heading font-semibold text-ink-900">Professional License</h3>
                        {detailApp.licenseVerified ? (
                          <Badge variant="success">Verified</Badge>
                        ) : (
                          <Badge variant="warn">Not Verified</Badge>
                        )}
                      </div>
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex justify-between gap-4">
                          <span className="text-ink-400">License Number</span>
                          <span className="font-medium text-ink-800 text-right">
                            {detailApp.licenseNumber || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-ink-400">Issuing Authority</span>
                          <span className="font-medium text-ink-800 text-right">
                            {detailApp.licenseIssuingAuthority || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-ink-400">State</span>
                          <span className="font-medium text-ink-800 text-right">
                            {detailApp.licenseState || '—'}
                          </span>
                        </div>
                      </div>
                      {detailApp.licenseVerified ? (
                        <p className="text-xs text-ink-400">
                          Verified {detailApp.licenseVerifiedAt ? formatDate(detailApp.licenseVerifiedAt) : ''}.
                        </p>
                      ) : (
                        <Button
                          variant="outline"
                          fullWidth
                          className="justify-center"
                          loading={verifyLicense.isPending}
                          onClick={() =>
                            verifyLicense.mutate(detailApp.id, {
                              onSuccess: () => showToast('License marked as verified.', 'success'),
                              onError: (error) => showToast(getErrorMessage(error), 'error'),
                            })
                          }
                        >
                          Mark License as Verified
                        </Button>
                      )}
                    </Card>
                  )}

                  {/* Admin notes — submitted with the decision, not separately */}
                  <Card>
                    <h3 className="font-heading font-semibold text-ink-900 mb-3">Admin Notes</h3>
                    <label htmlFor="admin-notes" className="sr-only">Admin notes</label>
                    <textarea
                      id="admin-notes"
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      placeholder="Add internal notes about this application..."
                      rows={3}
                      className="input-base resize-none mb-3"
                    />
                    {/*
                      The old "Save Notes" button was `onClick={() => {}}` — it
                      looked functional and did nothing. There is no notes
                      endpoint, but the approve/reject endpoints DO accept a
                      `notes` body, so the field itself is real: it ships with
                      the decision. A dead button is removed rather than
                      disabled, because the input above is genuinely wired.
                    */}
                    <p className="text-xs text-ink-400">
                      Notes are submitted with your approve or reject decision.
                    </p>
                  </Card>
                </div>

                {/* RIGHT COLUMN */}
                <div className="space-y-5">
                  {/*
                    Documents — filename/type/size/upload time, from the real detail endpoint.
                    Still no S3 key here (see AdvisorApplicationDetailDto's javadoc) and no
                    download-proxy endpoint exists yet, so opening the actual file is still not
                    possible — this closes the "which files, how big" gap, not the viewing gap.
                  */}
                  <Card>
                    <h3 className="font-heading font-semibold text-ink-900 mb-4">
                      Submitted Documents ({detailApp.documents.length})
                    </h3>
                    {detailApp.documents.length === 0 ? (
                      <p className="text-sm text-ink-400">No documents submitted.</p>
                    ) : (
                      <ul className="space-y-2">
                        {detailApp.documents.map((doc, i) => (
                          <li
                            key={`${doc.fileName}-${i}`}
                            className="flex items-center gap-3 p-3 bg-ink-100 rounded-xl"
                          >
                            <div className="w-9 h-9 rounded-lg bg-oxblood-50 flex items-center justify-center flex-shrink-0">
                              <FileIcon className="w-4 h-4 text-oxblood-700" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink-800 truncate">{doc.fileName}</p>
                              <p className="text-xs text-ink-400">
                                {formatFileSizeKb(doc.sizeBytes)} · {doc.mimeType}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-ink-400 mt-3">
                      Document viewing (opening the file itself) is not available yet.
                    </p>
                  </Card>

                  {/* Decision card */}
                  <Card>
                    <h3 className="font-heading font-semibold text-ink-900 mb-4">Application Decision</h3>
                    {canDecide(detailApp.status) ? (
                      <div className="space-y-3">
                        {(() => {
                          const licenseRequired =
                            detailApp.sectors.includes('Finance') ||
                            detailApp.sectors.includes('Mental Health')
                          const blockedByLicense = licenseRequired && !detailApp.licenseVerified
                          return (
                            <>
                              <Button
                                variant="success"
                                fullWidth
                                className="justify-center"
                                loading={decidingId === detailApp.id && decision.variables?.decision === 'approve'}
                                disabled={decidingId === detailApp.id || blockedByLicense}
                                title={
                                  blockedByLicense
                                    ? 'Verify the professional license above before this application can be approved'
                                    : undefined
                                }
                                onClick={() =>
                                  submitDecision(detailApp.id, 'approve', adminNotes, { returnToList: true })
                                }
                              >
                                <CheckCircle className="w-4 h-4" />
                                Approve Application
                              </Button>
                              {blockedByLicense && (
                                <p className="text-xs text-warn-600 -mt-1">
                                  License must be verified before this application can be approved.
                                </p>
                              )}
                            </>
                          )
                        })()}

                        {/*
                          `NEEDS_MORE_INFO` is a real application status, but no
                          endpoint moves an application into it. Left visible and
                          disabled rather than hidden: it is part of the decision
                          triad, and a labelled disabled control is more honest
                          than quietly dropping an option reviewers expect.
                        */}
                        <Button
                          variant="ghost"
                          fullWidth
                          disabled
                          title="Not available yet — no backend endpoint for this action"
                          className="justify-center border border-warn-600/30 text-warn-600"
                        >
                          <AlertTriangle className="w-4 h-4" />
                          Request More Information
                          <Badge variant="warn">Coming soon</Badge>
                        </Button>

                        <Button
                          variant="danger"
                          fullWidth
                          className="justify-center"
                          loading={decidingId === detailApp.id && decision.variables?.decision === 'reject'}
                          disabled={decidingId === detailApp.id}
                          onClick={() =>
                            submitDecision(detailApp.id, 'reject', adminNotes, { returnToList: true })
                          }
                        >
                          <XCircle className="w-4 h-4" />
                          Reject Application
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-ink-500">
                        This application was already {STATUS_LABELS[detailApp.status].toLowerCase()}.
                      </p>
                    )}
                  </Card>
                </div>
              </div>
            )}
          </div>
        )}

        {/* NAV DESTINATIONS WITH NO BACKEND YET */}
        {adminPage === 'placeholder' && (
          <div className="p-6">
            <h1 className="font-heading font-medium text-2xl text-ink-900 mb-5">
              {NAV_ITEMS.find((i) => i.id === adminNav)?.label}
            </h1>
            <Card>
              <EmptyState
                icon={<Settings className="w-8 h-8" />}
                title="Coming soon"
                description={PLACEHOLDER_NAV[adminNav] ?? 'This section is not available yet.'}
              />
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
