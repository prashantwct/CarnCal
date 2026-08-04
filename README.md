# CarnCal

Offline-first anaesthesia monitoring sheet and multi-drug dose calculator for
wild carnivore immobilization, built as an installable Progressive Web App
(PWA). No build step, no backend required — it's static HTML/JS that runs
entirely on-device and keeps working with zero signal in the field.

## Features

- Tab flow follows the field sequence: **Case** (identity/signalment) →
  **Calculator** (multi-drug dosing) → **Monitoring** (timeline, live
  log, revival) → Morphometry → Reference → My Drugs → History. The
  current animal weight stays visible in the header across every tab.
- Multi-drug dose calculator (weight × mg/kg ÷ mg/ml → volume), with a
  built-in and fully editable drug library (add, edit, delete), grouped
  by category (Anaesthetic/Emergency/Antibiotic/Analgesic/Anti-parasitic/
  Custom) in the drug picker
- Full capture record: identity/signalment, GPS, timeline, live monitoring
  log, revival/release, and morphometry
- Analogue anaesthesia timer with a visual warning past 35 minutes
- Local history with CSV export, a printable PDF datasheet, and
  search/filter on History, Reference, and My Drug Library
- Full JSON backup/restore
- Optional Firebase Cloud Sync for team sharing — see
  [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md). The app is fully usable
  without ever setting this up.

## Running locally

No dependencies to install. Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly via `file://` also works for basic use, but
service-worker offline caching requires being served over `http(s)://`
(localhost is fine).

## Deploying

Any static host works — GitHub Pages, Netlify, Vercel, Firebase Hosting,
or an internal MPFD/WCT server. Steps:

1. Push this repo (or copy its files) to your host of choice.
2. Confirm the deployed URL serves over **HTTPS** — required for the
   service worker and GPS geolocation API to function.
3. Open the deployed URL on a phone and use "Add to Home Screen" to
   install it as an app.

To enable Cloud Sync, follow [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md)
before deploying, or any time after — it's additive and never blocks the
offline-first core.

## Data & privacy

- Every record is saved to the device's local storage first, always.
  Cloud Sync (if configured) is a background mirror on top of that, not
  a replacement for it.
- Case records include GPS coordinates — sensitive, anti-poaching-relevant
  data. Firestore security rules (`firestore.rules`) default-deny all
  access and only allow signed-in, admin-approved team members to
  read/write; there is no public read access or self-registration.
- Use **Download Full Backup** (My Drugs tab) periodically, especially
  before clearing browser data or switching devices — local storage is
  not automatically backed up anywhere unless Cloud Sync is configured.

## Testing

A small dependency-free smoke-test suite covers the pure logic (HTML/CSV
escaping, GPS coordinate validation, backup-file validation):

```bash
node tests/test_core.js
```

## Project structure

```
index.html          UI, layout, and styling
app.js               Core app logic: calculator, records, history, PDF/CSV export
sync.js              Optional Firebase Cloud Sync layer (no-op until configured)
firebase-config.js   Firebase project config (safe to be public — see file comments)
firestore.rules      Firestore security rules for Cloud Sync
sw.js                Service worker for offline caching
manifest.json        PWA manifest
icons/               App icons (all manifest-required sizes)
tests/               Smoke tests
FIREBASE_SETUP.md    Step-by-step Cloud Sync setup guide
```
