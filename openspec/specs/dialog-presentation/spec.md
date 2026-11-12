# Dialog presentation specification

## Purpose

Define a consistent, theme-aware dialog treatment that preserves page context and respects reduced-transparency preferences.

## Requirements

### Requirement: Dialogs use the active page palette

Dialog, alert-dialog, and command-dialog surfaces SHALL derive their foreground, background, border, and footer treatment from the active Reviewly theme rather than from a separate fixed menu palette.

#### Scenario: Opening a dialog in any supported theme

- **WHEN** a dialog opens
- **THEN** its text and surface use the active theme tokens
- **AND** its backdrop leaves enough page context visible to understand where the dialog originated

### Requirement: Transparency adapts to platform support and preference

Dialogs MAY use a translucent blurred surface when the platform supports backdrop filtering, but SHALL remain usable without that effect.

#### Scenario: Backdrop filtering is supported

- **WHEN** the platform supports backdrop filtering and reduced transparency is not requested
- **THEN** the dialog uses a theme-aware translucent surface with restrained blur and a visible rim

#### Scenario: Reduced transparency is requested

- **WHEN** the operating system requests reduced transparency
- **THEN** the dialog uses an opaque page-colored background
- **AND** disables backdrop filtering on the dialog surface
