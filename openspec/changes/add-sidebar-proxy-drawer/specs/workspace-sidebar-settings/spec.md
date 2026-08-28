## ADDED Requirements

### Requirement: Sidebar settings menu MUST expose network proxy configuration

The sidebar settings menu MUST provide a network proxy action with a ladder icon. Selecting it MUST close the menu and open a non-modal sidebar drawer rather than a modal dialog.

#### Scenario: user opens the proxy drawer

- **WHEN** the user selects the network proxy action from the sidebar settings menu
- **THEN** the menu closes
- **AND** a proxy configuration drawer is visible
- **AND** the main application remains interactive outside the drawer

### Requirement: Proxy drawer MUST retain existing proxy controls

The proxy drawer MUST expose enable/disable, editable proxy URL, and explicit save behavior. Switching enable state MUST retain the existing immediate-apply persistence semantics. When no proxy URL is persisted, the editable draft MUST default to `http://127.0.0.1:7890` without persisting it merely by opening the drawer.

#### Scenario: user saves a default proxy address

- **GIVEN** no proxy URL is configured
- **WHEN** the user opens the proxy drawer
- **THEN** the address field contains `http://127.0.0.1:7890`
- **WHEN** the user saves it
- **THEN** the existing app-settings persistence path saves that address
