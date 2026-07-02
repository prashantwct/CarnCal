// Firebase project configuration.
//
// This is NOT a secret — it identifies your Firebase project, it does not
// authorize access to it. Access control is enforced entirely by the
// Firestore Security Rules you set up in the Firebase console (see
// firestore.rules and FIREBASE_SETUP.md in this repo). It's safe for this
// file to sit in a public GitHub repo / static site.
//
// Replace the placeholder values below with the config object from:
// Firebase Console -> Project settings -> General -> Your apps -> SDK setup
// and configuration -> Config
//
// Until you do, Cloud Sync silently stays disabled and CarnCal keeps
// working exactly as before — fully offline, nothing breaks.

export const firebaseConfig = {
    apiKey: "REPLACE_ME",
    authDomain: "REPLACE_ME.firebaseapp.com",
    projectId: "REPLACE_ME",
    storageBucket: "REPLACE_ME.appspot.com",
    messagingSenderId: "REPLACE_ME",
    appId: "REPLACE_ME"
};
