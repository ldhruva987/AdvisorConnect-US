import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, FileText, Upload, X } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { ErrorBanner } from '@/shared/components/ui/ErrorBanner'
import { Input, Textarea } from '@/shared/components/ui/Input'
import { Modal } from '@/shared/components/ui/Modal'
import { Navbar } from '@/shared/components/layout/Navbar'
import {
  uploadFileToPresignedUrl,
  usePresignedUpload,
} from '@/features/onboarding/hooks/usePresignedUpload'
import { useSubmitApplication } from '@/features/onboarding/hooks/useSubmitApplication'
import { getErrorMessage } from '@/lib/getErrorMessage'
import { ALL_SECTORS, SECTOR_LABELS, type AdvisorSectorEnum } from '@/lib/sectors'
import type { DocumentMetadataRequest, SubmitApplicationRequest, UploadDocType } from '@/types/api'

const STEPS = ['Public Profile', 'Credentials', 'Identity Verification', 'Review & Submit']

/* -------------------------------------------------------------------------- */
/* Document uploads                                                           */
/* -------------------------------------------------------------------------- */

const MB = 1024 * 1024

type SlotId = 'degree' | 'license' | 'idFront' | 'idBack'

interface UploadSlot {
  id: SlotId
  /** Subject of the validation sentence, e.g. "Degree / Certificate must be…". */
  name: string
  /** The input is visually hidden, so its accessible name comes from here. */
  ariaLabel: string
  docType: UploadDocType
  accept: string
  /**
   * Enforced client-side as well as via `accept`. `accept` is only a file-picker
   * filter — a drag-and-drop or a picker set to "All Files" walks straight past it.
   */
  mimeTypes: string[]
  typeLabel: string
  /** Must stay in step with the limit printed in the zone's helper copy. */
  maxBytes: number
  sizeLabel: string
  required: boolean
}

/**
 * The four document slots, mirroring the copy already in the wizard. `license`
 * is the only optional one, per its "(optional)" label in step 2.
 *
 * A professional license is a credential rather than an identity document, so
 * it shares `QUALIFICATION` with the degree; `UploadDocType` has no narrower
 * value and `OTHER` would say strictly less about it.
 */
const UPLOAD_SLOTS: UploadSlot[] = [
  {
    id: 'degree',
    name: 'Degree / Certificate',
    ariaLabel: 'Upload degree or certificate',
    docType: 'QUALIFICATION',
    accept: 'application/pdf,image/jpeg,image/png',
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    typeLabel: 'PDF, JPG or PNG',
    maxBytes: 10 * MB,
    sizeLabel: '10MB',
    required: true,
  },
  {
    id: 'license',
    name: 'License / Registration',
    ariaLabel: 'Upload license or registration',
    docType: 'QUALIFICATION',
    accept: 'application/pdf,image/jpeg,image/png',
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    typeLabel: 'PDF, JPG or PNG',
    maxBytes: 10 * MB,
    sizeLabel: '10MB',
    required: false,
  },
  {
    id: 'idFront',
    name: 'Government ID (front)',
    ariaLabel: 'Upload government ID front side',
    docType: 'ID_PROOF',
    accept: 'image/jpeg,image/png',
    mimeTypes: ['image/jpeg', 'image/png'],
    typeLabel: 'JPG or PNG',
    maxBytes: 5 * MB,
    sizeLabel: '5MB',
    required: true,
  },
  {
    id: 'idBack',
    name: 'Government ID (back)',
    ariaLabel: 'Upload government ID back side',
    docType: 'ID_PROOF',
    accept: 'image/jpeg,image/png',
    mimeTypes: ['image/jpeg', 'image/png'],
    typeLabel: 'JPG or PNG',
    maxBytes: 5 * MB,
    sizeLabel: '5MB',
    required: true,
  },
]

const SLOTS_BY_ID = Object.fromEntries(UPLOAD_SLOTS.map((s) => [s.id, s])) as Record<
  SlotId,
  UploadSlot
>

const REQUIRED_SLOTS = UPLOAD_SLOTS.filter((s) => s.required)

type FileMap = Record<SlotId, File | null>
type ErrorMap = Record<SlotId, string | null>

const NO_FILES: FileMap = { degree: null, license: null, idFront: null, idBack: null }
const NO_ERRORS: ErrorMap = { degree: null, license: null, idFront: null, idBack: null }

