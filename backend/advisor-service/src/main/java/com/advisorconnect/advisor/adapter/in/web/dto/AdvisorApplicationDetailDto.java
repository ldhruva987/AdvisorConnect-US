package com.advisorconnect.advisor.adapter.in.web.dto;

import com.advisorconnect.advisor.domain.model.AdvisorSector;
import com.advisorconnect.advisor.domain.model.ApplicationStatus;
import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Full application record for the admin review screen. Admin-only
 * ({@code GET /advisors/applications/{id}} requires {@code hasRole('ADMIN')}) — unlike
 * {@link AdvisorApplicationSummaryDto}, this carries the PII an admin actually needs to verify an
 * identity or a professional license: legal name, date of birth, address, country, license
 * credentials, and the submitted document metadata.
 *
 * <p>{@code documents} carries filename/type/size/timestamp only, never the S3 key: possession of
 * the key is possession of the file (see {@code DocumentMetadata}), and no download-proxy endpoint
 * exists yet to hand that out safely. Full document viewing therefore still isn't available — this
 * DTO only closes the "which files, how big, uploaded when" gap.
 */
@Data
@Builder
public class AdvisorApplicationDetailDto {

    private UUID id;
    private UUID userId;
    private String username;
    private String professionalTitle;
    private String bio;
    private List<AdvisorSector> sectors;
    private String qualification;
    private String fieldOfStudy;
    private String experienceYears;
    private String previousWork;

    private String legalFirstName;
    private String legalLastName;
    private String dateOfBirth;
    private String addressFull;
    private String country;

    private String licenseNumber;
    private String licenseIssuingAuthority;
    private String licenseState;
    private boolean licenseVerified;
    private Instant licenseVerifiedAt;
    private UUID licenseVerifiedBy;

    private List<DocumentSummary> documents;

    private ApplicationStatus status;
    private String adminNotes;
    private Instant submittedAt;
    private Instant reviewedAt;
    private UUID reviewedBy;

    @Data
    @Builder
    public static class DocumentSummary {
        private String fileName;
        private String mimeType;
        private Long sizeBytes;
        private Instant uploadedAt;
    }
}
