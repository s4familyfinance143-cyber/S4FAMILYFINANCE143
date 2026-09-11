import { api, setAuthToken } from "./api";
import { isFirebaseFirstMode } from "../firebase/config";
import {
  firebaseSignInEmail,
  firebaseSendPasswordReset,
  firebaseRegisterEmail,
  firebaseSignOut,
  isFirebaseEmailVerified,
} from "../firebase/auth";
import { ensureUserProfile, getUserFamilyProfile, pullCloudSnapshot, resolveAndBindUserFamily, bindCloudFamilyIdentity } from "../firebase/cloudSync";
import { persistCloudFamilyId, persistCloudOnlyMode } from "../lib/cloudSession";
import { setCloudApiContext } from "../lib/cloudApiBridge";

export type AuthUser = {
  id: string;
  full_name: string;
  email: string;
  is_email_verified?: boolean;
  preferred_language?: string;
  uid?: string;
};

export type LoginResult = {
  access_token: string;
  refresh_token?: string | null;
  user: AuthUser;
  family_id?: string;
};

function cloudTokenFor(uid: string) {
  return `firebase.${uid}`;
}

export const authService = {
  async login(email: string, password: string): Promise<LoginResult> {
    if (isFirebaseFirstMode()) {
      const user = await firebaseSignInEmail(email, password);
      await ensureUserProfile(user.uid, user);
      let familyId = "";
      try {
        familyId = await resolveAndBindUserFamily({
          uid: user.uid,
          email: user.email || email,
          displayName: user.displayName || null,
        });
      } catch {
        const profile = await getUserFamilyProfile(user.uid).catch(() => null);
        familyId = String(profile?.family_id || "");
        try {
          const pulled = await pullCloudSnapshot(user.uid);
          if (pulled?.familyId) familyId = String(pulled.familyId);
        } catch {
          /* offline */
        }
      }
      if (familyId) {
        await persistCloudOnlyMode(true);
        await persistCloudFamilyId(familyId);
        try {
          await bindCloudFamilyIdentity({
            uid: user.uid,
            familyId,
            email: user.email || email,
            displayName: user.displayName || null,
            role: "MEMBER",
          });
        } catch {
          /* ignore */
        }
        setCloudApiContext({
          familyId,
          user: {
            uid: user.uid,
            email: user.email || undefined,
            displayName: user.displayName || undefined,
          },
        });
      }
      const access_token = cloudTokenFor(user.uid);
      setAuthToken(access_token);
      return {
        access_token,
        refresh_token: null,
        family_id: familyId || undefined,
        user: {
          id: user.uid,
          uid: user.uid,
          full_name: user.displayName || user.email || "Cloud User",
          email: user.email || email,
          is_email_verified: isFirebaseEmailVerified(user),
        },
      };
    }

    const data = await api.post<LoginResult>("/api/v1/auth/login", { email, password });
    if (data.access_token) setAuthToken(data.access_token);
    return data;
  },

  async me(token?: string): Promise<AuthUser> {
    return api.get<AuthUser>("/api/v1/auth/me", token);
  },

  async register(payload: { full_name: string; email: string; password: string; phone?: string }) {
    if (isFirebaseFirstMode()) {
      const registered = await firebaseRegisterEmail(payload.email, payload.password, payload.full_name);
      return {
        user: {
          id: registered.user.uid,
          uid: registered.user.uid,
          full_name: payload.full_name,
          email: payload.email,
          is_email_verified: isFirebaseEmailVerified(registered.user),
        },
        verificationSent: registered.verificationSent,
      };
    }
    return api.post("/api/v1/auth/register", payload);
  },

  async verifyEmail(token: string) {
    return api.post("/api/v1/auth/verify-email", { token });
  },

  async forgotPassword(email: string) {
    if (isFirebaseFirstMode()) {
      await firebaseSendPasswordReset(email);
      return { ok: true };
    }
    return api.post("/api/v1/auth/forgot-password", { email });
  },

  async resetPassword(token: string, new_password: string) {
    return api.post("/api/v1/auth/reset-password", { token, new_password });
  },

  async logout() {
    if (isFirebaseFirstMode()) {
      try {
        await firebaseSignOut();
      } catch {
        /* ignore */
      }
      setCloudApiContext({ familyId: "", user: null, onAfterWrite: null });
    }
    setAuthToken(null);
  },
};
