package com.advisorconnect.advisor.application;

import com.advisorconnect.advisor.adapter.in.web.dto.*;
import com.advisorconnect.advisor.adapter.out.messaging.AdvisorEventPublisher;
import com.advisorconnect.advisor.domain.model.*;
import com.advisorconnect.advisor.domain.port.in.AdvisorCommandUseCase;
import com.advisorconnect.advisor.domain.port.in.AdvisorQueryUseCase;
import com.advisorconnect.advisor.domain.port.out.AdvisorApplicationRepository;
import com.advisorconnect.advisor.domain.port.out.AdvisorProfileRepository;
import com.advisorconnect.advisor.domain.port.out.UserEmailCacheRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional
@Slf4j
public class AdvisorApplicationService implements AdvisorQueryUseCase, AdvisorCommandUseCase {

    private final AdvisorProfileRepository profileRepository;
    private final AdvisorApplicationRepository applicationRepository;
    private final AdvisorEventPublisher eventPublisher;
    private final UserEmailCacheRepository userEmailCacheRepository;

    // ── Query use case ──────────────────────────────────────────────────────────

    @Override
    @Transactional(readOnly = true)
    public Page<AdvisorPublicDto> findAdvisors(AdvisorSector sector, String searchQuery, Pageable pageable) {
        Page<AdvisorProfile> profiles;
        if (searchQuery != null && !searchQuery.isBlank()) {
            profiles = profileRepository.search(searchQuery, pageable);
        } else if (sector != null) {
            profiles = profileRepository.findBySector(sector, pageable);
        } else {
            profiles = profileRepository.findAll(pageable);
        }
        return profiles.map(this::toPublicDto);
    }

