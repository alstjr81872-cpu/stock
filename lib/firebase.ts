"use client";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type User,
} from "firebase/auth";

export const emulator = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
let connected = false;
export function firebaseAuth() {
  const app =
    getApps()[0] ||
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  const auth = getAuth(app);
  if (emulator && !connected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connected = true;
  }
  return auth;
}
export async function login() {
  const auth = firebaseAuth();
  await setPersistence(auth, browserSessionPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
    await signInWithRedirect(auth, provider);
    return;
  }
  await signInWithPopup(auth, provider);
}
export async function developmentLogin() {
  if (!emulator)
    throw new Error("개발 로그인은 로컬 Emulator에서만 사용할 수 있습니다.");
  const auth = firebaseAuth();
  await setPersistence(auth, browserSessionPersistence);
  const email = "writer@novelforge.test",
    password = "local-emulator-only";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found" || code === "auth/invalid-credential")
      await createUserWithEmailAndPassword(auth, email, password);
    else throw error;
  }
}
export async function logout() {
  await signOut(firebaseAuth());
}
export { getRedirectResult };
export type { User };
