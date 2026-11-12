# Teams coordination specification

## Purpose

Define organization linking, shared review ownership, team metadata, integrations, and billing boundaries.

## Requirements

### Requirement: A user can link Reviewly to an organization

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Linking completes

- **WHEN** the user completes the Teams device-link flow
- **THEN** available organizations are loaded and the Teams session becomes active

#### Scenario: Bootstrap fails

- **WHEN** Teams status cannot be loaded
- **THEN** the application stops showing a loading state
- **AND** personal GitHub review features remain usable

### Requirement: Team queues expose explicit ownership and service state

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Queue assignment changes

- **WHEN** an authorized member changes owner, priority, next action, or SLA metadata
- **THEN** the shared queue is updated and refreshed for the organization

#### Scenario: At-risk work

- **WHEN** an item's SLA is exceeded or its explicit team state indicates risk
- **THEN** it is visibly identified without inferring risk from title text

### Requirement: Teams stores coordination metadata rather than source code

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Queue synchronization

- **WHEN** Reviewly sends team queue state
- **THEN** it sends identifiers and coordination metadata required for the shared workflow
- **AND** does not upload repository source or diffs as team queue content

### Requirement: Organization capabilities are entitlement aware

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Billing or integration action

- **WHEN** a user opens checkout, billing management, GitLab, or Slack setup
- **THEN** Reviewly obtains the organization-specific external URL and opens it safely

#### Scenario: Signing out of Teams

- **WHEN** the user signs out of Teams
- **THEN** team organizations and team-only state are removed from the active session
- **AND** personal GitHub authentication remains independent
