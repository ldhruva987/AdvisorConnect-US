package com.advisorconnect.advisor.domain.model;

/**
 * A FINANCE or MENTAL_HEALTH application cannot be approved before an admin has verified the
 * applicant's professional license via {@code AdvisorApplicationService#verifyLicense}.
 *
 * <p>A distinct type rather than {@code IllegalStateException} so the web layer can answer 409
 * without a blanket advice reshaping every pre-existing endpoint's error contract — same reasoning
 * as {@link ReviewNotAllowedException}.
 */
public class LicenseNotVerifiedException extends RuntimeException {

    public LicenseNotVerifiedException(String message) {
        super(message);
    }
}
