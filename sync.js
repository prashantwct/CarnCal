// Cloud Sync for CarnCal — OPTIONAL layer on top of the existing
// localStorage-first design. Nothing in here is allowed to break offline
// use of the app:
//   - If firebase-config.js still has placeholder values, sync silently
//     stays off.
//   - If the Firebase CDN can't be reached (offline, blocked network),
//     sync silently stays off.
//   - Every entry point is wrapped so a sync failure never throws past
//     this file and never blocks a local save.
//
// How it works: case records are always saved to localStorage first (see
// app.js, unchanged). If the user is signed in, saveCase() also writes the
// same record to Firestore. Firestore's own offline persistence queues
// that write locally and delivers it automatically once the device is
// back online — there is no custom retry/queue logic needed here, that's
// built into the SDK.

const FIREBASE_SDK_VERSION = "10.12.0";
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let auth = null;
let db = null;
let currentUser = null;
let ready = false;

function setStatus(text, bg) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.textContent = text;
    if (bg) el.style.background = bg;
}

function showSignedOutUI() {
    const out = document.getElementById('syncSignedOut');
    const inn = document.getElementById('syncSignedIn');
    if (out) out.style.display = 'block';
    if (inn) inn.style.display = 'none';
}

function showSignedInUI(email) {
    const out = document.getElementById('syncSignedOut');
    const inn = document.getElementById('syncSignedIn');
    if (out) out.style.display = 'none';
    if (inn) inn.style.display = 'block';
}

async function init() {
    try {
        const cfgModule = await import('./firebase-config.js');
        const firebaseConfig = cfgModule.firebaseConfig;

        if (!firebaseConfig || firebaseConfig.apiKey === 'REPLACE_ME') {
            setStatus('Cloud Sync not set up yet — app works fully offline as usual. See FIREBASE_SETUP.md.', '#f1f3f5');
            return;
        }

        const [{ initializeApp }, authMod, fsMod] = await Promise.all([
            import(`${CDN}/firebase-app.js`),
            import(`${CDN}/firebase-auth.js`),
            import(`${CDN}/firebase-firestore.js`)
        ]);

        const app = initializeApp(firebaseConfig);
        auth = authMod.getAuth(app);

        try {
            db = fsMod.initializeFirestore(app, {
                localCache: fsMod.persistentLocalCache({
                    tabManager: fsMod.persistentMultipleTabManager()
                })
            });
        } catch (persistErr) {
            // Falls back to an in-memory-only Firestore instance if
            // persistent local cache can't start (e.g. private browsing,
            // multiple conflicting tabs on an older SDK). Sync still
            // works while the app is open; it just won't queue writes
            // made while fully offline in this fallback case.
            console.warn('[CarnCal Sync] Persistent cache unavailable, using in-memory Firestore', persistErr);
            db = fsMod.getFirestore(app);
        }

        window.__CarnCalFirestore = { db, fsMod };

        authMod.onAuthStateChanged(auth, (user) => {
            currentUser = user;
            if (user) {
                setStatus(`Signed in as ${user.email} — cases sync automatically when online`, '#e6f4ea');
                showSignedInUI(user.email);
            } else {
                setStatus('Signed out — cases stay on this device only', '#f1f3f5');
                showSignedOutUI();
            }
        });

        ready = true;
    } catch (err) {
        // Most commonly: offline on first load before anything is cached,
        // or the gstatic CDN is unreachable on this network. Either way,
        // the core app must keep working normally.
        console.warn('[CarnCal Sync] Unavailable this session (app continues offline as normal):', err);
        setStatus('Cloud Sync unavailable right now (offline?) — app works fully offline as usual', '#f1f3f5');
    }
}

async function signIn() {
    if (!ready || !auth) { setStatus('Cloud Sync isn\'t configured yet.', '#f1f3f5'); return; }
    const email = document.getElementById('sync_email')?.value?.trim();
    const password = document.getElementById('sync_password')?.value;
    if (!email || !password) { alert('Enter your team email and password.'); return; }
    try {
        const authMod = await import(`${CDN}/firebase-auth.js`);
        await authMod.signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        console.warn('[CarnCal Sync] Sign-in failed', err);
        alert('Sign-in failed: ' + (err.message || 'check your email/password and connection.'));
    }
}

async function signOutUser() {
    if (!auth) return;
    try {
        const authMod = await import(`${CDN}/firebase-auth.js`);
        await authMod.signOut(auth);
    } catch (err) {
        console.warn('[CarnCal Sync] Sign-out failed', err);
    }
}

// Called from app.js right after a case is saved locally. Never throws —
// any failure here is logged only, so it can never interrupt the "Saved
// to History!" flow that already happened locally.
async function saveCase(rec) {
    if (!ready || !db || !currentUser || !rec || !rec.id) return;
    try {
        const fsMod = window.__CarnCalFirestore.fsMod;
        const ref = fsMod.doc(db, 'cases', String(rec.id));
        await fsMod.setDoc(ref, {
            ...rec,
            _syncedBy: currentUser.email,
            _syncedAt: fsMod.serverTimestamp()
        }, { merge: true });
    } catch (err) {
        // Expected and harmless while offline — Firestore's local cache
        // has already queued this write and will send it once back
        // online. Only truly unexpected errors are worth a console note.
        console.warn('[CarnCal Sync] Case queued locally, will sync when online:', err.message || err);
    }
}

window.CarnCalSync = { signIn, signOutUser, saveCase };

init();
