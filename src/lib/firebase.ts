import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config";

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export { firebaseConfig };

export const auth = getAuth(app);
export const db = (() => {
  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true });
  } catch {
    return getFirestore(app);
  }
})();
export default app;
