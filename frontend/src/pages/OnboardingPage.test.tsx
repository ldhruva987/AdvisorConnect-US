import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { server } from '@/test/mocks/server'
import { MOCK_STORAGE_ORIGIN } from '@/test/mocks/handlers/upload'
import { ALL_SECTORS, SECTOR_LABELS } from '@/lib/sectors'
import type { PresignedUploadRequest, SubmitApplicationRequest } from '@/types/api'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { OnboardingPage } from './OnboardingPage'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `size` is stamped on rather than produced by real bytes so the oversized case
 * costs nothing — an actual 11MB `File` would be allocated for every run just to
 * exercise one `>` comparison.
 */
function makeFile(name: string, type: string, size = 2048): File {
  const file = new File(['stub'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const MB = 1024 * 1024
const DEGREE_FILE = makeFile('degree.pdf', 'application/pdf')
const ID_FRONT_FILE = makeFile('id-front.png', 'image/png')
const ID_BACK_FILE = makeFile('id-back.png', 'image/png')

/** Accessible names of the four file inputs (they are visually hidden). */
const UPLOAD_LABELS = {
  degree: 'Upload degree or certificate',
  license: 'Upload license or registration',
  idFront: 'Upload government ID front side',
  idBack: 'Upload government ID back side',
} as const

/* -------------------------------------------------------------------------- */
/* Network spies                                                              */
/* -------------------------------------------------------------------------- */

interface Spies {
  presign: PresignedUploadRequest[]
  storagePuts: { url: string; authorization: string | null }[]
  submissions: SubmitApplicationRequest[]
}

/**
 * Records all three hops of the submit flow. The presign and storage handlers
 * mirror `handlers/upload.ts`; they are re-declared here only so the calls can
 * be counted and inspected per test.
 */
function spyOnSubmitFlow(submitResponse?: () => Response): Spies {
  const spies: Spies = { presign: [], storagePuts: [], submissions: [] }

  server.use(
    http.post('*/api/advisors/apply/upload-url', async ({ request }) => {
      const body = (await request.json()) as PresignedUploadRequest
      spies.presign.push(body)
      return HttpResponse.json({
        uploadUrl: `${MOCK_STORAGE_ORIGIN}/advisorconnect/applications/user-1/${body.fileName}?X-Amz-Signature=deadbeef`,
        objectKey: `applications/user-1/${body.fileName}`,
        expiresAt: '2026-08-01T13:00:00Z',
      })
    }),

    http.put(`${MOCK_STORAGE_ORIGIN}/*`, ({ request }) => {
      spies.storagePuts.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
      })
      return new HttpResponse(null, { status: 200 })
    }),

    http.post('*/api/advisors/apply', async ({ request }) => {
      spies.submissions.push((await request.json()) as SubmitApplicationRequest)
      return submitResponse?.() ?? HttpResponse.json('application-new', { status: 201 })
    }),
  )

  return spies
}

/* -------------------------------------------------------------------------- */
/* Wizard driving                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `fireEvent.change` rather than `user.type` for plain text: these fields carry
 * no per-keystroke behaviour, and one of them is a `type="date"` input, which
 * `user.type` drives unreliably in jsdom.
 */
function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const clickContinue = (user: UserEvent) =>
  user.click(screen.getByRole('button', { name: /continue/i }))

async function completeProfileStep(user: UserEvent) {
  fill(/username/i, 'jane_advisor')
  fill(/professional title/i, 'Licensed Clinical Psychologist')
  fill(/^bio$/i, 'Fifteen years helping people navigate anxiety, burnout and career change.')
  await user.click(screen.getByRole('checkbox', { name: SECTOR_LABELS.MENTAL_HEALTH }))
  await user.click(screen.getByRole('checkbox', { name: SECTOR_LABELS.CAREER }))
  fill(/languages/i, 'English, Spanish')
  await clickContinue(user)
}

/**
 * `completeProfileStep` always selects Mental Health, which makes the license fields required —
 * filled by default here so every test that drives the wizard through to submission doesn't have
 * to know that. `withLicenseInfo: false` is for the tests that stop before the final step and
 * never care whether the Submit button would actually be enabled.
 */
async function completeCredentialsStep(
  user: UserEvent,
  { withDegree = true, withLicenseInfo = true } = {},
) {
  await user.selectOptions(screen.getByLabelText(/highest qualification/i), 'PhD')
  fill(/field of study/i, 'Clinical Psychology')
  await user.selectOptions(screen.getByLabelText(/years of experience/i), '6–10 years')
  if (withLicenseInfo) {
    fill(/license number/i, 'LPC-4471')
    fill(/issuing authority/i, 'California Board of Behavioral Sciences')
    fill(/license state/i, 'CA')
  }
  fill(/previous work/i, 'Head of psychology at a community clinic.')
  if (withDegree) await user.upload(screen.getByLabelText(UPLOAD_LABELS.degree), DEGREE_FILE)
  await clickContinue(user)
}

async function completeIdentityStep(user: UserEvent, { withIdScans = true } = {}) {
  fill(/legal first name/i, 'Jane')
  fill(/legal last name/i, 'Doe')
  fill(/date of birth/i, '1990-01-01')
  fill(/street address/i, '123 Main Street')
  fill(/^city$/i, 'New York')
  fill(/state \/ province/i, 'NY')
  fill(/zip \/ postal code/i, '10001')
  await user.selectOptions(screen.getByLabelText(/^country$/i), 'United States')
  await user.selectOptions(screen.getByLabelText(/government id type/i), 'Passport')
  if (withIdScans) {
    await user.upload(screen.getByLabelText(UPLOAD_LABELS.idFront), ID_FRONT_FILE)
    await user.upload(screen.getByLabelText(UPLOAD_LABELS.idBack), ID_BACK_FILE)
  }
  await clickContinue(user)
}

async function acceptConsents(user: UserEvent) {
  await user.click(screen.getByRole('checkbox', { name: /i consent to advisorconnect/i }))
  await user.click(screen.getByRole('checkbox', { name: /i agree to the/i }))
}

const submitButton = () => screen.getByRole('button', { name: /submit application/i })

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('OnboardingPage', () => {
  describe('sector picker', () => {
    it('renders exactly the canonical sector vocabulary', () => {
      render(<OnboardingPage />)

      const labels = screen
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent?.trim())

      expect(labels).toEqual(ALL_SECTORS.map((sector) => SECTOR_LABELS[sector]))
      expect(labels).toHaveLength(7)
    })

    it('has no "Business" sector — it has no backend enum value', () => {
      render(<OnboardingPage />)

      expect(screen.queryByRole('checkbox', { name: 'Business' })).not.toBeInTheDocument()
      expect(screen.queryByText('Business')).not.toBeInTheDocument()
    })

    it('includes the categories the old hardcoded list drifted away from', () => {
      render(<OnboardingPage />)

      expect(screen.getByRole('checkbox', { name: 'Parenting' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Health & Wellness' })).toBeInTheDocument()
    })
  })

  describe('document uploads', () => {
    it('shows a file chip after a file is chosen', async () => {
      const user = userEvent.setup()
      render(<OnboardingPage />)
      await completeProfileStep(user)

      await user.upload(screen.getByLabelText(UPLOAD_LABELS.degree), DEGREE_FILE)

      expect(screen.getByText('degree.pdf')).toBeInTheDocument()
      expect(screen.getByText('2.0 KB')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove degree.pdf' })).toBeInTheDocument()
      // The dashed zone is replaced by the chip once a file is held.
      expect(screen.queryByText(/click to upload or drag & drop/i)).not.toBeInTheDocument()
    })

    it('clears the chip when the file is removed', async () => {
      const user = userEvent.setup()
      render(<OnboardingPage />)
      await completeProfileStep(user)
      await user.upload(screen.getByLabelText(UPLOAD_LABELS.degree), DEGREE_FILE)

      await user.click(screen.getByRole('button', { name: 'Remove degree.pdf' }))

      expect(screen.queryByText('degree.pdf')).not.toBeInTheDocument()
      expect(screen.getByText(/click to upload or drag & drop/i)).toBeInTheDocument()
    })

    it('rejects a file over the stated size limit', async () => {
      const user = userEvent.setup()
      render(<OnboardingPage />)
      await completeProfileStep(user)

      await user.upload(
        screen.getByLabelText(UPLOAD_LABELS.degree),
        makeFile('huge.pdf', 'application/pdf', 11 * MB),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Degree / Certificate is 11.0 MB — the limit is 10MB.',
      )
      expect(screen.queryByText('huge.pdf')).not.toBeInTheDocument()
    })

    /**
     * `applyAccept: false` is load-bearing. userEvent honours the `accept`
     * attribute by default and silently drops a non-matching file, so the change
     * handler would never fire and this would assert nothing. The client-side
     * MIME check exists for exactly the routes `accept` cannot police — a
     * drag-and-drop, or a file picker switched to "All Files" — and that is what
     * this reproduces.
     */
    it('rejects a file whose type is outside the accepted list', async () => {
      const user = userEvent.setup({ applyAccept: false })
      render(<OnboardingPage />)
      await completeProfileStep(user)

      await user.upload(
        screen.getByLabelText(UPLOAD_LABELS.degree),
        makeFile('notes.txt', 'text/plain'),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Degree / Certificate must be a PDF, JPG or PNG file.',
      )
      expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    })

    it('rejects a PDF for the ID scans, which accept images only', async () => {
      const user = userEvent.setup({ applyAccept: false })
      render(<OnboardingPage />)
      await completeProfileStep(user)
      await completeCredentialsStep(user)

      await user.upload(
        screen.getByLabelText(UPLOAD_LABELS.idFront),
        makeFile('passport.pdf', 'application/pdf'),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Government ID (front) must be a JPG or PNG file.',
      )
    })

    it('exposes an accept attribute matching the displayed copy', async () => {
      const user = userEvent.setup()
      render(<OnboardingPage />)
      await completeProfileStep(user)

      expect(screen.getByLabelText(UPLOAD_LABELS.degree)).toHaveAttribute(
        'accept',
        'application/pdf,image/jpeg,image/png',
      )

      await completeCredentialsStep(user)
      expect(screen.getByLabelText(UPLOAD_LABELS.idFront)).toHaveAttribute(
        'accept',
        'image/jpeg,image/png',
      )
    })
  })

  describe('submit gating', () => {
    it('stays disabled until required uploads and both consents are satisfied', async () => {
      const user = userEvent.setup()
      render(<OnboardingPage />)

      await completeProfileStep(user)
      await completeCredentialsStep(user, { withDegree: true })
      await completeIdentityStep(user, { withIdScans: false })

      // Consents alone are not enough any more.
      expect(submitButton()).toBeDisabled()
      await acceptConsents(user)
      expect(submitButton()).toBeDisabled()
      expect(
        screen.getByText(/Government ID \(front\), Government ID \(back\)/),
      ).toBeInTheDocument()

      // Supply the missing ID scans.
      await user.click(screen.getByRole('button', { name: /back/i }))
      await user.upload(screen.getByLabelText(UPLOAD_LABELS.idFront), ID_FRONT_FILE)
      await user.upload(screen.getByLabelText(UPLOAD_LABELS.idBack), ID_BACK_FILE)
      await clickContinue(user)

      expect(submitButton()).toBeEnabled()
    })

    it('stays disabled with every upload done but consents unchecked', async () => {
      const user = userEvent.setup()
      render(<OnboardingPage />)

      await completeProfileStep(user)
      await completeCredentialsStep(user)
      await completeIdentityStep(user)

      expect(submitButton()).toBeDisabled()

      await user.click(screen.getByRole('checkbox', { name: /i consent to advisorconnect/i }))
      expect(submitButton()).toBeDisabled()

      await user.click(screen.getByRole('checkbox', { name: /i agree to the/i }))
      expect(submitButton()).toBeEnabled()
    })
  })

  describe('submission', () => {
    it('uploads every chosen document, then submits with the collected object keys', async () => {
      const spies = spyOnSubmitFlow()
      const user = userEvent.setup()
      render(<OnboardingPage />)

      await completeProfileStep(user)
      await completeCredentialsStep(user)
      await completeIdentityStep(user)
      await acceptConsents(user)
      await user.click(submitButton())

      expect(await screen.findByText(/application submitted!/i)).toBeInTheDocument()

      // One presigned URL per selected file — the optional license was skipped.
      expect(spies.presign).toEqual([
        { fileName: 'degree.pdf', mimeType: 'application/pdf', docType: 'QUALIFICATION' },
        { fileName: 'id-front.png', mimeType: 'image/png', docType: 'ID_PROOF' },
        { fileName: 'id-back.png', mimeType: 'image/png', docType: 'ID_PROOF' },
      ])

      // …and one PUT straight at storage for each, carrying no JWT.
      expect(spies.storagePuts).toHaveLength(3)
      expect(spies.storagePuts.map((put) => put.authorization)).toEqual([null, null, null])

      expect(spies.submissions).toHaveLength(1)
      expect(spies.submissions[0]).toEqual({
        username: 'jane_advisor',
        professionalTitle: 'Licensed Clinical Psychologist',
        bio: 'Fifteen years helping people navigate anxiety, burnout and career change.',
        sectors: ['MENTAL_HEALTH', 'CAREER'],
        qualification: 'PhD',
        fieldOfStudy: 'Clinical Psychology',
        experienceYears: '6–10 years',
        previousWork: 'Head of psychology at a community clinic.',
        legalFirstName: 'Jane',
        legalLastName: 'Doe',
        dateOfBirth: '1990-01-01',
        addressFull: '123 Main Street, New York, NY, 10001',
        country: 'United States',
        // Mental Health is one of the two selected sectors, so the license block is required.
        licenseNumber: 'LPC-4471',
        licenseIssuingAuthority: 'California Board of Behavioral Sciences',
        licenseState: 'CA',
        documents: [
          {
            s3Key: 'applications/user-1/degree.pdf',
            fileName: 'degree.pdf',
            sizeBytes: 2048,
            mimeType: 'application/pdf',
          },
          {
            s3Key: 'applications/user-1/id-front.png',
            fileName: 'id-front.png',
            sizeBytes: 2048,
            mimeType: 'image/png',
          },
          {
            s3Key: 'applications/user-1/id-back.png',
            fileName: 'id-back.png',
            sizeBytes: 2048,
            mimeType: 'image/png',
          },
        ],
      })
    })

    it('shows the returned application id in the success modal', async () => {
      spyOnSubmitFlow()
      const user = userEvent.setup()
      render(<OnboardingPage />)

      await completeProfileStep(user)
      await completeCredentialsStep(user)
      await completeIdentityStep(user)
      await acceptConsents(user)
      await user.click(submitButton())

      expect(await screen.findByText('application-new')).toBeInTheDocument()
    })

    it('includes the optional license document when one is chosen', async () => {
      const spies = spyOnSubmitFlow()
      const user = userEvent.setup()
      render(<OnboardingPage />)

      await completeProfileStep(user)
      await user.selectOptions(screen.getByLabelText(/highest qualification/i), 'PhD')
      fill(/field of study/i, 'Clinical Psychology')
      await user.selectOptions(screen.getByLabelText(/years of experience/i), '6–10 years')
      fill(/license number/i, 'LPC-4471')
      fill(/issuing authority/i, 'California Board of Behavioral Sciences')
      fill(/license state/i, 'CA')
      await user.upload(screen.getByLabelText(UPLOAD_LABELS.degree), DEGREE_FILE)
      await user.upload(
        screen.getByLabelText(UPLOAD_LABELS.license),
        makeFile('license.pdf', 'application/pdf'),
      )
      await clickContinue(user)
      await completeIdentityStep(user)
      await acceptConsents(user)
      await user.click(submitButton())

      await waitFor(() => expect(spies.submissions).toHaveLength(1))
      expect(spies.submissions[0].documents.map((d) => d.s3Key)).toEqual([
        'applications/user-1/degree.pdf',
        'applications/user-1/license.pdf',
        'applications/user-1/id-front.png',
        'applications/user-1/id-back.png',
      ])
    })

    it('surfaces a submission failure and does not show the success modal', async () => {
      const spies = spyOnSubmitFlow(() =>
        HttpResponse.json({ message: 'Username already taken' }, { status: 409 }),
      )
      const user = userEvent.setup()
      render(<OnboardingPage />)

      await completeProfileStep(user)
      await completeCredentialsStep(user)
      await completeIdentityStep(user)
      await acceptConsents(user)
      await user.click(submitButton())

      expect(await screen.findByRole('alert')).toHaveTextContent('Username already taken')
      expect(screen.queryByText(/application submitted!/i)).not.toBeInTheDocument()
      // The uploads did happen; only the final call failed.
      expect(spies.storagePuts).toHaveLength(3)
      // Still on the review step, and re-submittable.
      expect(submitButton()).toBeEnabled()
    })

    it('surfaces an upload failure without ever calling the apply endpoint', async () => {
      const spies = spyOnSubmitFlow()
      server.use(
        http.post('*/api/advisors/apply/upload-url', () =>
          HttpResponse.json({ message: 'Storage temporarily unavailable' }, { status: 503 }),
        ),
      )
      const user = userEvent.setup()
      render(<OnboardingPage />)

      await completeProfileStep(user)
      await completeCredentialsStep(user)
      await completeIdentityStep(user)
      await acceptConsents(user)
      await user.click(submitButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Storage temporarily unavailable',
      )
      expect(spies.submissions).toHaveLength(0)
      expect(screen.queryByText(/application submitted!/i)).not.toBeInTheDocument()
    })
  })
})
