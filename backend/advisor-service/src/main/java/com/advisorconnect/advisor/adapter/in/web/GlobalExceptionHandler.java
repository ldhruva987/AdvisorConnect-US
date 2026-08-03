package com.advisorconnect.advisor.adapter.in.web;

import com.advisorconnect.advisor.domain.model.LicenseNotVerifiedException;
import com.advisorconnect.advisor.domain.model.ReviewNotAllowedException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Deliberately narrow. advisor-service has never had a general exception advice, so every other
 * {@code IllegalArgumentException}/{@code IllegalStateException} thrown by the pre-existing
 * application-review endpoints currently surfaces as a 500. Broadening this to catch those too
 * would quietly change the contract of endpoints outside these two features' scope — a worthwhile
 * cleanup, but not one to smuggle in under either change.
 *
 * <p>So only two exception types are mapped, each via its own type: an ineligible or repeated
 * review, and an attempt to approve a FINANCE/MENTAL_HEALTH advisor before their license is
 * verified, are both legitimate client-side conflicts and must not read as server faults.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ReviewNotAllowedException.class)
    public ProblemDetail handleReviewNotAllowed(ReviewNotAllowedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("Review Not Allowed");
        return pd;
    }

    @ExceptionHandler(LicenseNotVerifiedException.class)
    public ProblemDetail handleLicenseNotVerified(LicenseNotVerifiedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("License Not Verified");
        return pd;
    }
}
