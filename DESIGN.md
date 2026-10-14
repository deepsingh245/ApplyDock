# ApplyDock interface direction

## Purpose

Make a personal application queue feel like a quiet work desk. The sidebar is for capture and quick review; the web workspace is for careful editing and delivery decisions. Sent local emails leave both active queues, while Notion keeps their record.

## Visual rules

- Use cool neutral surfaces, dark slate text, and one restrained blue accent. Reserve color for actions, focus, and status.
- Use a three-part desktop layout: queue, editor, action inspector. The editor gets most of the width. Collapse to a single column on narrow screens.
- Separate dense content with thin rules and space. Use cards only for the pairing and settings views, where a bounded form helps orientation.
- Use a compact, readable sans-serif hierarchy. Titles carry the visual weight; metadata stays quiet. Keep controls at least 42 px high.
- Show an item’s state near its title and in the action inspector. Use clear, local language for Gmail and SMTP actions.
- Provide visible focus, inline validation, useful empty states, and a reduced-motion path. Email text remains plain text and is previewed without interpreting HTML.

## Interaction rules

- Capture requires a user-selected page or manual form submission. Drafting never approves or sends an email.
- Preserve unsaved editor changes until the user saves or confirms discarding them.
- Put credentials and account connections on Settings, away from the daily queue.
- Open the web workspace from the sidebar without putting its pairing key in a URL.
