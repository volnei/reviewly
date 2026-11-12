# Review queue specification

## Purpose

Define how reviewers order and inspect the Inbox and complete pull request list while preserving deterministic, workspace-specific choices.

## Requirements

### Requirement: Review queues expose a shared ordering model

The Inbox and pull request list SHALL offer the same supported ordering choices: action priority, shortest review, longest review, recently updated, least recently updated, newest, oldest, and title.

#### Scenario: Default ordering

- **WHEN** a reviewer has not selected an ordering for the current list and workspace
- **THEN** the list orders items by action priority

#### Scenario: Review-duration ordering

- **WHEN** the reviewer selects shortest or longest review
- **THEN** items with known review-time estimates are ordered in the requested direction
- **AND** items without enough size data appear after every item with a known estimate

#### Scenario: Date ordering

- **WHEN** the reviewer orders by creation or update time
- **THEN** items with dates are ordered in the requested direction
- **AND** items without the selected date appear last

#### Scenario: Equal primary values

- **WHEN** two items have the same primary sort value
- **THEN** the application uses the action-priority comparison as a deterministic tie-breaker

### Requirement: Ordering is scoped and persistent

The application SHALL persist ordering independently for each list and each selected repository workspace.

#### Scenario: Switching workspaces

- **WHEN** a reviewer selects one ordering in the all-repositories workspace and another ordering in a repository workspace
- **THEN** returning to either workspace restores that workspace's previous ordering

#### Scenario: Invalid saved value

- **WHEN** a stored ordering value is no longer supported or cannot be decoded
- **THEN** the application falls back to action-priority ordering

### Requirement: Ordering follows filtering without breaking stack context

The application SHALL apply active filters before ordering visible results and SHALL retain the visible foundation of a stack whenever one of its layers matches a pull request filter.

#### Scenario: Filtered stack layer

- **WHEN** a stack layer matches the active filter
- **THEN** the complete currently visible stack context remains in the result
- **AND** the selected ordering is applied to the resulting list or group

### Requirement: Pull request grouping remains independent of ordering

The pull request list SHALL allow no grouping, repository grouping, author grouping, or native-stack grouping without changing the selected ordering.

#### Scenario: Ordering within a group

- **WHEN** a reviewer selects repository or author grouping and an ordering
- **THEN** the application retains the grouping
- **AND** orders items within each group according to the selected ordering

#### Scenario: Native stack grouping

- **WHEN** a reviewer groups pull requests by native stack
- **THEN** layers within each stack are ordered by their dependency position
- **AND** pull requests without stack membership remain in a separate group

### Requirement: Filters compose predictably

The application SHALL combine values within one filter field using OR and SHALL combine different filter fields using AND.

#### Scenario: Multiple values in one field

- **WHEN** a reviewer selects two authors or two repositories
- **THEN** an item matching either selected value remains visible

#### Scenario: Values across fields

- **WHEN** a reviewer selects an author and a CI state
- **THEN** only items matching both fields remain visible

#### Scenario: Label inclusion and exclusion

- **WHEN** required and excluded labels are configured
- **THEN** an item must contain every required label and no excluded label to remain visible

### Requirement: Queue filters cover review evidence

The application SHALL support available repository, author, label, status, CI, ownership, bot, stack, severity, and CODEOWNERS facts appropriate to the current list.

#### Scenario: Filter fact is unavailable

- **WHEN** an item does not contain the fact required by an active filter
- **THEN** the item does not falsely match that filter

### Requirement: Saved views preserve useful queue configurations

The application SHALL persist named views containing supported filters, grouping, and ordering and SHALL tolerate older saved-view shapes.

#### Scenario: Opening a saved view

- **WHEN** the reviewer selects a named saved view
- **THEN** its filters, grouping, and ordering are applied to the current compatible queue

#### Scenario: Migrating a saved view

- **WHEN** a saved view uses an older supported representation
- **THEN** Reviewly migrates it without discarding its name or valid criteria
