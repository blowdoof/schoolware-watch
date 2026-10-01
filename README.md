# Schoolware Watch

An independent Chrome extension that monitors
Schoolware agenda changes.

## Features (planned)

- Automatic agenda monitoring
- Detection of new assignments and tests
- Change history
- Browser notifications
- Local data storage
- Multiple student profiles
- CSV export

## Technology

TypeScript, React, Vite, Chrome Manifest V3.

## Status

Phase 2: manual connection diagnostic for the observed Schoolware installation.
Response validation and session-aware error handling are implemented. The project
owner confirmed a successful live Chrome check on 2026-10-01: 449 agenda points
were received and validated through the existing browser session. The check also
succeeded with the Schoolware tab closed, and logout produced the expected
session-unavailable status. Popup-close recovery still needs a live check. Automatic monitoring and
observation history are not implemented yet.

## Development

Requires Node.js 22.12 or newer and npm. Install dependencies with `npm ci`.
On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm run dev
npm run check
```

The dev server previews `/popup.html`, `/dashboard.html`, and `/options.html`.
It does not provide Chrome extension APIs. Use a production build to test the
extension:

```sh
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select this project's `dist` directory. Open the toolbar popup, follow its
dashboard link, and open settings. Check the service worker for startup errors.
Use `npm run build:watch` during extension development and reload the extension
after rebuilds. Schoolware host access is optional and requested only when
starting a manual check.

## Manual connection check

Log in to Schoolware in the same Chrome profile. In extension settings, paste
only the Request URL from the observed AgendaPunt request into **Agendalink**,
then choose **Nu controleren**. The first integration supports only
`schoolware_siw.ksgwl.be`. The URL's dates determine the checked period; they
are not updated automatically. Never paste cookies or authentication headers.

The result reports a validated agenda-point count or a connection error.
Successful checks also show supported test/assignment counts, mixed lesson
content needing review, and other points. For this installation, TypePunt 101
maps to tests and 1001 to assignments. TypePunt 2 remains ambiguous because it
also represents ordinary lesson content. Other codes are not classified yet. No
observation history is created, even for a valid empty response. Use
**Koppeling wissen en toegang intrekken** to delete the local link/result and
revoke host access. See the API investigation for the pending browser checks.

## Documentation

- [Architecture](docs/architecture.md)
- [API investigation](docs/schoolware-api.md)
- [Privacy](docs/privacy.md)
- [Roadmap](docs/roadmap.md)
- [Contributor instructions](AGENTS.md)

## Privacy

All personal Schoolware data will remain stored locally. No credentials are
persisted and no real student data may be committed. The manual diagnostic
stores only the local request configuration and last attempt summary; fetched
agenda content is not persisted.
