// Canonical Firebase exports live in ./firebase/firebase (Cloud Firestore + Authentication).
// Re-export here so all imports use the single initialized Firebase App, Auth, and Firestore instance.
export { app, auth, db, firestore, storage, firebaseConfig } from './firebase/firebase';
