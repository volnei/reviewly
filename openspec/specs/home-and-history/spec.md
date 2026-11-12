# Home and history specification

## Purpose

Define the reviewer overview and bounded local record of recent actions.

## Requirements

### Requirement: Home summarizes shipping and queue state without double counting

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Queue metrics are calculated

- **WHEN** Home receives the current scoped queue
- **THEN** each item contributes once to status, age, and repository summaries
- **AND** unknown creation dates appear in an explicit unknown-age bucket

#### Scenario: Repository identity

- **WHEN** repositories share a short name under different owners
- **THEN** Home keeps them distinct by owner and name

### Requirement: Activity comparisons use complete equal windows

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: GitHub omits inactive days

- **WHEN** shipping activity contains only dates with merges
- **THEN** Reviewly fills missing calendar dates with zero
- **AND** compares continuous periods of equal length across UTC date boundaries

### Requirement: Home identifies actionable next work

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Queue has attention items

- **WHEN** the scoped queue contains risky, owned, mergeable, waiting, and other items
- **THEN** Home summarizes their balance and highlights the next items requiring review

### Requirement: History is local, recent, and navigable

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Recording an action

- **WHEN** a GitHub, inbox, or local repository action is recorded
- **THEN** History stores its source, title, time, and applicable PR or path navigation data locally

#### Scenario: History retention

- **WHEN** entries exceed 24 hours or the newest 200 entries
- **THEN** older entries are pruned

#### Scenario: Clearing history

- **WHEN** the user clears History
- **THEN** all locally recorded history entries are removed
