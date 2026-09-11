import { create } from "zustand";
import { setAuthToken } from "../services/api";
import { fastStorage } from "../lib/fastStorage";
import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "s4_family_finance_mobile_session_v2";

type AuthUser = {
  id: string;
  full_name: string;
  email: string;
  is_email_verified?: boolean;
};

type AuthStore = {
  token: string | null;
  user: AuthUser | null;
  setSession: (token: string | null, user?: AuthUser | null) => void;
  clearSession: () => Promise<void>;
  hydrateToken: (token: string | null) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  token: null,
  user: null,
  setSession: (token, user = null) => {
    setAuthToken(token);
    set({ token, user: user || null });
  },
  hydrateToken: (token) => {
    setAuthToken(token);
    set({ token });
  },
  clearSession: async () => {
    setAuthToken(null);
    set({ token: null, user: null });
    try {
      if (await SecureStore.isAvailableAsync()) {
        await SecureStore.deleteItemAsync(SESSION_KEY);
      }
    } catch {
      /* ignore */
    }
    fastStorage.delete("s4_auth_token");
  },
}));