/** `1536` → `"1.5 KB"`. Rounded, because this is a reassurance, not an audit trail. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

/** Returns a user-facing reason to reject, or `null` when the file is acceptable. */
function validateFile(file: File, slot: UploadSlot): string | null {
  if (!slot.mimeTypes.includes(file.type)) {
    return `${slot.name} must be a ${slot.typeLabel} file.`
  }
  if (file.size > slot.maxBytes) {
    return `${slot.name} is ${formatFileSize(file.size)} — the limit is ${slot.sizeLabel}.`
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function OnboardingPage() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [successOpen, setSuccessOpen] = useState(false)

  const [form, setForm] = useState({
    username: '',
    title: '',
    bio: '',
    // Backend vocabulary (`MENTAL_HEALTH`), rendered through `SECTOR_LABELS`.
    selectedSectors: [] as AdvisorSectorEnum[],
    languages: '',
    qualification: '',
    fieldOfStudy: '',
    experienceYears: '',
    previousWork: '',
    // Required only when Finance or Mental Health is among selectedSectors — enforced
    // server-side, mirrored here so the form can show the fields and the submit button can
    // reflect the requirement before the round trip.
    licenseNumber: '',
    licenseIssuingAuthority: '',
    licenseState: '',
    legalFirstName: '',
    legalLastName: '',
    dob: '',
    streetAddress: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    idType: '',
    consentData: false,
    consentTerms: false,
  })

  const [files, setFiles] = useState<FileMap>(NO_FILES)
  const [fileErrors, setFileErrors] = useState<ErrorMap>(NO_ERRORS)
  const [uploading, setUploading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [applicationId, setApplicationId] = useState<string | null>(null)

  const presignUpload = usePresignedUpload()
  const submitApplication = useSubmitApplication()

  const update = (key: keyof typeof form, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const toggleSector = (sector: AdvisorSectorEnum) => {
    setForm((prev) => ({
      ...prev,
      selectedSectors: prev.selectedSectors.includes(sector)
        ? prev.selectedSectors.filter((s) => s !== sector)
        : [...prev.selectedSectors, sector],
    }))
  }

  const handleFileChange = (slot: UploadSlot, selected: File | undefined) => {
    if (!selected) return
    const error = validateFile(selected, slot)
    // A rejected file must not silently replace an already-accepted one.
    setFileErrors((prev) => ({ ...prev, [slot.id]: error }))
    setFiles((prev) => ({ ...prev, [slot.id]: error ? null : selected }))
  }

  const clearFile = (slot: UploadSlot) => {
    setFiles((prev) => ({ ...prev, [slot.id]: null }))
    setFileErrors((prev) => ({ ...prev, [slot.id]: null }))
  }

  const handleContinue = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep((s) => s + 1)
  }

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1)
  }

  const missingRequired = REQUIRED_SLOTS.filter((slot) => !files[slot.id])
  const busy = uploading || submitApplication.isPending
  const licenseRequired =
    form.selectedSectors.includes('FINANCE') || form.selectedSectors.includes('MENTAL_HEALTH')
  const hasLicenseFields =
    !licenseRequired ||
    (form.licenseNumber.trim() !== '' &&
      form.licenseIssuingAuthority.trim() !== '' &&
      form.licenseState.trim() !== '')
  const canSubmit =
    form.consentData &&
    form.consentTerms &&
    missingRequired.length === 0 &&
    hasLicenseFields &&
    !busy

  /**
   * Presign → PUT → submit, in that order and strictly sequentially: the
   * application body carries the object keys, so every upload has to have
   * landed before `POST /advisors/apply` goes out.
   */
  const handleSubmit = async () => {
    setSubmitError(null)

    const pending = UPLOAD_SLOTS.map((slot) => ({ slot, file: files[slot.id] })).filter(
      (entry): entry is { slot: UploadSlot; file: File } => entry.file !== null,
    )

    // The backend's SubmitApplicationRequest.documents is @NotEmpty @Valid List<
    // DocumentMetadataRequest> — a bare list of object keys fails validation with a 400. Each
    // entry needs the same filename/size/type the presign request itself carried.
    const documents: DocumentMetadataRequest[] = []
    setUploading(true)
    try {
      for (const { slot, file } of pending) {
        const presigned = await presignUpload.mutateAsync({
          fileName: file.name,
          mimeType: file.type,
          docType: slot.docType,
        })
        await uploadFileToPresignedUrl(file, presigned.uploadUrl)
        documents.push({
          s3Key: presigned.objectKey,
          fileName: file.name,
          sizeBytes: file.size,
          mimeType: file.type,
        })
      }
    } catch (err) {
      setSubmitError(getErrorMessage(err))
      return
    } finally {
      setUploading(false)
    }

    const requiresLicense = form.selectedSectors.some(
      (sector) => sector === 'FINANCE' || sector === 'MENTAL_HEALTH',
    )

    const body: SubmitApplicationRequest = {
      username: form.username,
      professionalTitle: form.title,
      bio: form.bio,
      sectors: form.selectedSectors,
      qualification: form.qualification,
      fieldOfStudy: form.fieldOfStudy,
      experienceYears: form.experienceYears,
      previousWork: form.previousWork.trim() || undefined,
      legalFirstName: form.legalFirstName,
      legalLastName: form.legalLastName,
      dateOfBirth: form.dob,
      // The backend takes one address string; the form collects it in parts.
      addressFull: [form.streetAddress, form.city, form.state, form.zip]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', '),
      country: form.country,
      ...(requiresLicense && {
        licenseNumber: form.licenseNumber,
        licenseIssuingAuthority: form.licenseIssuingAuthority,
        licenseState: form.licenseState,
      }),
      documents,
    }

    try {
      const id = await submitApplication.mutateAsync(body)
      setApplicationId(id)
      setSuccessOpen(true)
    } catch (err) {
      setSubmitError(getErrorMessage(err))
    }
  }

  const stepClass = (i: number) => {
    if (i < currentStep) return 'step-done'
    if (i === currentStep) return 'step-active'
    return 'step-inactive'
  }

  /** The dashed drop zone, or the file chip once a file is accepted. */
  const renderUploadSlot = (
    slotId: SlotId,
    zone: { className: string; children: ReactNode },
  ) => {
    const slot = SLOTS_BY_ID[slotId]
    const file = files[slotId]
    const error = fileErrors[slotId]

    return (
      <div>
        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5">
            <FileText className="w-4 h-4 text-ink-400 flex-shrink-0" />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-ink-700">{file.name}</p>
              <p className="text-xs text-ink-400">{formatFileSize(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => clearFile(slot)}
              aria-label={`Remove ${file.name}`}
              className="flex-shrink-0 w-7 h-7 rounded-lg text-ink-400 hover:text-danger-600 hover:bg-danger-100 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label htmlFor={`upload-${slot.id}`} className={zone.className}>
            {zone.children}
          </label>
        )}

        <input
          id={`upload-${slot.id}`}
          type="file"
          accept={slot.accept}
          aria-label={slot.ariaLabel}
          className="hidden"
          onChange={(e) => handleFileChange(slot, e.target.files?.[0])}
        />

        {error && (
          <p role="alert" className="mt-1.5 text-xs font-medium text-danger-600">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <Navbar />
      <div className="pt-16 max-w-2xl mx-auto px-4 py-10">
        <h1 className="font-heading font-medium text-3xl text-ink-900 mb-2 text-center">Become an Advisor</h1>
        <p className="text-ink-500 text-center mb-8">Join our verified network and start helping people today.</p>

        {/* Stepper */}
        <div className="flex items-center mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${stepClass(i)}`}
                >
                  {i < currentStep ? <CheckCircle className="w-5 h-5" /> : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block whitespace-nowrap ${
                  i === currentStep ? 'text-oxblood-700' : i < currentStep ? 'text-pine-600' : 'text-ink-400'
                }`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mt-[-14px] sm:mt-[-28px] transition-all ${
                  i < currentStep ? 'bg-pine-600' : 'bg-ink-200'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl border border-ink-200 p-8">
          {/* STEP 0 — Public Profile */}
          {currentStep === 0 && (
            <div className="space-y-5">
              <h2 className="font-heading font-semibold text-xl text-ink-900">Public Profile</h2>
              <p className="text-sm text-ink-500">This information will be visible to users browsing advisors.</p>

              <div>
                <label htmlFor="username" className="block text-sm font-medium text-ink-700 mb-1.5">Username</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 font-medium">@</span>
                  <input
                    id="username"
                    type="text"
                    placeholder="YourHandle"
                    value={form.username}
                    onChange={(e) => update('username', e.target.value)}
                    className="input-base pl-8"
                  />
                </div>
              </div>

              <Input
                label="Professional Title"
                placeholder="e.g. Licensed Clinical Psychologist"
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
              />

              <Textarea
                label="Bio"
                placeholder="Tell potential clients about your expertise, approach, and how you can help..."
                rows={4}
                value={form.bio}
                onChange={(e) => update('bio', e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-ink-700 mb-2">Sectors (select all that apply)</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SECTORS.map((sector) => (
                    <label
                      key={sector}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        form.selectedSectors.includes(sector)
                          ? 'border-oxblood-700 bg-oxblood-50'
                          : 'border-ink-200 hover:border-ink-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.selectedSectors.includes(sector)}
                        onChange={() => toggleSector(sector)}
                        className="w-4 h-4 accent-oxblood-600 rounded"
                      />
                      <span className="text-sm font-medium text-ink-700">{SECTOR_LABELS[sector]}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Input
                label="Languages"
                placeholder="e.g. English, Spanish"
                value={form.languages}
                onChange={(e) => update('languages', e.target.value)}
                helper="Separate multiple languages with commas"
              />
            </div>
          )}

          {/* STEP 1 — Credentials */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <h2 className="font-heading font-semibold text-xl text-ink-900">Credentials</h2>
              <p className="text-sm text-ink-500">These will be verified by our team before your profile goes live.</p>

              <div>
                <label htmlFor="qualification" className="block text-sm font-medium text-ink-700 mb-1.5">Highest Qualification</label>
                <select
                  id="qualification"
                  value={form.qualification}
                  onChange={(e) => update('qualification', e.target.value)}
                  className="input-base"
                >
                  <option value="">Select qualification...</option>
                  <option>PhD</option>
                  <option>Master's Degree</option>
                  <option>Bachelor's Degree</option>
                  <option>Professional Certificate</option>
                  <option>Professional License</option>
                  <option>Other</option>
                </select>
              </div>

              <Input
                label="Field of Study / Specialisation"
                placeholder="e.g. Clinical Psychology"
                value={form.fieldOfStudy}
                onChange={(e) => update('fieldOfStudy', e.target.value)}
              />

              <div>
                <label htmlFor="experience-years" className="block text-sm font-medium text-ink-700 mb-1.5">Years of Experience</label>
                <select
                  id="experience-years"
                  value={form.experienceYears}
                  onChange={(e) => update('experienceYears', e.target.value)}
                  className="input-base"
                >
                  <option value="">Select range...</option>
                  <option>1–2 years</option>
                  <option>3–5 years</option>
                  <option>6–10 years</option>
                  <option>11–15 years</option>
                  <option>15+ years</option>
                </select>
              </div>

              {/* Degree upload */}
              <div>
                <label htmlFor="upload-degree" className="block text-sm font-medium text-ink-700 mb-1.5">
                  Upload Degree / Certificate <span className="text-danger-600">*</span>
                </label>
                {renderUploadSlot('degree', {
                  className:
                    'block border-2 border-dashed border-ink-200 rounded-xl p-8 text-center hover:border-oxblood-700 hover:bg-oxblood-50 transition-all cursor-pointer',
                  children: (
                    <>
                      <Upload className="w-8 h-8 text-ink-400 mx-auto mb-2" />
                      <p className="text-sm font-medium text-ink-700 mb-1">Click to upload or drag & drop</p>
                      <p className="text-xs text-ink-400">PDF, JPG, PNG up to 10MB</p>
                    </>
                  ),
                })}
              </div>

              {/* License upload (optional) */}
              <div>
                <label htmlFor="upload-license" className="block text-sm font-medium text-ink-700 mb-1.5">
                  Upload License / Registration <span className="text-ink-400 font-normal">(optional)</span>
                </label>
                {renderUploadSlot('license', {
                  className:
                    'block border-2 border-dashed border-ink-100 rounded-xl p-5 text-center hover:border-ink-300 transition-all cursor-pointer',
                  children: (
                    <>
                      <Upload className="w-6 h-6 text-ink-300 mx-auto mb-1" />
                      <p className="text-xs text-ink-400">PDF, JPG, PNG up to 10MB</p>
                    </>
                  ),
                })}
              </div>

              {/*
                Finance (investment advice) and Mental Health (clinical counseling) are the two
                verticals where the US treats charging for advice without a checked professional
                credential as a real regulatory liability (state RIA/SEC registration; state
                clinical licensing boards), not just a quality signal — so the backend refuses to
                approve either without one. Shown only for those sectors so a Career or Parenting
                applicant, for whom this genuinely doesn't apply, isn't asked for it.
              */}
              {(form.selectedSectors.includes('FINANCE') ||
                form.selectedSectors.includes('MENTAL_HEALTH')) && (
                <div className="space-y-4 rounded-xl border border-warn-600/30 bg-warn-100/40 p-4">
                  <p className="text-sm font-medium text-ink-800">
                    Professional license required for {form.selectedSectors.includes('FINANCE') ? 'Finance' : ''}
                    {form.selectedSectors.includes('FINANCE') && form.selectedSectors.includes('MENTAL_HEALTH') ? ' and ' : ''}
                    {form.selectedSectors.includes('MENTAL_HEALTH') ? 'Mental Health' : ''} advisors
                  </p>
                  <Input
                    label="License Number"
                    placeholder="e.g. LPC-4471 or CRD number"
                    value={form.licenseNumber}
                    onChange={(e) => update('licenseNumber', e.target.value)}
                  />
                  <Input
                    label="Issuing Authority"
                    placeholder="e.g. California Board of Behavioral Sciences, or SEC"
                    value={form.licenseIssuingAuthority}
                    onChange={(e) => update('licenseIssuingAuthority', e.target.value)}
                  />
                  <Input
                    label="License State"
                    placeholder="Two-letter state code, or FEDERAL for SEC/FINRA credentials"
                    value={form.licenseState}
                    onChange={(e) => update('licenseState', e.target.value)}
                  />
                  <p className="text-xs text-ink-500">
                    Our team verifies this against the issuing authority before your profile goes
                    live — your application cannot be approved until that check is complete.
                  </p>
                </div>
              )}

              <Textarea
                label="Previous Work / Experience Summary"
                placeholder="Briefly describe your professional experience, notable achievements, or previous roles..."
                rows={4}
                value={form.previousWork}
                onChange={(e) => update('previousWork', e.target.value)}
              />
            </div>
          )}

          {/* STEP 2 — Identity Verification */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <h2 className="font-heading font-semibold text-xl text-ink-900">Identity Verification</h2>

              {/* Warning banner */}
              <div className="bg-warn-100 border border-warn-500/30 rounded-xl p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-warn-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-ink-800">Strictly Private — Never Shown to Users</p>
                  <p className="text-xs text-ink-600 mt-0.5">
                    This information is encrypted and only accessed by AdvisorConnect's compliance team during the verification process. It will never be shared with users or visible on your public profile.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Legal First Name"
                  placeholder="John"
                  value={form.legalFirstName}
                  onChange={(e) => update('legalFirstName', e.target.value)}
                />
                <Input
                  label="Legal Last Name"
                  placeholder="Smith"
                  value={form.legalLastName}
                  onChange={(e) => update('legalLastName', e.target.value)}
                />
              </div>

              <Input
                label="Date of Birth"
                type="date"
                value={form.dob}
                onChange={(e) => update('dob', e.target.value)}
              />

              <Input
                label="Street Address"
                placeholder="123 Main Street, Apt 4B"
                value={form.streetAddress}
                onChange={(e) => update('streetAddress', e.target.value)}
              />

              <div className="grid grid-cols-3 gap-3">
                <Input
                  label="City"
                  placeholder="New York"
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                />
                <Input
                  label="State / Province"
                  placeholder="NY"
                  value={form.state}
                  onChange={(e) => update('state', e.target.value)}
                />
                <Input
                  label="ZIP / Postal Code"
                  placeholder="10001"
                  value={form.zip}
                  onChange={(e) => update('zip', e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="country" className="block text-sm font-medium text-ink-700 mb-1.5">Country</label>
                <select
                  id="country"
                  value={form.country}
                  onChange={(e) => update('country', e.target.value)}
                  className="input-base"
                >
                  <option value="">Select country...</option>
                  <option>United States</option>
                  <option>United Kingdom</option>
                  <option>Canada</option>
                  <option>Australia</option>
                  <option>India</option>
                  <option>Germany</option>
                  <option>France</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label htmlFor="id-type" className="block text-sm font-medium text-ink-700 mb-1.5">Government ID Type</label>
                <select
                  id="id-type"
                  value={form.idType}
                  onChange={(e) => update('idType', e.target.value)}
                  className="input-base"
                >
                  <option value="">Select ID type...</option>
                  <option>Passport</option>
                  <option>Driver's License</option>
                  <option>National ID Card</option>
                </select>
              </div>

              {/* ID upload — front and back */}
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-2">
                  Upload Government ID <span className="text-danger-600">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {renderUploadSlot('idFront', {
                    className:
                      'block border-2 border-dashed border-ink-200 rounded-xl p-5 text-center hover:border-oxblood-700 hover:bg-oxblood-50 transition-all cursor-pointer',
                    children: (
                      <>
                        <Upload className="w-6 h-6 text-ink-400 mx-auto mb-1.5" />
                        <p className="text-xs font-medium text-ink-600">Front Side</p>
                        <p className="text-xs text-ink-400 mt-0.5">JPG, PNG up to 5MB</p>
                      </>
                    ),
                  })}
                  {renderUploadSlot('idBack', {
                    className:
                      'block border-2 border-dashed border-ink-200 rounded-xl p-5 text-center hover:border-oxblood-700 hover:bg-oxblood-50 transition-all cursor-pointer',
                    children: (
                      <>
                        <Upload className="w-6 h-6 text-ink-400 mx-auto mb-1.5" />
                        <p className="text-xs font-medium text-ink-600">Back Side</p>
                        <p className="text-xs text-ink-400 mt-0.5">JPG, PNG up to 5MB</p>
                      </>
                    ),
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — Review & Submit */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <h2 className="font-heading font-semibold text-xl text-ink-900">Review & Submit</h2>
              <p className="text-sm text-ink-500">Please review your application before submitting. Our team will verify within 2–3 business days.</p>

              {/* Public Profile summary */}
              <div className="border border-ink-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-ink-800">Public Profile</h3>
                  <button onClick={() => setCurrentStep(0)} className="text-xs text-oxblood-700 font-medium hover:text-oxblood-600">Edit</button>
                </div>
                <div className="space-y-1.5 text-sm text-ink-600">
                  <p><span className="text-ink-400">Username:</span> @{form.username || 'Not set'}</p>
                  <p><span className="text-ink-400">Title:</span> {form.title || 'Not set'}</p>
                  <p>
                    <span className="text-ink-400">Sectors:</span>{' '}
                    {form.selectedSectors.map((s) => SECTOR_LABELS[s]).join(', ') || 'None selected'}
                  </p>
                  <p><span className="text-ink-400">Languages:</span> {form.languages || 'Not set'}</p>
                </div>
              </div>

              {/* Credentials summary */}
              <div className="border border-ink-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-ink-800">Credentials</h3>
                  <button onClick={() => setCurrentStep(1)} className="text-xs text-oxblood-700 font-medium hover:text-oxblood-600">Edit</button>
                </div>
                <div className="space-y-1.5 text-sm text-ink-600">
                  <p><span className="text-ink-400">Qualification:</span> {form.qualification || 'Not set'}</p>
                  <p><span className="text-ink-400">Field of Study:</span> {form.fieldOfStudy || 'Not set'}</p>
                  <p><span className="text-ink-400">Experience:</span> {form.experienceYears || 'Not set'}</p>
                  {licenseRequired && (
                    <>
                      <p><span className="text-ink-400">License Number:</span> {form.licenseNumber || 'Not set'}</p>
                      <p><span className="text-ink-400">Issuing Authority:</span> {form.licenseIssuingAuthority || 'Not set'}</p>
                      <p><span className="text-ink-400">License State:</span> {form.licenseState || 'Not set'}</p>
                    </>
                  )}
                </div>
              </div>

              {/* Documents summary */}
              <div className="border border-ink-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-ink-800">Documents</h3>
                  <button onClick={() => setCurrentStep(1)} className="text-xs text-oxblood-700 font-medium hover:text-oxblood-600">Edit</button>
                </div>
                <ul className="space-y-1.5 text-sm text-ink-600">
                  {UPLOAD_SLOTS.map((slot) => {
                    const file = files[slot.id]
                    return (
                      <li key={slot.id} className="flex items-center gap-2">
                        <span className="text-ink-400">{slot.name}:</span>
                        {file ? (
                          <span className="truncate">
                            {file.name}{' '}
                            <span className="text-ink-400">({formatFileSize(file.size)})</span>
                          </span>
                        ) : (
                          <span className={slot.required ? 'text-danger-600 font-medium' : 'text-ink-400'}>
                            {slot.required ? 'Required — not uploaded' : 'Not uploaded'}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* Identity summary (private) */}
              <div className="border border-danger-600/30 rounded-xl p-4 bg-danger-100/30">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink-800">Identity (Private)</h3>
                    <span className="bg-danger-100 text-danger-600 text-xs font-bold px-2 py-0.5 rounded-full">Admin Eyes Only</span>
                  </div>
                  <button onClick={() => setCurrentStep(2)} className="text-xs text-oxblood-700 font-medium hover:text-oxblood-600">Edit</button>
                </div>
                <div className="space-y-1.5 text-sm text-ink-600">
                  <p><span className="text-ink-400">Legal Name:</span> <span className="blur-sm select-none">{form.legalFirstName || 'John'} {form.legalLastName || 'Smith'}</span></p>
                  <p><span className="text-ink-400">Date of Birth:</span> <span className="blur-sm select-none">{form.dob || '01/01/1990'}</span></p>
                  <p><span className="text-ink-400">Address:</span> <span className="blur-sm select-none">{form.streetAddress || '123 Main St'}</span></p>
                  <p><span className="text-ink-400">ID Type:</span> {form.idType || 'Not set'}</p>
                </div>
              </div>

              {/* Consents */}
              <div className="space-y-3 pt-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.consentData}
                    onChange={(e) => update('consentData', e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-oxblood-600"
                  />
                  <span className="text-sm text-ink-600">
                    I consent to AdvisorConnect storing and processing my personal data for identity verification purposes only.
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.consentTerms}
                    onChange={(e) => update('consentTerms', e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-oxblood-600"
                  />
                  <span className="text-sm text-ink-600">
                    I agree to the <a href="/advisor-terms" className="text-oxblood-700 underline">Advisor Terms of Service</a> and <a href="/privacy" className="text-oxblood-700 underline">Privacy Policy</a>.
                  </span>
                </label>
              </div>

              {/* Why the submit button is still disabled */}
              {missingRequired.length > 0 && (
                <p className="text-xs text-ink-500">
                  Upload the required documents before submitting:{' '}
                  {missingRequired.map((slot) => slot.name).join(', ')}.
                </p>
              )}

              {submitError && <ErrorBanner message={submitError} />}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-ink-100">
            {currentStep > 0 ? (
              <Button variant="outline" onClick={handleBack} disabled={busy}>Back</Button>
            ) : (
              <div />
            )}
            {currentStep < STEPS.length - 1 ? (
              <Button variant="primary" onClick={handleContinue}>
                Continue →
              </Button>
            ) : (
              <Button
                variant="success"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                loading={busy}
              >
                {uploading
                  ? 'Uploading documents…'
                  : submitApplication.isPending
                    ? 'Submitting…'
                    : 'Submit Application'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Success modal */}
      <Modal open={successOpen} onClose={() => { setSuccessOpen(false); navigate('/') }}>
        <div className="text-center">
          <div className="w-16 h-16 bg-pine-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-pine-600" />
          </div>
          <h2 className="font-heading font-medium text-2xl text-ink-900 mb-2">Application Submitted!</h2>
          <p className="text-ink-500 mb-6 leading-relaxed">
            Thank you for applying to become an AdvisorConnect advisor. Our compliance team will review your application within <span className="font-semibold text-ink-900">2–3 business days</span>.
          </p>
          {/* The endpoint returns the new application's UUID and nothing else. */}
          {applicationId && (
            <p className="text-sm text-ink-500 mb-4">
              Reference ID: <span className="font-mono text-ink-800">{applicationId}</span>
            </p>
          )}
          <p className="text-sm text-ink-400 mb-6">
            You'll receive an email notification once your application has been reviewed. Keep an eye on your inbox!
          </p>
          <Button variant="primary" fullWidth onClick={() => { setSuccessOpen(false); navigate('/') }}>
            Back to Home
          </Button>
        </div>
      </Modal>
    </div>
  )
}