    @Override
    @Transactional(readOnly = true)
    public AdvisorPublicDto getAdvisorProfile(String username) {
        AdvisorProfile profile = profileRepository.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("Advisor not found: " + username));
        return toPublicDto(profile);
    }

    @Override
    @Transactional(readOnly = true)
    public AdvisorApplicationStatusDto getApplicationStatus(UUID userId) {
        AdvisorApplication app = applicationRepository.findByUserId(userId)
                .orElseThrow(() -> new IllegalArgumentException("No application found for user"));
        return AdvisorApplicationStatusDto.builder()
                .applicationId(app.getId())
                .status(app.getStatus())
                .submittedAt(app.getSubmittedAt())
                .adminMessage(app.getAdminNotes())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public Page<AdvisorApplicationSummaryDto> getApplications(ApplicationStatus status, Pageable pageable) {
        Page<AdvisorApplication> applications = status == null
                ? applicationRepository.findAll(pageable)
                : applicationRepository.findByStatus(status, pageable);
        return applications.map(this::toSummaryDto);
    }

    @Override
    @Transactional(readOnly = true)
    public AdvisorApplicationDetailDto getApplicationDetail(UUID applicationId) {
        return toDetailDto(applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("Application not found")));
    }

    // ── Command use case ────────────────────────────────────────────────────────

    @Override
    public UUID submitApplication(SubmitApplicationRequest req, UUID userId) {
        if (applicationRepository.existsByUserId(userId)) {
            throw new IllegalStateException("Application already submitted");
        }
        if (requiresLicense(req.getSectors()) && !hasLicenseFields(req)) {
            throw new IllegalArgumentException(
                    "A license number, issuing authority and state are required for FINANCE and "
                            + "MENTAL_HEALTH applications");
        }
        AdvisorApplication app = AdvisorApplication.builder()
                .userId(userId)
                .username(req.getUsername())
                .professionalTitle(req.getProfessionalTitle())
                .bio(req.getBio())
                .sectors(req.getSectors())
                .qualification(req.getQualification())
                .fieldOfStudy(req.getFieldOfStudy())
                .experienceYears(req.getExperienceYears())
                .previousWork(req.getPreviousWork())
                .legalFirstName(req.getLegalFirstName())
                .legalLastName(req.getLegalLastName())
                .dateOfBirth(req.getDateOfBirth())
                .addressFull(req.getAddressFull())
                .country(req.getCountry())
                .licenseNumber(req.getLicenseNumber())
                .licenseIssuingAuthority(req.getLicenseIssuingAuthority())
                .licenseState(req.getLicenseState())
                .documents(toDocuments(req.getDocuments()))
                .status(ApplicationStatus.PENDING)
                .build();
        app = applicationRepository.save(app);
        eventPublisher.publishApplicationSubmitted(app.getId(), userId, req.getUsername());
        return app.getId();
    }

    @Override
    public void approveAdvisor(UUID applicationId, UUID adminId, String notes) {
        AdvisorApplication app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("Application not found"));
        if (requiresLicense(app.getSectors()) && !app.isLicenseVerified()) {
            throw new LicenseNotVerifiedException(
                    "Cannot approve: this is a FINANCE or MENTAL_HEALTH application and its "
                            + "license has not been verified yet");
        }
        app.setStatus(ApplicationStatus.APPROVED);
        app.setAdminNotes(notes);
        app.setReviewedAt(Instant.now());
        app.setReviewedBy(adminId);
        applicationRepository.save(app);

        // Promote to public profile
        AdvisorProfile profile = AdvisorProfile.builder()
                .id(app.getUserId())
                .username(app.getUsername())
                .professionalTitle(app.getProfessionalTitle())
                .bio(app.getBio())
                .sectors(app.getSectors())
                .averageRating(BigDecimal.ZERO)
                .isVerified(true)
                .build();
        profileRepository.save(profile);
        eventPublisher.publishAdvisorApproved(
                app.getUserId(), app.getUsername(), adminId, lookupEmail(app.getUserId()));
    }

    @Override
    public void rejectAdvisor(UUID applicationId, UUID adminId, String reason) {
        AdvisorApplication app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("Application not found"));
        app.setStatus(ApplicationStatus.REJECTED);
        app.setAdminNotes(reason);
        app.setReviewedAt(Instant.now());
        app.setReviewedBy(adminId);
        applicationRepository.save(app);
        eventPublisher.publishAdvisorRejected(
                applicationId, reason, adminId, lookupEmail(app.getUserId()));
    }

    @Override
    public void requestMoreInfo(UUID applicationId, UUID adminId, String message) {
        AdvisorApplication app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("Application not found"));
        app.setStatus(ApplicationStatus.NEEDS_MORE_INFO);
        app.setAdminNotes(message);
        app.setReviewedBy(adminId);
        applicationRepository.save(app);
    }

    /**
     * Does not require the application to carry a regulated sector: an admin who has already
     * looked a license up loses nothing by recording that, and refusing to record it on a
     * technicality would only invite working around this method instead of through it.
     */
    @Override
    public void verifyLicense(UUID applicationId, UUID adminId) {
        AdvisorApplication app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("Application not found"));
        app.setLicenseVerified(true);
        app.setLicenseVerifiedAt(Instant.now());
        app.setLicenseVerifiedBy(adminId);
        applicationRepository.save(app);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    /** FINANCE (investment advice) and MENTAL_HEALTH (clinical counseling) are the two verticals
     *  where charging for advice without a checked credential is a real regulatory liability in
     *  the US (state RIA/SEC registration; state clinical licensing boards) rather than just a
     *  quality signal. */
    private static boolean requiresLicense(List<AdvisorSector> sectors) {
        return sectors != null
                && (sectors.contains(AdvisorSector.FINANCE) || sectors.contains(AdvisorSector.MENTAL_HEALTH));
    }

    private static boolean hasLicenseFields(SubmitApplicationRequest req) {
        return isNotBlank(req.getLicenseNumber())
                && isNotBlank(req.getLicenseIssuingAuthority())
                && isNotBlank(req.getLicenseState());
    }

    private static boolean isNotBlank(String s) {
        return s != null && !s.isBlank();
    }

    /**
     * Reads the advisor's email out of the local projection of auth-service's
     * {@code user.registered} stream.
     *
     * <p>Returns null rather than throwing when the projection has no row. The email exists so
     * notification-service can tell the applicant what was decided; a stale or incomplete cache
     * is a notification problem, and refusing to approve a verified advisor over it would be a
     * far worse failure than a missed email. The gap is logged so it is not silent.
     */
    private String lookupEmail(UUID userId) {
        if (userId == null) {
            return null;
        }
        return userEmailCacheRepository.findById(userId)
                .map(UserEmailCache::getEmail)
                .orElseGet(() -> {
                    log.warn("No cached email for userId={} — decision event will carry none", userId);
                    return null;
                });
    }

    /**
     * Stamps {@code uploadedAt} server-side and returns a mutable list — Hibernate manages an
     * {@code @ElementCollection} in place, and handing it {@code Stream.toList()} would blow up
     * on the first modification.
     */
    private static List<DocumentMetadata> toDocuments(List<DocumentMetadataRequest> requests) {
        List<DocumentMetadata> documents = new ArrayList<>();
        if (requests == null) {
            return documents;
        }
        Instant now = Instant.now();
        for (DocumentMetadataRequest d : requests) {
            documents.add(DocumentMetadata.builder()
                    .s3Key(d.getS3Key())
                    .fileName(d.getFileName())
                    .sizeBytes(d.getSizeBytes())
                    .mimeType(d.getMimeType())
                    .uploadedAt(now)
                    .build());
        }
        return documents;
    }

    // ── Mappers ─────────────────────────────────────────────────────────────────

    /** PII-free by construction — see {@link AdvisorApplicationSummaryDto}. */
    private AdvisorApplicationSummaryDto toSummaryDto(AdvisorApplication app) {
        return AdvisorApplicationSummaryDto.builder()
                .id(app.getId())
                .userId(app.getUserId())
                .username(app.getUsername())
                .professionalTitle(app.getProfessionalTitle())
                .sectors(app.getSectors())
                .qualification(app.getQualification())
                .experienceYears(app.getExperienceYears())
                .licenseIssuingAuthority(app.getLicenseIssuingAuthority())
                .licenseState(app.getLicenseState())
                .licenseVerified(app.isLicenseVerified())
                .status(app.getStatus())
                .submittedAt(app.getSubmittedAt())
                .documentCount(app.getDocuments() == null ? 0 : app.getDocuments().size())
                .build();
    }

    /** Admin-only — see {@link AdvisorApplicationDetailDto}. Documents carry no S3 key. */
    private AdvisorApplicationDetailDto toDetailDto(AdvisorApplication app) {
        List<AdvisorApplicationDetailDto.DocumentSummary> documents = app.getDocuments() == null
                ? List.of()
                : app.getDocuments().stream()
                        .map(d -> AdvisorApplicationDetailDto.DocumentSummary.builder()
                                .fileName(d.getFileName())
                                .mimeType(d.getMimeType())
                                .sizeBytes(d.getSizeBytes())
                                .uploadedAt(d.getUploadedAt())
                                .build())
                        .toList();

        return AdvisorApplicationDetailDto.builder()
                .id(app.getId())
                .userId(app.getUserId())
                .username(app.getUsername())
                .professionalTitle(app.getProfessionalTitle())
                .bio(app.getBio())
                .sectors(app.getSectors())
                .qualification(app.getQualification())
                .fieldOfStudy(app.getFieldOfStudy())
                .experienceYears(app.getExperienceYears())
                .previousWork(app.getPreviousWork())
                .legalFirstName(app.getLegalFirstName())
                .legalLastName(app.getLegalLastName())
                .dateOfBirth(app.getDateOfBirth())
                .addressFull(app.getAddressFull())
                .country(app.getCountry())
                .licenseNumber(app.getLicenseNumber())
                .licenseIssuingAuthority(app.getLicenseIssuingAuthority())
                .licenseState(app.getLicenseState())
                .licenseVerified(app.isLicenseVerified())
                .licenseVerifiedAt(app.getLicenseVerifiedAt())
                .licenseVerifiedBy(app.getLicenseVerifiedBy())
                .documents(documents)
                .status(app.getStatus())
                .adminNotes(app.getAdminNotes())
                .submittedAt(app.getSubmittedAt())
                .reviewedAt(app.getReviewedAt())
                .reviewedBy(app.getReviewedBy())
                .build();
    }

    private AdvisorPublicDto toPublicDto(AdvisorProfile p) {
        return AdvisorPublicDto.builder()
                .id(p.getId())
                .username(p.getUsername())
                .professionalTitle(p.getProfessionalTitle())
                .bio(p.getBio())
                .tags(p.getTags())
                .sectors(p.getSectors())
                .languages(p.getLanguages())
                .averageRating(p.getAverageRating())
                .reviewCount(p.getReviewCount())
                .chatCount(p.getChatCount())
                .responseTimeMinutes(p.getResponseTimeMinutes())
                .experienceYears(p.getExperienceYears())
                .isOnline(p.isOnline())
                .isVerified(p.isVerified())
                .avatarColor(p.getAvatarColor())
                .build();
    }
}
