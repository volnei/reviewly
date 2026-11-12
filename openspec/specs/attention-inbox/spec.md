# Attention inbox specification

## Purpose

Define the reviewer-first inbox, triage rules, notification handling, and health findings that decide what needs attention next.

## Requirements

### Requirement: The inbox is built from cached membership facts

Reviewly SHALL provide this capability according to the scenarios below.

The inbox SHALL classify pull requests using persisted GitHub membership facts such as authorship, review request, assignment, participation, and subscription.

#### Scenario: Pull request belongs to the reviewer

- **WHEN** a cached pull request is authored by, assigned to, or awaiting review from the current user
- **THEN** it appears in the appropriate inbox section without requiring a title heuristic

#### Scenario: Pull-request-only surface

- **WHEN** a surface requests only pull requests
- **THEN** findings and mentions are omitted from that surface
- **AND** their dedicated cached data remains available to other surfaces

### Requirement: Triage is deterministic and evidence based

Reviewly SHALL provide this capability according to the scenarios below.

The application SHALL rank risky, owned, mergeable, routine, unsorted, and waiting work using explicit PR and finding state; equal items SHALL be ordered oldest first.

#### Scenario: Security severity

- **WHEN** a finding has high or critical severity
- **THEN** it is classified as risky

#### Scenario: Pull request title contains risk language

- **WHEN** a pull request title contains words such as critical or security without supporting state
- **THEN** the title alone does not classify the pull request as risky

#### Scenario: Approved green pull request

- **WHEN** a pull request is approved, has passing checks, and has no blocking conflict or thread
- **THEN** it is classified as mergeable

### Requirement: Reviewers can defer and complete queue items

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Snoozing an item

- **WHEN** the reviewer snoozes an item until a selected time
- **THEN** it leaves the active queue and appears in Later until that time expires or it is unsnoozed

#### Scenario: Completing an item

- **WHEN** the reviewer marks an item done
- **THEN** it is removed from the active queue while its completion state remains persisted

### Requirement: Mentions and repository health remain inspectable

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Mention filtering

- **WHEN** GitHub notifications are loaded for Mentions
- **THEN** only direct mentions and team mentions appear

#### Scenario: Dependabot coverage is incomplete

- **WHEN** a watched repository has Dependabot disabled, forbidden, or unavailable
- **THEN** Health distinguishes that repository from a successfully checked repository
- **AND** offers retry or setup guidance as applicable

#### Scenario: Local workspace finding

- **WHEN** a local Turborepo scan reports a workspace risk
- **THEN** Health shows it alongside GitHub advisories with its repository and severity

### Requirement: Native attention indicators reflect the active inbox

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Inbox count changes

- **WHEN** the number of active inbox items changes in the native application
- **THEN** the dock or tray badge is updated to the normalized count
