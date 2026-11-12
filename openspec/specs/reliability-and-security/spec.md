# Reliability and security specification

## Purpose

Define error classification, bounded recovery, cached fallback, safe links, secret handling, and privacy guarantees shared across Reviewly.

## Requirements

### Requirement: Automatic retries are bounded by failure kind

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Permanent failure

- **WHEN** a request fails due to authentication, permission, not found, validation, or cancellation
- **THEN** Reviewly does not automatically retry it

#### Scenario: Transient failure

- **WHEN** a request fails due to network, timeout, server, rate-limit, or unknown transient state
- **THEN** Reviewly retries only up to the configured bounded limit with backoff

#### Scenario: Server retry delay

- **WHEN** a response includes a usable retry-after delay
- **THEN** Reviewly honors it within a maximum delay of 60 seconds

### Requirement: AI retries do not duplicate partial answers

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Stream already produced text

- **WHEN** an AI request fails after producing response characters
- **THEN** it is not automatically retried

### Requirement: Cached data survives recoverable outages

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Offline refresh

- **WHEN** a refresh fails while cached data exists
- **THEN** the cached data remains visible
- **AND** the UI identifies the recovery action or automatic retry behavior

### Requirement: External navigation is validated

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Opening a URL

- **WHEN** Reviewly opens a repository, authentication, billing, integration, or documentation URL
- **THEN** the URL is validated against supported safe protocols before it leaves the application

### Requirement: Secrets and private source remain local by default

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Persisting credentials

- **WHEN** Reviewly stores GitHub tokens, AI API keys, or environment secrets
- **THEN** it uses the operating-system credential store and does not serialize secret values into ordinary preferences

#### Scenario: Product telemetry

- **WHEN** the user uses personal review features
- **THEN** Reviewly does not emit product analytics telemetry
