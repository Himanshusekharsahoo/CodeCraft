import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

// Firebase client configuration - strictly driven by environment variables
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Fail clearly if required Firebase configuration is missing
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    "Missing required Firebase configuration (NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID). Please check your environment variables."
  );
}

// Initialize Firebase (guard against multiple initializations)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Initialize Realtime Database only if databaseURL is configured
let rtdb = null;
try {
  if (firebaseConfig.databaseURL) {
    rtdb = getDatabase(app);
  }
} catch (error) {
  console.warn("Firebase Realtime Database initialization skipped or failed:", error.message);
  rtdb = null;
}
const firestore = db; // Backward-compatible alias for any legacy imports

// Set Auth Persistence (client-side only)
if (typeof window !== "undefined") {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error("Firebase Auth Persistence initialization failed:", error.message);
  });
}

// Export Firebase services
export { auth, db, rtdb, firestore };
export default app;
