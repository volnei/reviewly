# Pull request review specification

## Purpose

Define the end-to-end workspace for understanding, discussing, and deciding a pull request.

## Requirements

### Requirement: A pull request opens as a coherent review workspace

Reviewly SHALL provide this capability according to the scenarios below.

The workspace SHALL load pull-request metadata, files, commits, checks, reviews, comments, threads, and repository context while allowing independently recoverable sections.

#### Scenario: Optional section fails

- **WHEN** one optional enrichment request fails
- **THEN** the rest of the pull request remains reviewable
- **AND** the failed section exposes a retryable error state

#### Scenario: Pull request is no longer reviewable

- **WHEN** a pull request is closed or merged
- **THEN** destructive review controls are disabled while its content remains inspectable

### Requirement: File review preferences and progress persist per pull request head

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Reviewing files

- **WHEN** the reviewer marks files viewed, changes unified or split mode, hides whitespace, wraps lines, or changes file order
- **THEN** applicable preferences persist
- **AND** viewed-file state is tied to the current head SHA

#### Scenario: Head changes

- **WHEN** a new head SHA is observed
- **THEN** Reviewly retains the previous head reference for change awareness
- **AND** does not incorrectly treat new content as already viewed

### Requirement: Discussion actions operate at their original context

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Drafting an inline comment

- **WHEN** the reviewer writes an inline comment
- **THEN** the draft persists locally with its file and line context until submitted or removed

#### Scenario: Thread actions

- **WHEN** the reviewer replies, resolves or unresolves a thread, edits a comment, or adds a reaction
- **THEN** Reviewly applies the action to the corresponding GitHub object and refreshes its displayed state

### Requirement: Review submission is atomic from the reviewer perspective

Reviewly SHALL provide this capability according to the scenarios below.

The submission dialog SHALL combine the chosen decision, summary body, and all pending draft comments.

#### Scenario: Comment review has no content

- **WHEN** COMMENT is selected with no body and no draft comments
- **THEN** submission is disabled

#### Scenario: Submitting a decision

- **WHEN** the reviewer confirms COMMENT, APPROVE, or REQUEST_CHANGES
- **THEN** the body and pending drafts are submitted as one review
- **AND** confirmation preferences and the Command-or-Control Enter shortcut are honored

### Requirement: Repository and merge actions are state dependent

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Merge is blocked

- **WHEN** the pull request has unresolved merge conflicts or another required blocker
- **THEN** Reviewly does not offer an executable merge action

#### Scenario: Local conflict workflow

- **WHEN** a local clone is available and conflicts can be resolved locally
- **THEN** the reviewer may open the repository workflow or request an AI-assisted resolution
- **AND** Reviewly never commits or pushes without a separate explicit user action

#### Scenario: Native stack

- **WHEN** the pull request belongs to a detected stack
- **THEN** adjacent layers and their state are shown in dependency order

### Requirement: Local review memory is bounded

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Old inactive state

- **WHEN** locally persisted review state is older than 90 days and has no pending draft or other active work
- **THEN** it may be pruned
