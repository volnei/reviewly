# AI assistance specification

## Purpose

Define private, provider-selectable AI help for understanding and acting on code without silently changing the repository.

## Requirements

### Requirement: The user chooses the AI provider and model

Reviewly SHALL provide this capability according to the scenarios below.

Reviewly SHALL support configured local CLI providers and an OpenAI-compatible endpoint, subject to edition restrictions.

#### Scenario: Local provider

- **WHEN** a supported local CLI and model are configured
- **THEN** Reviewly invokes that provider with the selected model and review instructions

#### Scenario: OpenAI-compatible provider

- **WHEN** an API base URL, key, and model are configured
- **THEN** Reviewly sends the request to that endpoint using the configured timeout

#### Scenario: App Store edition

- **WHEN** the application runs in the App Store edition
- **THEN** unsupported local providers and local-repository AI capabilities are unavailable

### Requirement: AI responses stream reliably

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Streaming starts

- **WHEN** an AI request begins
- **THEN** stream listeners are installed before invoking the provider
- **AND** progress and text chunks are surfaced until completion or cancellation

#### Scenario: First event is absent

- **WHEN** the final provider result contains text not observed in stream chunks
- **THEN** Reviewly recovers the missing answer from the final result

#### Scenario: Empty result

- **WHEN** the provider completes without usable text
- **THEN** Reviewly reports an error rather than presenting an empty success

### Requirement: Pull-request AI is grounded in review context

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Review briefing

- **WHEN** the reviewer requests a briefing
- **THEN** the answer summarizes the change, recommends a reading order, and identifies blast radius from available PR context

#### Scenario: Guided review

- **WHEN** a guided review is generated
- **THEN** its stops point to reviewable evidence
- **AND** comments created at stops become local review drafts

#### Scenario: Ask AI

- **WHEN** the reviewer asks a question about the pull request
- **THEN** the response is grounded in supplied PR files, diffs, discussion, and repository context

### Requirement: Review skills customize matching reviews

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Skill matches

- **WHEN** a configured review skill matches the repository and changed paths
- **THEN** its instructions are included in applicable AI review work

### Requirement: AI never silently delivers code

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Applying a proposed fix

- **WHEN** AI proposes edits to a local checkout
- **THEN** the application requires an explicit apply action
- **AND** does not commit, push, merge, or create a pull request automatically
