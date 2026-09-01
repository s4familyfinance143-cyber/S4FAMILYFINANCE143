import { initializeApp, getApps } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration — s4-family-finance
export const firebaseConfig = {
  apiKey: "AIzaSyDO05KM8i2WlERcajsqCIMNvKos8tw14lc",
  authDomain: "s4-family-finance.firebaseapp.com",
  projectId: "s4-family-finance",
  storageBucket: "s4-family-finance.firebasestorage.app",
  messagingSenderId: "1089437513968",
  appId: "1:1089437513968:web:0e4438c9489251bf00ea35",
  measurementId: "G-XPQ83E8VC4",
};

// Initialize Firebase
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let analytics = null;
if (typeof window !== "undefined") {
  isSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(app);
    })
    .catch(() => {
      /* analytics optional */
    });
}

let authInstance = null;
let dbInstance = null;

export function isFirebaseConfigured() {
  return true;
}

export function getFirebaseConfig() {
  return firebaseConfig;
}

export function getFirebaseApp() {
  return app;
}

export function getFirebaseAnalytics() {
  return analytics;
}

export function getFirebaseAuth() {
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
}

export function getFirestoreDb() {
  if (!dbInstance) dbInstance = getFirestore(app);
  return dbInstance;
}
