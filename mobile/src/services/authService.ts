import { api, setAuthToken } from "./api";

/** Auth against the VPS API (JWT). There is no Firebase / cloud login. */
export type AuthUser = {
  id: string;
  full_name: string;
  email: string;
  is_email_verified?: boolean;
  preferred_language?: string;
};

export type LoginResult = {
  access_token: string;
  refresh_token?: string | null;
  user: AuthUser;
  family_id?: string;
};

export const authService = {
  async login(email: string, password: string): Promise<LoginResult> {
    const data = await api.post<LoginResult>("/api/v1/auth/login", { email, password });
    if (data.access_token) setAuthToken(data.access_token);
    return data;
  },

  async me(token?: string): Promise<AuthUser> {
    return api.get<AuthUser>("/api/v1/auth/me", token);
  },

  async register(payload: { full_name: string; email: string; password: string; phone?: string }) {
    return api.post("/api/v1/auth/register", payload);
  },

  async verifyEmail(token: string) {
    return api.post("/api/v1/auth/verify-email", { token });
  },

  async forgotPassword(email: string) {
    return api.post("/api/v1/auth/forgot-password", { email });
  },

  async resetPassword(token: string, new_password: string) {
    return api.post("/api/v1/auth/reset-password", { token, new_password });
  },

  async logout() {
    setAuthToken(null);
  },
};
