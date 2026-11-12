# Living architecture specification

## Purpose

Define local monorepo analysis that explains boundaries, dependency flow, ownership, activity, and prioritized architecture work.

## Requirements

### Requirement: Architecture is derived from repository evidence

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Scanning a workspace

- **WHEN** a local monorepo is scanned
- **THEN** Reviewly identifies applications, packages, dependency edges, cycles, boundary findings, tests, owners, contributors, and recent file activity from repository evidence

### Requirement: Impact accounts for transitive dependency flow

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Package has many downstream consumers

- **WHEN** a package is selected
- **THEN** its blast radius includes transitive downstream consumers
- **AND** applications and packages remain distinguishable

### Requirement: Findings are prioritized by impact and remediation value

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Dependency cycle

- **WHEN** a cycle is detected
- **THEN** it is treated as a critical architecture finding
- **AND** the action plan identifies the lowest-cost edge available to break it

#### Scenario: Missing ownership or tests

- **WHEN** ownership or test coverage is missing
- **THEN** it becomes a high-priority action only when the affected surface has sufficient architectural impact

### Requirement: The action plan remains traceable

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Opening a recommended action

- **WHEN** the user selects an architecture action
- **THEN** Reviewly shows the affected package, evidence, files, and rationale needed to investigate it
