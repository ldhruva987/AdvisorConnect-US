package com.advisorconnect.advisor.application;

import com.advisorconnect.advisor.adapter.in.web.dto.AdvisorApplicationDetailDto;
import com.advisorconnect.advisor.adapter.in.web.dto.AdvisorApplicationSummaryDto;
import com.advisorconnect.advisor.adapter.in.web.dto.DocumentMetadataRequest;
import com.advisorconnect.advisor.adapter.in.web.dto.SubmitApplicationRequest;
import com.advisorconnect.advisor.adapter.out.messaging.AdvisorEventPublisher;
import com.advisorconnect.advisor.domain.model.AdvisorApplication;
import com.advisorconnect.advisor.domain.model.AdvisorSector;
import com.advisorconnect.advisor.domain.model.ApplicationStatus;
import com.advisorconnect.advisor.domain.model.DocumentMetadata;
import com.advisorconnect.advisor.domain.model.LicenseNotVerifiedException;
import com.advisorconnect.advisor.domain.model.UserEmailCache;
import com.advisorconnect.advisor.domain.port.out.AdvisorApplicationRepository;
import com.advisorconnect.advisor.domain.port.out.AdvisorProfileRepository;
import com.advisorconnect.advisor.domain.port.out.UserEmailCacheRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class AdvisorApplicationServiceTest {

    private static final String EMAIL = "advisor@example.com";

    @Mock private AdvisorProfileRepository profileRepository;
    @Mock private AdvisorApplicationRepository applicationRepository;
    @Mock private AdvisorEventPublisher eventPublisher;
    @Mock private UserEmailCacheRepository userEmailCacheRepository;

    @InjectMocks
    private AdvisorApplicationService service;

    private UUID userId;
    private UUID adminId;
    private UUID applicationId;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        adminId = UUID.randomUUID();
        applicationId = UUID.randomUUID();
    }

    // ══════════════════════════════════════════════════════ document mapping

    @Nested
    @DisplayName("submitApplication document mapping")
    class DocumentMapping {

        @Test
        @DisplayName("each requested document becomes a DocumentMetadata on the entity")
        void mapsDocuments() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            given(applicationRepository.save(any())).willAnswer(i -> i.getArgument(0));

            service.submitApplication(request(
                    document("s3/passport.pdf", "passport.pdf", 204_800L, "application/pdf"),
                    document("s3/degree.png", "degree.png", 51_200L, "image/png")), userId);

            List<DocumentMetadata> documents = captureSaved().getDocuments();
            assertThat(documents).hasSize(2);
            assertThat(documents.get(0).getS3Key()).isEqualTo("s3/passport.pdf");
            assertThat(documents.get(0).getFileName()).isEqualTo("passport.pdf");
            assertThat(documents.get(0).getSizeBytes()).isEqualTo(204_800L);
            assertThat(documents.get(0).getMimeType()).isEqualTo("application/pdf");
            assertThat(documents.get(1).getS3Key()).isEqualTo("s3/degree.png");
        }

        /**
         * A client-supplied timestamp on an identity document is not evidence of anything, so
         * {@code DocumentMetadataRequest} has no {@code uploadedAt} field at all and the server
         * stamps it here.
         */
        @Test
        @DisplayName("uploadedAt is stamped server-side, never taken from the client")
        void stampsUploadedAt() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            given(applicationRepository.save(any())).willAnswer(i -> i.getArgument(0));
            Instant before = Instant.now();

            service.submitApplication(
                    request(document("s3/a.pdf", "a.pdf", 10L, "application/pdf")), userId);

            Instant stamped = captureSaved().getDocuments().get(0).getUploadedAt();
            assertThat(stamped).isNotNull().isBetween(before, Instant.now());
        }

        /**
         * Hibernate mutates an {@code @ElementCollection} in place. An immutable
         * {@code Stream.toList()} would survive this test and then throw on the first entity
         * update in production.
         */
        @Test
        @DisplayName("the mapped list is mutable so Hibernate can manage the collection")
        void producesMutableList() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            given(applicationRepository.save(any())).willAnswer(i -> i.getArgument(0));

            service.submitApplication(
                    request(document("s3/a.pdf", "a.pdf", 10L, "application/pdf")), userId);

            List<DocumentMetadata> documents = captureSaved().getDocuments();
            assertThatCode(() -> documents.add(DocumentMetadata.builder().s3Key("x").build()))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("a null documents list becomes an empty collection, not a NPE")
        void nullDocumentsBecomesEmpty() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            given(applicationRepository.save(any())).willAnswer(i -> i.getArgument(0));
            SubmitApplicationRequest req = request();
            req.setDocuments(null);

            service.submitApplication(req, userId);

            assertThat(captureSaved().getDocuments()).isEmpty();
        }

        @Test
        @DisplayName("a duplicate application is refused before anything is written")
        void duplicateApplicationRejected() {
            given(applicationRepository.existsByUserId(userId)).willReturn(true);

            assertThatCode(() -> service.submitApplication(request(), userId))
                    .isInstanceOf(IllegalStateException.class);

            verify(applicationRepository, never()).save(any());
        }

        private AdvisorApplication captureSaved() {
            ArgumentCaptor<AdvisorApplication> captor =
                    ArgumentCaptor.forClass(AdvisorApplication.class);
            verify(applicationRepository).save(captor.capture());
            return captor.getValue();
        }
    }

    // ══════════════════════════════════════════════════ cached email on decisions

    /**
     * The decision events previously carried no email at all, so notification-service had no
     * address to send to and approval mail was never delivered. advisor-service does not own the
     * email, so it reads it out of the local projection of auth-service's {@code user.registered}
     * stream.
     */
    @Nested
    @DisplayName("approve/reject carry the cached advisor email")
    class CachedEmail {

        @Test
        @DisplayName("approve publishes advisor.approved with the cached email")
        void approveCarriesEmail() {
            givenApplication(ApplicationStatus.PENDING);
            givenCachedEmail(EMAIL);

            service.approveAdvisor(applicationId, adminId, "credentials verified");

            verify(eventPublisher).publishAdvisorApproved(
                    eq(userId), eq("some-advisor"), eq(adminId), eq(EMAIL));
        }

        @Test
        @DisplayName("reject publishes advisor.rejected with the cached email")
        void rejectCarriesEmail() {
            givenApplication(ApplicationStatus.PENDING);
            givenCachedEmail(EMAIL);

            service.rejectAdvisor(applicationId, adminId, "insufficient evidence");

            verify(eventPublisher).publishAdvisorRejected(
                    eq(applicationId), eq("insufficient evidence"), eq(adminId), eq(EMAIL));
        }

        /**
         * The email is looked up by the applicant's userId, not the application id — the cache is
         * keyed by auth-service's user id and the two are different values.
         */
        @Test
        @DisplayName("the lookup is keyed by userId, not applicationId")
        void lookupIsKeyedByUserId() {
            givenApplication(ApplicationStatus.PENDING);
            givenCachedEmail(EMAIL);

            service.approveAdvisor(applicationId, adminId, "ok");

            verify(userEmailCacheRepository).findById(userId);
        }

        /**
         * A gap in an eventually-consistent projection must not block a privilege decision an
         * admin has already made. The notification degrades; the approval does not.
         */
        @Test
        @DisplayName("a cache miss still approves, publishing a null email")
        void cacheMissStillApproves() {
            givenApplication(ApplicationStatus.PENDING);
            given(userEmailCacheRepository.findById(userId)).willReturn(Optional.empty());

            assertThatCode(() -> service.approveAdvisor(applicationId, adminId, "ok"))
                    .doesNotThrowAnyException();

            verify(profileRepository).save(any());
            verify(eventPublisher).publishAdvisorApproved(
                    eq(userId), eq("some-advisor"), eq(adminId), isNull());
        }

        @Test
        @DisplayName("a cache miss still rejects, publishing a null email")
        void cacheMissStillRejects() {
            givenApplication(ApplicationStatus.PENDING);
            given(userEmailCacheRepository.findById(userId)).willReturn(Optional.empty());

            assertThatCode(() -> service.rejectAdvisor(applicationId, adminId, "no"))
                    .doesNotThrowAnyException();

            verify(eventPublisher).publishAdvisorRejected(
                    eq(applicationId), eq("no"), eq(adminId), isNull());
        }

        @Test
        @DisplayName("approving flips the application to APPROVED and promotes a public profile")
        void approvePromotesProfile() {
            givenApplication(ApplicationStatus.PENDING);
            givenCachedEmail(EMAIL);

            service.approveAdvisor(applicationId, adminId, "credentials verified");

            ArgumentCaptor<AdvisorApplication> captor =
                    ArgumentCaptor.forClass(AdvisorApplication.class);
            verify(applicationRepository).save(captor.capture());
            assertThat(captor.getValue().getStatus()).isEqualTo(ApplicationStatus.APPROVED);
            assertThat(captor.getValue().getReviewedBy()).isEqualTo(adminId);
            verify(profileRepository).save(any());
        }

        @Test
        @DisplayName("requestMoreInfo touches neither the cache nor the event stream")
        void requestMoreInfoPublishesNothing() {
            givenApplication(ApplicationStatus.PENDING);

            service.requestMoreInfo(applicationId, adminId, "we need a clearer scan");

            verify(userEmailCacheRepository, never()).findById(any());
            verify(eventPublisher, never())
                    .publishAdvisorApproved(any(), any(), any(), any());
            verify(eventPublisher, never())
                    .publishAdvisorRejected(any(), any(), any(), any());
        }
    }

    // ══════════════════════════════════════════════════════ admin application list

    @Nested
    @DisplayName("getApplications")
    class Applications {

        private final Pageable pageable = PageRequest.of(0, 20);

        @Test
        @DisplayName("a status filters the query; the result is summaries, not entities")
        void filtersByStatus() {
            given(applicationRepository.findByStatus(ApplicationStatus.PENDING, pageable))
                    .willReturn(new PageImpl<>(List.of(fullyPopulatedApplication())));

            Page<AdvisorApplicationSummaryDto> page =
                    service.getApplications(ApplicationStatus.PENDING, pageable);

            assertThat(page.getContent()).hasSize(1);
            AdvisorApplicationSummaryDto dto = page.getContent().get(0);
            assertThat(dto.getId()).isEqualTo(applicationId);
            assertThat(dto.getUserId()).isEqualTo(userId);
            assertThat(dto.getUsername()).isEqualTo("some-advisor");
            assertThat(dto.getProfessionalTitle()).isEqualTo("Chartered Accountant");
            assertThat(dto.getSectors()).containsExactly(AdvisorSector.FINANCE);
            assertThat(dto.getQualification()).isEqualTo("ACA");
            assertThat(dto.getExperienceYears()).isEqualTo("10+");
            assertThat(dto.getLicenseIssuingAuthority()).isEqualTo("State Board of Accountancy");
            assertThat(dto.getLicenseState()).isEqualTo("CA");
            assertThat(dto.isLicenseVerified()).isTrue();
            assertThat(dto.getStatus()).isEqualTo(ApplicationStatus.PENDING);
            assertThat(dto.getSubmittedAt()).isNotNull();
        }

        @Test
        @DisplayName("a null status returns every application rather than an empty page")
        void nullStatusReturnsAll() {
            given(applicationRepository.findAll(pageable))
                    .willReturn(new PageImpl<>(List.of(fullyPopulatedApplication())));

            assertThat(service.getApplications(null, pageable).getContent()).hasSize(1);
            verify(applicationRepository, never()).findByStatus(any(), any());
        }

        /**
         * The summary is the only shape an admin list ever returns. Serialising the entity would
         * have shipped decrypted legal names, dates of birth and document S3 keys to every admin
         * session that opened page one — a bulk PII disclosure behind a list endpoint.
         */
        @Test
        @DisplayName("the summary type declares no PII field at all")
        void summaryCarriesNoPii() {
            List<String> forbidden = List.of(
                    "legalFirstName", "legalLastName", "dateOfBirth",
                    "addressFull", "country", "documents", "documentS3Keys", "adminNotes");

            List<String> declared = java.util.Arrays
                    .stream(AdvisorApplicationSummaryDto.class.getDeclaredFields())
                    .map(java.lang.reflect.Field::getName)
                    .toList();

            assertThat(declared).doesNotContainAnyElementsOf(forbidden);
        }

        @Test
        @DisplayName("documentCount replaces the documents themselves")
        void exposesDocumentCountOnly() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.setDocuments(List.of(
                    DocumentMetadata.builder().s3Key("a").build(),
                    DocumentMetadata.builder().s3Key("b").build(),
                    DocumentMetadata.builder().s3Key("c").build()));
            given(applicationRepository.findAll(pageable)).willReturn(new PageImpl<>(List.of(app)));

            assertThat(service.getApplications(null, pageable).getContent().get(0)
                    .getDocumentCount()).isEqualTo(3);
        }

        @Test
        @DisplayName("a null documents collection counts as zero rather than throwing")
        void nullDocumentsCountsAsZero() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.setDocuments(null);
            given(applicationRepository.findAll(pageable)).willReturn(new PageImpl<>(List.of(app)));

            assertThat(service.getApplications(null, pageable).getContent().get(0)
                    .getDocumentCount()).isZero();
        }
    }

    // ═══════════════════════════════════════════════════ license: submission requirement

    @Nested
    @DisplayName("submitApplication license requirement")
    class LicenseRequirement {

        @Test
        @DisplayName("a FINANCE application with no license fields is refused before anything is written")
        void financeWithoutLicenseIsRefused() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            SubmitApplicationRequest req = request();
            req.setLicenseNumber(null);

            assertThatCode(() -> service.submitApplication(req, userId))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("license");

            verify(applicationRepository, never()).save(any());
        }

        @Test
        @DisplayName("a MENTAL_HEALTH application with a blank issuing authority is refused")
        void mentalHealthWithBlankAuthorityIsRefused() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            SubmitApplicationRequest req = request();
            req.setSectors(List.of(AdvisorSector.MENTAL_HEALTH));
            req.setLicenseIssuingAuthority("   ");

            assertThatCode(() -> service.submitApplication(req, userId))
                    .isInstanceOf(IllegalArgumentException.class);

            verify(applicationRepository, never()).save(any());
        }

        @Test
        @DisplayName("a CAREER application needs no license fields at all")
        void careerDoesNotRequireLicense() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            given(applicationRepository.save(any())).willAnswer(i -> i.getArgument(0));
            SubmitApplicationRequest req = request();
            req.setSectors(List.of(AdvisorSector.CAREER));
            req.setLicenseNumber(null);
            req.setLicenseIssuingAuthority(null);
            req.setLicenseState(null);

            assertThatCode(() -> service.submitApplication(req, userId)).doesNotThrowAnyException();
        }

        @Test
        @DisplayName("a FINANCE application with all three license fields is accepted and persisted")
        void financeWithLicenseFieldsIsAccepted() {
            given(applicationRepository.existsByUserId(userId)).willReturn(false);
            given(applicationRepository.save(any())).willAnswer(i -> i.getArgument(0));

            service.submitApplication(request(), userId);

            AdvisorApplication saved = captureSaved();
            assertThat(saved.getLicenseNumber()).isEqualTo("CPA-778214");
            assertThat(saved.getLicenseIssuingAuthority()).isEqualTo("State Board of Accountancy");
            assertThat(saved.getLicenseState()).isEqualTo("CA");
            assertThat(saved.isLicenseVerified()).isFalse();
        }

        private AdvisorApplication captureSaved() {
            ArgumentCaptor<AdvisorApplication> captor =
                    ArgumentCaptor.forClass(AdvisorApplication.class);
            verify(applicationRepository).save(captor.capture());
            return captor.getValue();
        }
    }

    // ═══════════════════════════════════════════════════════ license: approval gate

    @Nested
    @DisplayName("approveAdvisor license gate")
    class LicenseGate {

        @Test
        @DisplayName("an unverified FINANCE application cannot be approved")
        void unverifiedFinanceCannotBeApproved() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.setLicenseVerified(false);
            given(applicationRepository.findById(applicationId)).willReturn(Optional.of(app));

            assertThatCode(() -> service.approveAdvisor(applicationId, adminId, "looks good"))
                    .isInstanceOf(LicenseNotVerifiedException.class);

            verify(applicationRepository, never()).save(any());
            verify(profileRepository, never()).save(any());
        }

        @Test
        @DisplayName("a verified FINANCE application can be approved")
        void verifiedFinanceCanBeApproved() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.setLicenseVerified(true);
            given(applicationRepository.findById(applicationId)).willReturn(Optional.of(app));
            given(userEmailCacheRepository.findById(userId)).willReturn(Optional.empty());

            assertThatCode(() -> service.approveAdvisor(applicationId, adminId, "looks good"))
                    .doesNotThrowAnyException();

            verify(profileRepository).save(any());
        }

        @Test
        @DisplayName("a CAREER application can be approved without any license verification")
        void careerNeedsNoVerificationToApprove() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.setSectors(List.of(AdvisorSector.CAREER));
            app.setLicenseVerified(false);
            given(applicationRepository.findById(applicationId)).willReturn(Optional.of(app));
            given(userEmailCacheRepository.findById(userId)).willReturn(Optional.empty());

            assertThatCode(() -> service.approveAdvisor(applicationId, adminId, "looks good"))
                    .doesNotThrowAnyException();

            verify(profileRepository).save(any());
        }

        @Test
        @DisplayName("rejecting an unverified FINANCE application is unaffected by the license gate")
        void rejectIgnoresTheLicenseGate() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.setLicenseVerified(false);
            given(applicationRepository.findById(applicationId)).willReturn(Optional.of(app));
            given(userEmailCacheRepository.findById(userId)).willReturn(Optional.empty());

            assertThatCode(() -> service.rejectAdvisor(applicationId, adminId, "no"))
                    .doesNotThrowAnyException();
        }
    }

    // ═══════════════════════════════════════════════════════════ verifyLicense command

    @Nested
    @DisplayName("verifyLicense")
    class VerifyLicense {

        @Test
        @DisplayName("stamps licenseVerified, licenseVerifiedAt and licenseVerifiedBy")
        void stampsVerification() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.setLicenseVerified(false);
            given(applicationRepository.findById(applicationId)).willReturn(Optional.of(app));
            Instant before = Instant.now();

            service.verifyLicense(applicationId, adminId);

            ArgumentCaptor<AdvisorApplication> captor = ArgumentCaptor.forClass(AdvisorApplication.class);
            verify(applicationRepository).save(captor.capture());
            AdvisorApplication saved = captor.getValue();
            assertThat(saved.isLicenseVerified()).isTrue();
            assertThat(saved.getLicenseVerifiedBy()).isEqualTo(adminId);
            assertThat(saved.getLicenseVerifiedAt()).isNotNull().isBetween(before, Instant.now());
        }

        @Test
        @DisplayName("a missing application is reported as not-found")
        void missingApplicationThrows() {
            given(applicationRepository.findById(applicationId)).willReturn(Optional.empty());

            assertThatCode(() -> service.verifyLicense(applicationId, adminId))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    // ═══════════════════════════════════════════════════════════ getApplicationDetail

    @Nested
    @DisplayName("getApplicationDetail")
    class ApplicationDetail {

        @Test
        @DisplayName("carries full PII, license credentials, and document metadata without the S3 key")
        void carriesFullDetail() {
            AdvisorApplication app = fullyPopulatedApplication();
            app.getDocuments().add(DocumentMetadata.builder()
                    .s3Key("s3/secret-key-should-not-leak")
                    .fileName("license.pdf")
                    .mimeType("application/pdf")
                    .sizeBytes(1024L)
                    .uploadedAt(Instant.now())
                    .build());
            given(applicationRepository.findById(applicationId)).willReturn(Optional.of(app));

            AdvisorApplicationDetailDto dto = service.getApplicationDetail(applicationId);

            assertThat(dto.getLegalFirstName()).isEqualTo("Wilhelmina");
            assertThat(dto.getDateOfBirth()).isEqualTo("1985-03-14");
            assertThat(dto.getLicenseNumber()).isEqualTo("CPA-778214");
            assertThat(dto.isLicenseVerified()).isTrue();
            assertThat(dto.getDocuments()).hasSize(2);
            assertThat(dto.getDocuments())
                    .extracting(AdvisorApplicationDetailDto.DocumentSummary::getFileName)
                    .contains("license.pdf");

            List<String> declaredFields = java.util.Arrays
                    .stream(AdvisorApplicationDetailDto.DocumentSummary.class.getDeclaredFields())
                    .map(java.lang.reflect.Field::getName)
                    .toList();
            assertThat(declaredFields).doesNotContain("s3Key");
        }

        @Test
        @DisplayName("a missing application is reported as not-found")
        void missingApplicationThrows() {
            given(applicationRepository.findById(applicationId)).willReturn(Optional.empty());

            assertThatCode(() -> service.getApplicationDetail(applicationId))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    // ═══════════════════════════════════════════════════════════════════ helpers

    private void givenApplication(ApplicationStatus status) {
        AdvisorApplication app = fullyPopulatedApplication();
        app.setStatus(status);
        given(applicationRepository.findById(applicationId)).willReturn(Optional.of(app));
    }

    private void givenCachedEmail(String email) {
        given(userEmailCacheRepository.findById(userId))
                .willReturn(Optional.of(UserEmailCache.builder().id(userId).email(email).build()));
    }

    private AdvisorApplication fullyPopulatedApplication() {
        return AdvisorApplication.builder()
                .id(applicationId)
                .userId(userId)
                .username("some-advisor")
                .professionalTitle("Chartered Accountant")
                .bio("A bio long enough to be plausible for an onboarding application.")
                .sectors(List.of(AdvisorSector.FINANCE))
                .qualification("ACA")
                .fieldOfStudy("Accounting")
                .experienceYears("10+")
                .legalFirstName("Wilhelmina")
                .legalLastName("Ndlovu")
                .dateOfBirth("1985-03-14")
                .addressFull("42 Privet Drive")
                .country("GB")
                .licenseNumber("CPA-778214")
                .licenseIssuingAuthority("State Board of Accountancy")
                .licenseState("CA")
                // Verified by default so the pre-existing approve/reject fixtures below (which
                // predate license verification) keep exercising what they always meant to test —
                // dedicated tests below cover the unverified-blocks-approval case explicitly.
                .licenseVerified(true)
                .documents(new java.util.ArrayList<>(List.of(
                        DocumentMetadata.builder().s3Key("s3/passport.pdf").build())))
                .status(ApplicationStatus.PENDING)
                .submittedAt(Instant.now())
                .build();
    }

    private static SubmitApplicationRequest request(DocumentMetadataRequest... documents) {
        SubmitApplicationRequest req = new SubmitApplicationRequest();
        req.setUsername("some-advisor");
        req.setProfessionalTitle("Chartered Accountant");
        req.setBio("A bio long enough to be plausible for an onboarding application.");
        req.setSectors(List.of(AdvisorSector.FINANCE));
        req.setQualification("ACA");
        req.setFieldOfStudy("Accounting");
        req.setExperienceYears("10+");
        req.setLegalFirstName("Wilhelmina");
        req.setLegalLastName("Ndlovu");
        req.setDateOfBirth("1985-03-14");
        req.setAddressFull("42 Privet Drive");
        req.setCountry("GB");
        req.setLicenseNumber("CPA-778214");
        req.setLicenseIssuingAuthority("State Board of Accountancy");
        req.setLicenseState("CA");
        req.setDocuments(new java.util.ArrayList<>(List.of(documents)));
        return req;
    }

    private static DocumentMetadataRequest document(
            String s3Key, String fileName, long sizeBytes, String mimeType) {
        DocumentMetadataRequest d = new DocumentMetadataRequest();
        d.setS3Key(s3Key);
        d.setFileName(fileName);
        d.setSizeBytes(sizeBytes);
        d.setMimeType(mimeType);
        return d;
    }
}
