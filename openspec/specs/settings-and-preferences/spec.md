# Settings and preferences specification

## Purpose

Define durable, tolerant configuration for behavior, appearance, repositories, review, AI, notifications, account, and Teams.

## Requirements

### Requirement: Preferences decode independently and tolerate older data

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: One stored field is invalid

- **WHEN** a persisted preference field cannot be decoded
- **THEN** that field falls back to its default
- **AND** other valid stored fields remain intact

### Requirement: Settings cover the review lifecycle

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Changing a preference

- **WHEN** the user changes behavior, appearance, repository, reading, review, AI, notification, editor, merge, or account settings
- **THEN** the value persists and applies to the corresponding feature

### Requirement: Notification choices are explicit

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Notification reason is disabled

- **WHEN** the user disables a notification reason
- **THEN** native background notifications for that reason are suppressed without disabling unrelated reasons

### Requirement: Accessibility preferences affect presentation

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Reduced motion or transparency

- **WHEN** the user enables reduced motion or the system requests reduced transparency
- **THEN** the application removes nonessential motion or translucent treatment while preserving content and controls

### Requirement: Destructive or consequential choices can require confirmation

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Review confirmation is enabled

- **WHEN** the user submits a review decision
- **THEN** the configured confirmation step is shown before sending it to GitHub
