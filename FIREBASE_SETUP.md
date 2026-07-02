# CarnCal Cloud Sync — Setup Guide

Cloud Sync uses **Firebase** (Google's app backend platform — Firestore for
the database, Firebase Auth for team sign-in). I picked it specifically
because Firestore's offline persistence is built to do exactly what you
asked: keep working fully offline, and automatically push queued writes to
the shared database the moment the device gets a connection again — no
custom sync/queue code needed.

**Cost:** the free "Spark" tier covers this comfortably — 1 GiB storage,
50K reads / 20K writes per day, no credit card required to start. A vet
team's case records won't come close to that.

**Until you complete this guide, nothing changes** — the app works exactly
as it does now, fully offline, no sign-in prompts, no errors. Cloud Sync
just silently stays off.

---

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and sign in with a Google
   account (create a dedicated one for the project if you'd rather not tie
   it to a personal account).
2. Click **Add project**, name it (e.g. `carncal-mpfd`), and finish the
   wizard. You can decline Google Analytics — not needed here.

## 2. Enable Firestore

1. In the left sidebar: **Build → Firestore Database → Create database**.
2. Choose a region close to you (e.g. `asia-south1` — Mumbai — for lowest
   latency from Madhya Pradesh).
3. Start in **production mode** (not test mode — test mode leaves the
   database wide open to anyone for 30 days, which you don't want given
   the GPS data in case records).

## 3. Apply the security rules

1. In Firestore, go to the **Rules** tab.
2. Replace the contents with everything in `firestore.rules` from this
   repo, then **Publish**.
3. This restricts all read/write access to signed-in users you've
   explicitly added — see step 5.

## 4. Enable Email/Password sign-in

1. **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.
3. There's no self-registration in the app itself — you create each team
   member's account directly (next step), which keeps membership under
   your control.

## 5. Add your team

For each vet who needs access:

1. **Authentication → Users → Add user**. Enter their email and a
   temporary password (tell them to change it after first sign-in — there's
   no in-app "change password" yet, but Firebase's own hosted reset flow
   works if you want to enable it under Templates later).
2. Copy their **User UID** from the users list.
3. Go to **Firestore Database → Data**, create a collection called
   `team_members` if it doesn't exist, and add a document whose **Document
   ID is that UID** (contents can be empty, or `{name: "Dr X"}` for your
   own reference — the rules only check that the document exists).

Repeat for each team member. Without this step, a vet can sign in but
Firestore will reject all their reads/writes (by design).

## 6. Get your web app config

1. **Project settings** (gear icon) → scroll to **Your apps** → click the
   **Web** icon (`</>`) → register an app (nickname doesn't matter, skip
   Firebase Hosting).
2. Copy the `firebaseConfig` object shown.
3. Open `firebase-config.js` in this repo and paste your real values in,
   replacing the `REPLACE_ME` placeholders.
4. This file is safe to commit and publish — it identifies your project,
   it doesn't grant access. Access is controlled entirely by the rules
   from step 3.

## 7. Deploy

Commit and push `firebase-config.js` along with the rest of the app.
Bump `CACHE_VERSION` in `sw.js` one more time if you've already deployed
once before finishing this guide, so the service worker picks up the
real config.

## 8. Test it

1. Open the app, go to **My Drugs → Cloud Sync**, sign in with a team
   member's email/password.
2. Save a case. Check **Firestore Database → Data → cases** in the
   console — the record should appear (may take a few seconds).
3. Turn on airplane mode, save another case — it saves locally as normal.
   Turn airplane mode back off and reopen the app; it should appear in
   Firestore shortly after.

---

## What this does NOT do (yet)

- No pulling shared cases *back down* into another vet's device/history
  view — this build only pushes local saves up. Worth a follow-up if your
  team wants to browse each other's cases in the app itself, rather than
  via the Firebase console.
- No password reset flow in-app.
- No per-record edit conflict handling beyond "last write wins" — fine for
  case records that are essentially append-only once darted, worth
  revisiting if that assumption changes.
