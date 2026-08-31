## ADDED Requirements

### Requirement: Interactive titlebar controls remain clickable

Desktop frameless titlebar regions MUST preserve clickable controls with `no-drag`
semantics while exposing non-interactive blank space as a window drag region.

#### Scenario: Right panel toolbar blank space drags the window

- **WHEN** the user drags non-interactive blank space in the right panel toolbar
- **THEN** the desktop window MUST move with the pointer
- **AND** clicking Files, Git, refresh, or overflow controls MUST still invoke the control
