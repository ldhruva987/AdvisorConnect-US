package com.advisorconnect.advisor.adapter.in.web.dto;

import com.advisorconnect.advisor.domain.model.AdvisorSector;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.Data;

import java.util.List;

@Data
public class SubmitApplicationRequest {

    @NotBlank
    @Pattern(regexp = "^[a-zA-Z0-9_]{3,30}$", message = "Username: letters, numbers, underscores only")
    private String username;

    @NotBlank
    private String professionalTitle;

    @NotBlank
    @Size(min = 50, max = 2000)
    private String bio;

    @NotEmpty
    private List<AdvisorSector> sectors;

    @NotBlank
    private String qualification;

    @NotBlank
    private String fieldOfStudy;

    @NotBlank
    private String experienceYears;

    private String previousWork;

    // Private identity — stored encrypted in DB, never returned in public DTOs
    @NotBlank
    private String legalFirstName;

    @NotBlank
    private String legalLastName;

    @NotBlank
    private String dateOfBirth;

    @NotBlank
    private String addressFull;

    @NotBlank
    private String country;

    /**
     * Required only for FINANCE and MENTAL_HEALTH applications — enforced in
     * {@code AdvisorApplicationService#submitApplication}, not here, because the requirement
     * depends on {@link #sectors} rather than being a fixed rule for every application.
     */
    private String licenseNumber;
    private String licenseIssuingAuthority;
    private String licenseState;

    /**
     * Identity documents, uploaded separately via the pre-signed URL endpoint and described here.
     *
     * <p>{@code @Valid} is load-bearing: without it Bean Validation stops at the list itself and
     * every constraint inside {@link DocumentMetadataRequest} is skipped, so blank S3 keys would
     * reach the database.
     */
    @NotEmpty
    @Valid
    private List<DocumentMetadataRequest> documents;
}
