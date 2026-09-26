// Firebase setup shared by the student and teacher pages.
import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, get, set, update, remove, push, serverTimestamp, increment, onDisconnect,
  query, orderByChild, equalTo
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

export const configured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE");

let app = null, auth = null, db = null;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
}
export { auth, db };

// Server-synced clock so every phone and the projector agree on when a round starts and ends.
let offset = 0;
if (db) onValue(ref(db, ".info/serverTimeOffset"), s => { offset = s.val() || 0; });
export const now = () => Date.now() + offset;

export const r = path => ref(db, path);
export {
  onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, signOut,
  onValue, get, set, update, remove, push, serverTimestamp, increment, onDisconnect,
  query, orderByChild, equalTo
};
