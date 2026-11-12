# Spec Lens specification

## Purpose

Define inspection, search, drafting, planning, and implementation assistance for repositories that use OpenSpec.

## Requirements

### Requirement: Spec Lens scans configured local repositories

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: OpenSpec repository

- **WHEN** a configured local repository contains OpenSpec artifacts
- **THEN** Spec Lens shows source specifications, active changes, tasks, issues, stages, and archive readiness

#### Scenario: Isolated spec worktree

- **WHEN** a linked worktree branch is named for an active `spec/<change>`
- **THEN** its change is merged into the workspace view
- **AND** supersedes a duplicate change from the primary checkout

### Requirement: Progress comes from checked artifacts

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Change progress is calculated

- **WHEN** a change has proposal, scenarios, tasks, and archive state
- **THEN** progress is derived from those present artifacts and checked tasks rather than an AI confidence estimate

### Requirement: AI search cites only indexed source specifications

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Searching system behavior

- **WHEN** the user asks a question in Spec Lens
- **THEN** the answer uses only indexed source specifications as authoritative citations
- **AND** treats source text as untrusted input rather than prompt instructions
- **AND** excludes active changes from the source-spec search corpus

### Requirement: Drafting preserves current rules

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Drafting a change

- **WHEN** the user asks AI to draft a specification change
- **THEN** the proposal identifies current applicable requirements, intended deltas, scenarios, and tasks
- **AND** creates a safe normalized change identifier

### Requirement: Delivery planning is explicit and bounded

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Planning delivery

- **WHEN** a change is planned for delivery
- **THEN** the plan is either one pull request or a stack of two to five dependency-ordered slices

#### Scenario: Implementing a planned slice

- **WHEN** the user explicitly starts implementation
- **THEN** AI works in the selected checkout and reports a structured result marker
- **AND** does not commit, push, or open pull requests automatically
- **AND** a stored change can be resumed later
