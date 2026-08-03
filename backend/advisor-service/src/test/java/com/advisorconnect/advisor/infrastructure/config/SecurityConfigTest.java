package com.advisorconnect.advisor.infrastructure.config;

import com.advisorconnect.advisor.adapter.in.web.AdvisorController;
import com.advisorconnect.advisor.domain.port.in.AdvisorCommandUseCase;
import com.advisorconnect.advisor.domain.model.ApplicationStatus;
import com.advisorconnect.advisor.domain.port.in.AdvisorQueryUseCase;
import com.advisorconnect.advisor.domain.port.in.ReviewUseCase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies that {@code AdvisorController}'s {@code @PreAuthorize} annotations are actually
 * enforced. Before this config existed the service had no Spring Security setup at all, so those
 * annotations were decoration — every endpoint was reachable by anyone.
 */
@WebMvcTest(AdvisorController.class)
@Import(SecurityConfig.class)
class SecurityConfigTest {

    private static final String USER_ID = "3f7c1c4e-2b8a-4a1d-9f2e-5c6d7e8f9a0b";
    private static final String ADMIN_ID = "8a1b2c3d-4e5f-4061-8273-849506172839";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AdvisorQueryUseCase queryUseCase;

    @MockBean
    private AdvisorCommandUseCase commandUseCase;

    /**
     * {@code AdvisorController} took a third collaborator when the review endpoints landed. A
     * {@code @WebMvcTest} instantiates the real controller, so without this the context fails to
     * start and every test in the class errors out — including the ones that have nothing to do
     * with reviews.
     */
    @MockBean
    private ReviewUseCase reviewUseCase;

    // ------------------------------------------------------------- public surface

