# Merge Lab specification

## Purpose

Define a read-only simulation of the combined future state of multiple pull requests.

## Requirements

### Requirement: Users can select a bounded set of candidate pull requests

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Running a simulation

- **WHEN** the reviewer selects candidates and starts Merge Lab
- **THEN** Reviewly loads their file facts and computes aggregate files, lines, surfaces, findings, and a proposed order

### Requirement: Known blockers prevent a ready result

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: File collision

- **WHEN** two selected pull requests change the same file
- **THEN** the simulation reports a blocker and identifies the colliding file

#### Scenario: Existing conflict or failing CI

- **WHEN** any selected pull request conflicts with its base or has failing checks
- **THEN** the simulation is blocked

### Requirement: Architecture and coverage risks remain warnings

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Sensitive architecture file

- **WHEN** the set changes package manifests, TypeScript configuration, Turborepo configuration, CODEOWNERS, or package source boundaries
- **THEN** Reviewly warns that Living architecture should be rescanned

#### Scenario: Broad source change without test changes

- **WHEN** the combined set changes more than four source files and no test file
- **THEN** Reviewly emits a coverage warning

### Requirement: Proposed order respects stacks and blockers

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Stacked pull requests

- **WHEN** selected pull requests have stack positions
- **THEN** their proposed future-branch order follows dependency position within the repository

### Requirement: Simulation does not mutate remote state

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Simulation completes

- **WHEN** Merge Lab reports ready, attention, or blocked
- **THEN** it has not merged, rebased, pushed, or changed any pull request
