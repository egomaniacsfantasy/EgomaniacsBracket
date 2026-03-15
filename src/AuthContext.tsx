import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { saveBracket } from "./bracketStorage";
import { captureError } from "./lib/errorMonitoring";

type Profile = {
  display_name: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, displayName: string, password: string) => Promise<{ data: unknown; error: unknown }>;
  signIn: (email: string, password: string) => Promise<{ data: unknown; error: unknown }>;
  signInWithGoogle: () => Promise<{ data: unknown; error: unknown }>;
  isDisplayNameAvailable: (displayName: string, excludeUserId?: string | null) => Promise<{ available: boolean; error: unknown }>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PROFILE_QUERY_TIMEOUT_MS = 8000;

async function withTimeout<T>(promiseLike: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      Promise.resolve(promiseLike),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const profileRequestRef = useRef(0);

  const fetchProfile = async (userId: string, authUser?: User | null) => {
    const requestId = ++profileRequestRef.current;

    try {
      const { data } = await withTimeout(
        supabase.from("profiles").select("display_name").eq("id", userId).single(),
        PROFILE_QUERY_TIMEOUT_MS,
        "Timed out loading your profile."
      );
      if (!mountedRef.current || requestId !== profileRequestRef.current) return;
      const profileData = (data as Profile | null) ?? null;
      const googleName = authUser?.user_metadata?.full_name as string | undefined;

      if (profileData && (!profileData.display_name || profileData.display_name === "Anonymous") && googleName) {
        await supabase.from("profiles").update({ display_name: googleName }).eq("id", userId);
        if (!mountedRef.current || requestId !== profileRequestRef.current) return;
        setProfile({ ...profileData, display_name: googleName });
        return;
      }

      setProfile(profileData);
    } catch (error) {
      captureError("auth_fetch_profile", error);
      if (!mountedRef.current || requestId !== profileRequestRef.current) return;
      setProfile(null);
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mountedRef.current) return;
        setUser(session?.user ?? null);
        setLoading(false);
        if (session?.user) {
          setProfile(null);
          void fetchProfile(session.user.id, session.user);
        } else {
          profileRequestRef.current += 1;
          setProfile(null);
        }
      } catch (error) {
        captureError("auth_get_session", error);
        if (!mountedRef.current) return;
        setUser(null);
        setProfile(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    void initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return;

      setUser(session?.user ?? null);
      setLoading(false);

      if (!session?.user) {
        profileRequestRef.current += 1;
        setProfile(null);
        return;
      }

      setProfile(null);
      const userId = session.user.id;
      setTimeout(() => {
        if (!mountedRef.current) return;
        void fetchProfile(userId, session.user);

        if (event === "SIGNED_IN") {
          const pendingRaw = window.sessionStorage.getItem("pendingBracketSave");
          if (!pendingRaw) return;

          window.sessionStorage.removeItem("pendingBracketSave");
          try {
            const pendingPicks = JSON.parse(pendingRaw) as Record<string, string>;
            void saveBracket(userId, pendingPicks, "My Bracket", null, undefined, { submit: false }).catch((error) => {
              captureError("auth_pending_bracket_save", error);
            });
          } catch (error) {
            captureError("auth_pending_bracket_save", error);
          }
        }
      }, 0);
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, displayName: string, password: string) => {
    const normalizedDisplayName = displayName.trim();
    const { data: existingName, error: existingNameError } = await supabase
      .from("profiles")
      .select("id, display_name")
      .ilike("display_name", normalizedDisplayName)
      .limit(1);
    if (!existingNameError && (existingName ?? []).length > 0) {
      return { data: null, error: { message: "Display name already taken. Try adding a number." } };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: normalizedDisplayName },
        emailRedirectTo: window.location.origin,
      },
    });

    // Supabase returns success with empty identities when the email already
    // exists (confirmed or unconfirmed). In that case no confirmation email
    // is sent, so we need to explicitly resend it for unconfirmed users.
    const identities = data?.user?.identities;
    if (!error && Array.isArray(identities) && identities.length === 0) {
      // Try to resend the confirmation email so the user actually receives it
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (resendError) {
        // If resend also fails, the account likely already exists and is confirmed
        return { data: null, error: { message: "This email already has an account. Try logging in instead." } };
      }
      // Resend succeeded — return the original data so the UI shows "check your email"
      return { data, error: null };
    }

    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signInWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    return { data, error };
  };

  const isDisplayNameAvailable = async (displayName: string, excludeUserId?: string | null) => {
    const normalized = displayName.trim();
    if (!normalized) return { available: false, error: { message: "Display name is required." } };
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .ilike("display_name", normalized)
      .limit(5);
    if (error) return { available: false, error };
    const taken = (data ?? []).some((row) => String((row as { id?: string }).id ?? "") !== String(excludeUserId ?? ""));
    return { available: !taken, error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    profileRequestRef.current += 1;
    setUser(null);
    setProfile(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signUp,
        signIn,
        signInWithGoogle,
        isDisplayNameAvailable,
        signOut,
        isAuthenticated: Boolean(user),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
