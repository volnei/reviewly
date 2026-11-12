# Application shell specification

## Purpose

Define navigation, workspace scope, command access, onboarding, native events, and release lifecycle.

## Requirements

### Requirement: Primary surfaces are reachable through stable navigation

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Navigating with the rail or command palette

- **WHEN** the user chooses Home, Inbox, Fast Lane, pull requests, Teams, Mentions, Health, Labs, History, Environments, Local, or Settings
- **THEN** the corresponding route opens and the document or window title reflects the surface

### Requirement: Repository workspace scope is persistent

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Selecting a workspace

- **WHEN** the user selects a repository workspace
- **THEN** compatible inbox, queue, health, and dashboard data are limited to that owner/repository
- **AND** the selection persists until changed

#### Scenario: Invalid repository input

- **WHEN** workspace input cannot be parsed as owner/repository or a supported GitHub URL
- **THEN** the active workspace is not replaced

### Requirement: Global keyboard commands avoid text-entry conflicts

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Palette shortcut

- **WHEN** the user presses the configured Command-or-Control shortcut outside an incompatible modal or text field
- **THEN** the command palette opens and permits route or action search

### Requirement: First run establishes a usable review scope

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Completing onboarding

- **WHEN** the user authenticates and selects watched repositories
- **THEN** Reviewly saves those repositories and enters the main application

### Requirement: Native lifecycle events keep the UI current

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Background sync event

- **WHEN** the native watcher reports refreshed PR data
- **THEN** relevant cached queries are invalidated without forcing unrelated screens to reload

#### Scenario: Update is available

- **WHEN** a signed application update is discovered
- **THEN** the user can download and install it with visible progress and recoverable failure state

### Requirement: Edition restrictions are consistently applied

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Local-only feature in a restricted edition

- **WHEN** the edition does not permit local repositories or local Labs
- **THEN** those routes, settings, and commands are not offered
