package com.advisorconnect.advisor.adapter.in.web;

import com.advisorconnect.advisor.adapter.in.web.dto.*;
import com.advisorconnect.advisor.domain.model.AdvisorSector;
import com.advisorconnect.advisor.domain.model.ApplicationStatus;
import com.advisorconnect.advisor.domain.port.in.AdvisorCommandUseCase;
import com.advisorconnect.advisor.domain.port.in.AdvisorQueryUseCase;
import com.advisorconnect.advisor.domain.port.in.ReviewUseCase;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/advisors")
@RequiredArgsConstructor
public class AdvisorController {

    private final AdvisorQueryUseCase queryUseCase;
    private final AdvisorCommandUseCase commandUseCase;
    private final ReviewUseCase reviewUseCase;

    /** Public — list advisors with optional sector/text filtering */
    @GetMapping
    public Page<AdvisorPublicDto> listAdvisors(
            @RequestParam(required = false) AdvisorSector sector,
            @RequestParam(required = false) String q,
            @PageableDefault(size = 20) Pageable pageable) {
        return queryUseCase.findAdvisors(sector, q, pageable);
    }

    /**
     * Admin only — the application review queue.
     *
     * <p>Declared ahead of {@code GET /advisors/{username}} for readability; correctness does not
     * depend on the ordering, because Spring ranks a literal path segment above a variable one.
     * The authorization layer does not have that luxury — see {@code SecurityConfig}, where the
     * {@code /advisors/applications} matcher must physically precede the public
     * {@code /advisors/{username}} rule or this endpoint ships world-readable.
     *
     * <p>Returns {@link AdvisorApplicationSummaryDto}, which carries no PII. Omit {@code status}
     * to see every application rather than one bucket.
     */
    @GetMapping("/applications")
    @PreAuthorize("hasRole('ADMIN')")
    public Page<AdvisorApplicationSummaryDto> listApplications(
            @RequestParam(required = false) ApplicationStatus status,
            @PageableDefault(size = 20, sort = "submittedAt", direction = Sort.Direction.DESC)
            Pageable pageable) {
        return queryUseCase.getApplications(status, pageable);
    }

    /**
     * Admin only — the full application record, PII and license credentials included.
     *
     * <p>Sits under the same {@code /advisors/applications/**} matcher {@code SecurityConfig}
     * already requires authentication (and, via {@code @PreAuthorize} here, ADMIN) for, so no
     * security-config change was needed to add this path.
     */
    @GetMapping("/applications/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public AdvisorApplicationDetailDto getApplicationDetail(@PathVariable UUID id) {
        return queryUseCase.getApplicationDetail(id);
    }

    /** Public — get advisor public profile by username */
    @GetMapping("/{username}")
    public AdvisorPublicDto getProfile(@PathVariable String username) {
        return queryUseCase.getAdvisorProfile(username);
    }

    /** Authenticated — submit onboarding application */
    @PostMapping("/apply")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public UUID submitApplication(
            @Valid @RequestBody SubmitApplicationRequest request,
            @RequestHeader("X-User-Id") UUID userId) {
        return commandUseCase.submitApplication(request, userId);
    }

    /** Authenticated — check own application status (no PII returned) */
    @GetMapping("/applications/status")
    @PreAuthorize("isAuthenticated()")
    public AdvisorApplicationStatusDto getMyApplicationStatus(
            @RequestHeader("X-User-Id") UUID userId) {
        return queryUseCase.getApplicationStatus(userId);
    }

    /** Admin only — approve an advisor application */
    @PutMapping("/applications/{id}/approve")
    @PreAuthorize("hasRole('ADMIN')")
    public void approve(
            @PathVariable UUID id,
            @RequestBody AdminDecisionRequest req,
            @RequestHeader("X-User-Id") UUID adminId) {
        commandUseCase.approveAdvisor(id, adminId, req.getNotes());
    }

    /** Admin only — reject an advisor application */
    @PutMapping("/applications/{id}/reject")
    @PreAuthorize("hasRole('ADMIN')")
    public void reject(
            @PathVariable UUID id,
            @RequestBody AdminDecisionRequest req,
            @RequestHeader("X-User-Id") UUID adminId) {
        commandUseCase.rejectAdvisor(id, adminId, req.getNotes());
    }

    /**
     * Admin only — record that this application's professional license has been checked against
     * its issuing authority. {@link #approve} refuses a FINANCE/MENTAL_HEALTH application until
     * this has been called.
     */
    @PutMapping("/applications/{id}/verify-license")
    @PreAuthorize("hasRole('ADMIN')")
    public void verifyLicense(
            @PathVariable UUID id,
            @RequestHeader("X-User-Id") UUID adminId) {
        commandUseCase.verifyLicense(id, adminId);
    }

    // ── Reviews ─────────────────────────────────────────────────────────────────

    /**
     * Public — the reviews on an advisor's profile, newest first.
     *
     * <p>Public because the profile it belongs to is: a rating with no visible reviews behind it
     * is not something a prospective client can weigh. Note that {@code SecurityConfig} has to
     * permit this one by method as well as path — {@link #submitReview} sits on the identical
     * path and must stay authenticated.
     */
    @GetMapping("/{id}/reviews")
    public Page<ReviewDto> getReviews(
            @PathVariable UUID id,
            @PageableDefault(size = 20, sort = "createdAt", direction = Sort.Direction.DESC)
            Pageable pageable) {
        return reviewUseCase.getReviews(id, pageable);
    }

    /**
     * Authenticated — leave a review for an advisor.
     *
     * <p>The reviewer is taken from the gateway-verified {@code X-User-Id} header and never from
     * the body, so a caller cannot post a review in someone else's name. Eligibility (a
     * completed, unreviewed session with this advisor) is enforced in the service; an ineligible
     * or repeat attempt answers 409.
     */
    @PostMapping("/{id}/reviews")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public ReviewDto submitReview(
            @PathVariable UUID id,
            @Valid @RequestBody SubmitReviewRequest request,
            @RequestHeader("X-User-Id") UUID reviewerId) {
        return reviewUseCase.submitReview(id, reviewerId, request);
    }
}
