# Graphite workspace implementation plan

**Goal:** Apply the user-approved dark dashboard reference throughout the existing OpenFacto application.

**Architecture:** A scoped CSS theme keeps the existing routes and data flows. Existing components receive only the minimal presentation changes required by the reference.

**Tech stack:** React, Vite, CSS, local SVG, existing Montserrat variable font and Phosphor icons.

- [x] Add a static sand-garden backdrop in public and scoped Workspace.css theme tokens, desktop frame, compact navigation, surfaces, forms, lists, dialogs and responsive rules.
- [x] Import the theme last in App.tsx. Add primary-button color tokens with backward-compatible fallbacks. Remove decorative section banners from Knowledge, Testing and Settings; keep all functional content.
- [x] Build and run existing frontend tests. Inspect overview, knowledge, playground, inbox and settings in the browser; verify source dialog and mobile navigation.
- [x] Save proof screenshots, fix visual defects, verify API and frontend availability, and record the result.
