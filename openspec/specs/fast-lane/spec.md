# Fast Lane specification

## Purpose

Define conservative policy-based classification of low-risk automated pull requests.

## Requirements

### Requirement: Fast Lane only evaluates repositories installed for the organization

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Repository is outside the GitHub App installation

- **WHEN** a pull request belongs to a repository not available to the organization installation
- **THEN** it is not eligible for Fast Lane

### Requirement: Repository policy overrides workspace policy

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Repository override exists

- **WHEN** both organization and repository policies apply
- **THEN** the repository policy is evaluated

#### Scenario: Override is reset

- **WHEN** an administrator resets a repository policy
- **THEN** that repository inherits the organization policy again

### Requirement: Eligibility fails closed

Reviewly SHALL provide this capability according to the scenarios below.

Eligibility SHALL require a trusted bot author and all configured limits for files, lines, paths, labels, checks, conflicts, and blockers.

#### Scenario: Required file facts are missing

- **WHEN** changed-file facts needed by a policy are unavailable
- **THEN** the pull request is not classified as eligible

#### Scenario: Blocked path or label

- **WHEN** any changed path or label matches a configured block rule
- **THEN** the pull request is not eligible even if another allow rule matches

#### Scenario: User's own pull request

- **WHEN** the current user authored the pull request
- **THEN** it is not classified for Fast Lane review

### Requirement: Fast Lane is advisory

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Pull request is eligible

- **WHEN** all policy conditions pass
- **THEN** Fast Lane displays the pull request and the reasons it qualified
- **AND** does not approve, merge, or enable auto-merge on the user's behalf