    @Test
    @DisplayName("GET /advisors is public — no identity headers required")
    void advisorListIsPublic() throws Exception {
        given(queryUseCase.findAdvisors(any(), any(), any())).willReturn(Page.empty());

        mockMvc.perform(get("/advisors"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("GET /advisors/{username} is public — no identity headers required")
    void advisorProfileIsPublic() throws Exception {
        given(queryUseCase.getAdvisorProfile("somesername")).willReturn(null);

        mockMvc.perform(get("/advisors/somesername"))
                .andExpect(status().isOk());
    }

    // --------------------------------------------------------- authentication gate

    @Test
    @DisplayName("POST /advisors/apply without identity headers is rejected")
    void applyWithoutHeadersIsRejected() throws Exception {
        mockMvc.perform(post("/advisors/apply")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().is(anyOf401Or403()));

        verifyNoInteractions(commandUseCase);
    }

    @Test
    @DisplayName("POST /advisors/apply with only X-User-Id (no role) still fails closed")
    void applyWithPartialHeadersIsRejected() throws Exception {
        mockMvc.perform(post("/advisors/apply")
                        .header("X-User-Id", USER_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().is(anyOf401Or403()));

        verifyNoInteractions(commandUseCase);
    }

    @Test
    @DisplayName("POST /advisors/apply with a non-UUID X-User-Id fails closed")
    void applyWithMalformedUserIdIsRejected() throws Exception {
        mockMvc.perform(post("/advisors/apply")
                        .header("X-User-Id", "not-a-uuid")
                        .header("X-User-Role", "USER")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().is(anyOf401Or403()));

        verifyNoInteractions(commandUseCase);
    }

    @Test
    @DisplayName("GET /advisors/applications must not match the public /advisors/{username} rule")
    void adminApplicationListIsNotPublic() throws Exception {
        // "applications" is a single path segment, so the public "/advisors/{username}" matcher
        // would happily swallow it and serve the whole application queue to anonymous callers.
        // SecurityConfig claims the literal first; this test is what keeps that ordering honest.
        mockMvc.perform(get("/advisors/applications"))
                .andExpect(status().is(anyOf401Or403()));

        verifyNoInteractions(queryUseCase);
    }

    @Test
    @DisplayName("GET /advisors/applications as a plain USER is forbidden")
    void adminApplicationListRejectsNonAdmins() throws Exception {
        mockMvc.perform(get("/advisors/applications")
                        .header("X-User-Id", USER_ID)
                        .header("X-User-Role", "USER"))
                .andExpect(status().isForbidden());

        verifyNoInteractions(queryUseCase);
    }

    @Test
    @DisplayName("GET /advisors/applications as an ADMIN reaches the handler")
    void adminApplicationListReachableByAdmin() throws Exception {
        given(queryUseCase.getApplications(any(), any())).willReturn(Page.empty());

        mockMvc.perform(get("/advisors/applications")
                        .header("X-User-Id", ADMIN_ID)
                        .header("X-User-Role", "ADMIN")
                        .param("status", "PENDING"))
                .andExpect(status().isOk());

        verify(queryUseCase).getApplications(eq(ApplicationStatus.PENDING), any());
    }

    @Test
    @DisplayName("GET /advisors/applications/status requires authentication")
    void applicationStatusRequiresAuth() throws Exception {
        mockMvc.perform(get("/advisors/applications/status"))
                .andExpect(status().is(anyOf401Or403()));

        verifyNoInteractions(queryUseCase);
    }

    @Test
    @DisplayName("An authenticated USER reaches /advisors/applications/status")
    void applicationStatusReachableWhenAuthenticated() throws Exception {
        given(queryUseCase.getApplicationStatus(UUID.fromString(USER_ID))).willReturn(null);

        mockMvc.perform(get("/advisors/applications/status")
                        .header("X-User-Id", USER_ID)
                        .header("X-User-Role", "USER"))
                .andExpect(status().isOk());

        verify(queryUseCase).getApplicationStatus(UUID.fromString(USER_ID));
    }

    // ------------------------------------------------------------ role enforcement

    @Test
    @DisplayName("PUT /advisors/applications/{id}/approve as a plain USER is forbidden")
    void approveAsUserIsForbidden() throws Exception {
        mockMvc.perform(put("/advisors/applications/{id}/approve", UUID.randomUUID())
                        .header("X-User-Id", USER_ID)
                        .header("X-User-Role", "USER")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"notes\":\"let me in\"}"))
                .andExpect(status().isForbidden());

        verifyNoInteractions(commandUseCase);
    }

    @Test
    @DisplayName("PUT /advisors/applications/{id}/approve as an ADMIN passes the security layer")
    void approveAsAdminIsAllowed() throws Exception {
        UUID applicationId = UUID.randomUUID();

        mockMvc.perform(put("/advisors/applications/{id}/approve", applicationId)
                        .header("X-User-Id", ADMIN_ID)
                        .header("X-User-Role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"notes\":\"credentials verified\"}"))
                .andExpect(status().isOk());

        verify(commandUseCase).approveAdvisor(
                applicationId, UUID.fromString(ADMIN_ID), "credentials verified");
    }

    @Test
    @DisplayName("PUT /advisors/applications/{id}/reject as a plain USER is forbidden")
    void rejectAsUserIsForbidden() throws Exception {
        mockMvc.perform(put("/advisors/applications/{id}/reject", UUID.randomUUID())
                        .header("X-User-Id", USER_ID)
                        .header("X-User-Role", "USER")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"notes\":\"no\"}"))
                .andExpect(status().isForbidden());

        verifyNoInteractions(commandUseCase);
    }

    @Test
    @DisplayName("GET /advisors/applications/{id} as a plain USER is forbidden")
    void applicationDetailAsUserIsForbidden() throws Exception {
        mockMvc.perform(get("/advisors/applications/{id}", UUID.randomUUID())
                        .header("X-User-Id", USER_ID)
                        .header("X-User-Role", "USER"))
                .andExpect(status().isForbidden());

        verifyNoInteractions(queryUseCase);
    }

    @Test
    @DisplayName("GET /advisors/applications/{id} as an ADMIN passes the security layer")
    void applicationDetailAsAdminIsAllowed() throws Exception {
        UUID applicationId = UUID.randomUUID();

        mockMvc.perform(get("/advisors/applications/{id}", applicationId)
                        .header("X-User-Id", ADMIN_ID)
                        .header("X-User-Role", "ADMIN"))
                .andExpect(status().isOk());

        verify(queryUseCase).getApplicationDetail(applicationId);
    }

    @Test
    @DisplayName("PUT /advisors/applications/{id}/verify-license as a plain USER is forbidden")
    void verifyLicenseAsUserIsForbidden() throws Exception {
        mockMvc.perform(put("/advisors/applications/{id}/verify-license", UUID.randomUUID())
                        .header("X-User-Id", USER_ID)
                        .header("X-User-Role", "USER"))
                .andExpect(status().isForbidden());

        verifyNoInteractions(commandUseCase);
    }

    @Test
    @DisplayName("PUT /advisors/applications/{id}/verify-license as an ADMIN passes the security layer")
    void verifyLicenseAsAdminIsAllowed() throws Exception {
        UUID applicationId = UUID.randomUUID();

        mockMvc.perform(put("/advisors/applications/{id}/verify-license", applicationId)
                        .header("X-User-Id", ADMIN_ID)
                        .header("X-User-Role", "ADMIN"))
                .andExpect(status().isOk());

        verify(commandUseCase).verifyLicense(applicationId, UUID.fromString(ADMIN_ID));
    }

    // ------------------------------------------------------------------- reviews

    /**
     * Reading reviews is part of the public profile: a star rating with nothing visible behind it
     * is not something a prospective client can weigh.
     */
    @Test
    @DisplayName("GET /advisors/{id}/reviews is public — no identity headers required")
    void reviewListingIsPublic() throws Exception {
        UUID advisorId = UUID.randomUUID();
        given(reviewUseCase.getReviews(eq(advisorId), any())).willReturn(Page.empty());

        mockMvc.perform(get("/advisors/{id}/reviews", advisorId))
                .andExpect(status().isOk());

        verify(reviewUseCase).getReviews(eq(advisorId), any());
    }

    /**
     * The one that actually matters. {@code POST} and {@code GET} sit on the identical path, so
     * the permit rule in {@code SecurityConfig} is scoped by method — drop the {@code HttpMethod.GET}
     * argument and anyone on the internet can post reviews under an arbitrary identity. Nothing
     * else in the codebase would fail if that happened; this test is the guard.
     */
    @Test
    @DisplayName("POST /advisors/{id}/reviews is NOT covered by the public GET rule")
    void reviewSubmissionRequiresAuthentication() throws Exception {
        mockMvc.perform(post("/advisors/{id}/reviews", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":5,\"comment\":\"excellent\"}"))
                .andExpect(status().is(anyOf401Or403()));

        verifyNoInteractions(reviewUseCase);
    }

    @Test
    @DisplayName("POST /advisors/{id}/reviews with only X-User-Id (no role) fails closed")
    void reviewSubmissionWithPartialHeadersIsRejected() throws Exception {
        mockMvc.perform(post("/advisors/{id}/reviews", UUID.randomUUID())
                        .header("X-User-Id", USER_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":5}"))
                .andExpect(status().is(anyOf401Or403()));

        verifyNoInteractions(reviewUseCase);
    }

    /**
     * The reviewer is taken from the gateway-verified header, never from the body — so an
     * authenticated caller cannot post in someone else's name.
     */
    @Test
    @DisplayName("An authenticated USER reaches the handler, reviewing as the header identity")
    void reviewSubmissionReachableWhenAuthenticated() throws Exception {
        UUID advisorId = UUID.randomUUID();

        mockMvc.perform(post("/advisors/{id}/reviews", advisorId)
                        .header("X-User-Id", USER_ID)
                        .header("X-User-Role", "USER")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":5,\"comment\":\"excellent\"}"))
                .andExpect(status().isCreated());

        verify(reviewUseCase).submitReview(eq(advisorId), eq(UUID.fromString(USER_ID)), any());
    }

    /**
     * Reviews hang off {@code /advisors/{id}/...}, the same shape as the public profile rule. The
     * matcher is pinned to the literal trailing {@code reviews} segment rather than a
     * {@code /advisors/*}{@code /**} wildcard, so a future sub-resource does not inherit public
     * access by accident.
     */
    @Test
    @DisplayName("a sibling sub-resource does not inherit the reviews' public access")
    void siblingSubResourceIsNotPublic() throws Exception {
        mockMvc.perform(get("/advisors/{id}/earnings", UUID.randomUUID()))
                .andExpect(status().is(anyOf401Or403()));
    }

    /**
     * Which of the two an unauthenticated request yields is a Spring Security entry-point detail
     * (no authentication mechanism is configured, so it answers 403 rather than 401); the property
     * under test is that the request is refused, not the precise code.
     */
    private static org.hamcrest.Matcher<Integer> anyOf401Or403() {
        return org.hamcrest.Matchers.isOneOf(401, 403);
    }
}
