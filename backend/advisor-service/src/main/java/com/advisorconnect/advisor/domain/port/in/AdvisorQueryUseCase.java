package com.advisorconnect.advisor.domain.port.in;

import com.advisorconnect.advisor.adapter.in.web.dto.AdvisorApplicationDetailDto;
import com.advisorconnect.advisor.adapter.in.web.dto.AdvisorApplicationStatusDto;
import com.advisorconnect.advisor.adapter.in.web.dto.AdvisorApplicationSummaryDto;
import com.advisorconnect.advisor.adapter.in.web.dto.AdvisorPublicDto;
import com.advisorconnect.advisor.domain.model.AdvisorSector;
import com.advisorconnect.advisor.domain.model.ApplicationStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

public interface AdvisorQueryUseCase {
    Page<AdvisorPublicDto> findAdvisors(AdvisorSector sector, String searchQuery, Pageable pageable);
    AdvisorPublicDto getAdvisorProfile(String username);
    AdvisorApplicationStatusDto getApplicationStatus(UUID userId);

    /**
     * Admin review queue. A null {@code status} returns every application regardless of state.
     * Results are PII-free summaries, never the entity.
     */
    Page<AdvisorApplicationSummaryDto> getApplications(ApplicationStatus status, Pageable pageable);

    /**
     * The full application record, PII and license credentials included — admin-only, gated by
     * {@code hasRole('ADMIN')} at the controller. This is what an admin actually needs to check a
     * professional license against its issuing authority, which the PII-free summary cannot carry.
     */
    AdvisorApplicationDetailDto getApplicationDetail(UUID applicationId);
}
