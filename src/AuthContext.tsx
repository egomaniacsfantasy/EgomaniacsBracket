import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { saveBracket } from "./bracketStorage";

type Profile = {
  display_name: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, displayName: string, password: string) => Promise<{ data: unknown; error: unknown }>;
  signIn: (email: string, password: string) => Promise<{ data: unknown; error: unknown }>;
  isDisplayNameAvailable: (displayName: string, excludeUserId?: string | null) => Promise<{ available: boolean; error: unknown }>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string, authUser?: User | null) => {
    const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
    const profileData = (data as Profile | null) ?? null;
    const googleName = authUser?.user_metadata?.full_name as string | undefined;

    if (profileData && (!profileData.display_name || profileData.display_name === "Anonymous") && googleName) {
      await supabase.from("profiles").update({ display_name: googleName }).eq("id", userId);
      setProfile({ ...profileData, display_name: googleName });
      return;
    }

    setProfile(profileData);
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id, session.user);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id, session.user);
        if (event === "SIGNED_IN") {
          const pendingRaw = window.sessionStorage.getItem("pendingBracketSave");
          if (pendingRaw) {
            window.sessionStorage.removeItem("pendingBracketSave");
            try {
              const pendingPicks = JSON.parse(pendingRaw) as Record<string, string>;
              await saveBracket(session.user.id, pendingPicks, "My Bracket");
            } catch {
              // ignore bad pending payload
            }
          }
        }
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
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
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
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
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signUp,
        signIn,
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
