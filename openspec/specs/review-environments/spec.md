# Review environments specification

## Purpose

Define reusable personal and team variables and commands for repository review workflows.

## Requirements

### Requirement: Environments can be personal or team scoped

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Personal environment

- **WHEN** a user creates a personal environment
- **THEN** its repository scope, local directory, variables, and commands persist on that device

#### Scenario: Team environment

- **WHEN** an authorized user creates or updates a team environment
- **THEN** its non-secret definition is synchronized through the selected organization
- **AND** each user can associate an independent local directory

### Requirement: Secret values use secure storage

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Saving a secret

- **WHEN** a variable is marked secret
- **THEN** its value is stored in the operating-system credential store rather than the persisted environment document

#### Scenario: Secret is removed or made public

- **WHEN** a previously secret key is deleted or changed to non-secret
- **THEN** its obsolete credential-store entry is removed

### Requirement: Commands run from validated local context

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Running a command

- **WHEN** the user selects an environment command
- **THEN** Reviewly runs the stored command with its configured timeout and working directory under the associated local repository
- **AND** returns exit status, output, and failure details

#### Scenario: Team command changed remotely

- **WHEN** the expected command definition no longer matches the server definition
- **THEN** execution is rejected until the environment is refreshed

### Requirement: AI proposals use trusted project evidence

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Proposing an environment

- **WHEN** the user asks AI to draft an environment
- **THEN** Reviewly supplies only supported manifests, project documentation, and current source OpenSpec files
- **AND** excludes environment files, dependencies, active change artifacts, and secret values
- **AND** proposed variables contain keys without fabricated secret values
