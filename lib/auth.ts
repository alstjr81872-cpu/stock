"use client";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import { onAuthStateChanged as watchFirebase } from "firebase/auth";
import * as legacy from "./firebase";
export type User = {
  uid: string;
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
};
export const supabaseMode =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "supabase";
export const emulator = !supabaseMode && legacy.emulator;
let client: SupabaseClient | undefined;
export function supabase() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
      throw new Error(
        "Supabase 공개 연결 설정이 필요합니다. 배포 안내를 확인하세요.",
      );
    client = createClient(url, key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
function userFrom(session: Session | null): User | null {
  if (!session) return null;
  return {
    uid: session.user.id,
    email: session.user.email ?? null,
    displayName:
      session.user.user_metadata.full_name ??
      session.user.user_metadata.name ??
      null,
    getIdToken: async () => {
      const { data, error } = await supabase().auth.getSession();
      if (error || !data.session) throw new Error("다시 로그인해주세요.");
      return data.session.access_token;
    },
  };
}
let current: User | null = null;
export const currentUser = () =>
  supabaseMode ? current : legacy.firebaseAuth().currentUser;
export function watchAuth(
  callback: (u: User | null) => void,
  onError: (message: string) => void,
) {
  if (!supabaseMode) {
    const a = legacy.firebaseAuth();
    legacy.getRedirectResult(a).catch((e) => onError(e.message));
    return watchFirebase(a, callback);
  }
  const auth = supabase().auth;
  let alive = true;
  let eventSeen = false;
  const { data } = auth.onAuthStateChange((_event, session) => {
    if (!alive) return;
    eventSeen = true;
    current = userFrom(session);
    callback(current);
  });
  auth
    .getSession()
    .then(({ data, error }) => {
      if (!alive || eventSeen) return;
      if (error) onError(error.message);
      current = userFrom(data.session);
      callback(current);
    })
    .catch((e) => {
      if (alive) {
        onError(e.message);
        callback(null);
      }
    });
  const err = new URLSearchParams(window.location.search).get(
    "error_description",
  );
  if (err) onError(err);
  return () => {
    alive = false;
    data.subscription.unsubscribe();
  };
}
export async function login() {
  if (!supabaseMode) return legacy.login();
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/",
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}
export async function logout() {
  if (!supabaseMode) return legacy.logout();
  const { error } = await supabase().auth.signOut();
  if (error) throw error;
  current = null;
}
export async function developmentLogin() {
  if (supabaseMode) throw new Error("실제 Google 로그인을 사용해주세요.");
  return legacy.developmentLogin();
}
