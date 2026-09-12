import { useEffect, useRef, useState } from "react";
import "./s4-login.css";
import { BRAND_LOGO_SRC } from "../../lib/brandAssets";
import { formatFetchError, isLocalhostApi, isNativeApp, isProductionApi } from "../../lib/runtimeEnv";
import {
  JOIN_RELATIONSHIPS,
  OWNER_RELATIONSHIPS,
  buildJoinInvitePayload,
  needsLinkedMember,
  needsRelationshipNote,
  needsSerial,
  serialLabelsFor,
} from "../../lib/familyRelationships";

const REL_LABEL = {
  bn: {
    Husband: "স্বামী",
    Wife: "স্ত্রী",
    Father: "বাবা",
    Mother: "মা",
    Guardian: "অভিভাবক",
    Other: "অন্যান্য",
    Son: "ছেলে",
    Daughter: "মেয়ে",
    Brother: "ভাই",
    Sister: "বোন",
    "Elder Brother": "বড় ভাই",
    "Elder Sister": "বড় বোন",
    "Son's Wife": "পুত্রবধূ",
    "Daughter's Husband": "জামাই",
    Relative: "আত্মীয়",
  },
  en: {},
};

function relText(lang, value) {
  if (lang === "bn") return REL_LABEL.bn[value] || value;
  return value;
}

function normalizeApiBase(value) {
  const cleaned = String(value || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(cleaned)) {
    return `${cleaned.replace(/\/api(?:\/v\d+)?$/i, "")}/api/v1`;
  }
  return cleaned;
}

const UI = {
  bn: {
    logoSub: "Full Architecture v2.1 · Family Finance Platform",
    title: "S4 FAMILY FINANCE 143",
    subtitle: "পরিবারের হিসাব — লগইন করুন, পরিবার তৈরি করুন, অথবা ইনভাইট দিয়ে যোগ দিন",
    modeLabel: "কী করতে চান?",
    btnLogin: "লগইন",
    btnCreate: "পরিবার তৈরি",
    btnJoin: "ইনভাইট দিয়ে যোগ",
    btnPassword: "পাসওয়ার্ড",
    modeLoginSub: "আপনার অ্যাকাউন্টে প্রবেশ করুন",
    modeCreateSub: "নতুন পরিবার তৈরি করে Owner হোন",
    modeJoinSub: "কোড দিয়ে পরিবারে যোগ দিন",
    modePasswordSub: "পাসওয়ার্ড রিসেট করুন",
    lblEmail: "ইমেইল",
    lblPassword: "পাসওয়ার্ড",
    lblName: "পূর্ণ নাম",
    lblPhone: "ফোন (ঐচ্ছিক)",
    lblFamilyName: "পরিবারের নাম",
    lblCurrency: "মুদ্রা (Currency)",
    lblTimezone: "টাইমজোন",
    lblResponsible: "পরিবারে আপনার পরিচয়",
    lblInviteCode: "ইনভাইট কোড",
    lblRelation: "আপনার সম্পর্ক",
    lblSerial: "ক্রম (ঐচ্ছিক)",
    show: "দেখুন",
    hide: "লুকান",
    remember: "এই ডিভাইস মনে রাখুন",
    forgot: "পাসওয়ার্ড ভুলে গেছেন?",
    btnLoginSubmit: "লগইন",
    rateNote: "নিরাপত্তার জন্য প্রতি মিনিটে সর্বোচ্চ ৫ বার চেষ্টা করা যাবে",
    resetInfo: "আপনার ইমেইলে একটি পাসওয়ার্ড রিসেট লিংক পাঠানো হবে (মেয়াদ ৩০ মিনিট)।",
    btnSendReset: "রিসেট লিংক পাঠান",
    resetFormTitle: "নতুন পাসওয়ার্ড সেট করুন",
    resetFormInfo:
      "লিংক শুধু অ্যাপ খোলে না — এখানে নতুন পাসওয়ার্ড লিখে সেভ করুন। তারপর Login এ সেই নতুন পাসওয়ার্ড দিন।",
    lblNewPassword: "নতুন পাসওয়ার্ড",
    lblConfirmPassword: "পাসওয়ার্ড নিশ্চিত করুন",
    btnSaveNewPassword: "নতুন পাসওয়ার্ড সেভ করুন",
    resetTokenPaste: "আমার কাছে রিসেট টোকেন আছে",
    lblResetToken: "রিসেট টোকেন (ইমেইল থেকে)",
    passwordMismatch: "দুই পাসওয়ার্ড মিলছে না",
    resetDone: "পাসওয়ার্ড বদলেছে — এখন নতুন পাসওয়ার্ড দিয়ে Login করুন",
    backToLogin: "← লগইনে ফিরুন",
    or: "অথবা",
    noAccount: "কোনো অ্যাকাউন্ট নেই? পরিবার তৈরি করুন অথবা ইনভাইট কোড দিয়ে যোগ দিন",
    stepAccFam: "Account + Family",
    stepAccInvite: "Account + Invite",
    back: "← পিছনে",
    createTitle: "নতুন পরিবার তৈরি করুন",
    createSub: "শুরু করতে আপনার প্রোফাইল সেট করুন",
    bcryptNote: "",
    responsibleHint: "",
    ownerWarn: "",
    btnCreateSubmit: "পরিবার তৈরি করুন ও Owner হোন",
    joinTitle: "ইনভাইট কোড দিয়ে যোগ দিন",
    joinSub: "শুরু করতে আপনার প্রোফাইল সেট করুন",
    codeHint: "কোড ঠিক যেভাবে দেওয়া হয়েছে সেভাবে লিখুন। মেয়াদোত্তীর্ণ কোড গ্রহণ করা হবে না।",
    btnSendJoin: "Join Request পাঠান",
    signupTitle: "অ্যাকাউন্ট তৈরি",
    signupSub: "শুরু করতে আপনার প্রোফাইল সেট করুন",
    tabJoin: "বিদ্যমান পরিবারে যোগ",
    tabJoinSub: "ইনভাইট কোড দিয়ে",
    tabCreate: "নতুন পরিবার",
    tabCreateSub: "Owner হিসেবে তৈরি",
    colAccount: "অ্যাকাউন্টের তথ্য",
    colFamily: "পরিবারের তথ্য",
    colJoin: "ইনভাইট ও সম্পর্ক",
    lblNote: "নোট",
    lblLinkedMember: "লিংকড সদস্য ID",
    mobileApiTitle: "মোবাইল অ্যাপ",
    mobileApiHint:
      "লাইভ সার্ভার: https://app.s4businessthinking.com/api/v1 — সাধারণত আলাদা সেটিং লাগে না। সমস্যা হলে নিচে Server settings চেক করুন।",
    mobileApiBlocked:
      "Server settings-এ API URL দিন: https://app.s4businessthinking.com/api/v1",
    cloudCreateSub: "",
    cloudLoginSub: "Firebase অ্যাকাউন্ট দিয়ে লগইন — PC বা backend লাগবে না",
    cloudLoginPageSub: "Firebase ক্লাউড — লগইন করুন বা পরিবার তৈরি করুন",
    cloudNewUser: "নতুন ব্যবহারকারী?",
    cloudGoogleSignIn: "Google দিয়ে সাইন ইন",
    cloudFirstHint:
      "ফোন/APK-তে সরাসরি অ্যাকাউন্ট তৈরি করুন বা লগইন করুন। ডেটা Firebase-এ সংরক্ষিত থাকবে।",
    stAccount: "Account",
    stFamily: "Family/Invite",
    stApproval: "Approval",
  },
  en: {
    logoSub: "Full Architecture v2.1 · Family Finance Platform",
    title: "S4 FAMILY FINANCE 143",
    subtitle: "Family finance — login, create a family, or join with invite",
    modeLabel: "What do you want to do?",
    btnLogin: "Login",
    btnCreate: "Create family",
    btnJoin: "Join invite",
    btnPassword: "Password",
    modeLoginSub: "Sign in to your account",
    modeCreateSub: "Create a new family and become Owner",
    modeJoinSub: "Join a family using a code",
    modePasswordSub: "Reset your password",
    lblEmail: "Email",
    lblPassword: "Password",
    lblName: "Full name",
    lblPhone: "Phone (optional)",
    lblFamilyName: "Family name",
    lblCurrency: "Currency",
    lblTimezone: "Timezone",
    lblResponsible: "Your identity in the family",
    lblInviteCode: "Invite code",
    lblRelation: "Your relationship",
    lblSerial: "Serial (optional)",
    show: "Show",
    hide: "Hide",
    remember: "Remember this device",
    forgot: "Forgot password?",
    btnLoginSubmit: "Login",
    rateNote: "For security, max 5 attempts allowed per minute",
    resetInfo: "A password reset link will be sent to your email (valid 30 minutes).",
    btnSendReset: "Send reset link",
    resetFormTitle: "Set a new password",
    resetFormInfo:
      "Opening the app is not enough — enter and save a NEW password here, then Login with that new password.",
    lblNewPassword: "New password",
    lblConfirmPassword: "Confirm password",
    btnSaveNewPassword: "Save new password",
    resetTokenPaste: "I have a reset token",
    lblResetToken: "Reset token (from email)",
    passwordMismatch: "Passwords do not match",
    resetDone: "Password updated — Login with your new password",
    backToLogin: "← Back to login",
    or: "or",
    noAccount: "Don't have an account? Create a family or join with an invite code",
    stepAccFam: "Account + Family",
    stepAccInvite: "Account + Invite",
    back: "← Back",
    createTitle: "Create a new family",
    createSub: "Set up your profile to get started",
    bcryptNote: "",
    responsibleHint: "",
    ownerWarn: "",
    btnCreateSubmit: "Create family & become Owner",
    joinTitle: "Join with invite code",
    joinSub: "Set up your profile to get started",
    codeHint: "Enter the code exactly as given. Expired codes will be rejected.",
    btnSendJoin: "Send join request",
    signupTitle: "Create Account",
    signupSub: "Set up your profile to get started",
    tabJoin: "Join Existing Family",
    tabJoinSub: "With invite code",
    tabCreate: "Create New Family",
    tabCreateSub: "Become Owner",
    colAccount: "Account details",
    colFamily: "Family details",
    colJoin: "Invite & relationship",
    lblNote: "Note",
    lblLinkedMember: "Linked member ID",
    mobileApiTitle: "Mobile app",
    mobileApiHint:
      "Live server: https://app.s4businessthinking.com/api/v1 — usually no extra setup. If login fails, check Server settings below.",
    mobileApiBlocked:
      "Set API URL in Server settings: https://app.s4businessthinking.com/api/v1",
    cloudCreateSub: "",
    cloudLoginSub: "Sign in with Firebase — no PC or backend needed",
    cloudLoginPageSub: "Cloud sign in or create your family",
    cloudNewUser: "New here?",
    cloudGoogleSignIn: "Sign in with Google",
    cloudFirstHint:
      "On phone/APK, create an account or sign in directly. Your data is stored in Firebase.",
    stAccount: "Account",
    stFamily: "Family/Invite",
    stApproval: "Approval",
  },
};

const MODE_META = {
  login: { ico: "🔑", key: "btnLogin" },
  createFamily: { ico: "👑", key: "btnCreate" },
  join: { ico: "🔗", key: "btnJoin" },
  forgot: { ico: "🔓", key: "btnPassword" },
  resetPassword: { ico: "🔓", key: "btnPassword" },
  verifyOtp: { ico: "🔢", key: "btnLogin" },
};

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}

function readPasswordResetParams() {
  try {
    const url = new URL(window.location.href);
    const fromSearch = url.searchParams;
    let fromHash = new URLSearchParams();
    if (url.hash.includes("?")) {
      fromHash = new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1));
    }
    const pick = (key) =>
      String(fromSearch.get(key) || fromHash.get(key) || "").trim();
    return {
      token: pick("reset_token") || pick("token"),
      oobCode: pick("oobCode"),
      mode: pick("mode"),
    };
  } catch {
    return { token: "", oobCode: "", mode: "" };
  }
}

function clearPasswordResetParams() {
  try {
    const url = new URL(window.location.href);
    ["reset_token", "token", "oobCode", "mode", "apiKey", "lang", "continueUrl"].forEach((key) => {
      url.searchParams.delete(key);
    });
    if (url.hash.includes("?")) {
      url.hash = url.hash.split("?")[0];
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", next || "/");
  } catch {
    /* ignore */
  }
}

function StepIndicator({ active, labels }) {
  const steps = [
    { key: "account", label: labels.stAccount },
    { key: "family", label: labels.stFamily },
    { key: "approval", label: labels.stApproval },
  ];
  const activeIdx = active === "family" ? 1 : active === "approval" ? 2 : 0;
  return (
    <div className="step-indicator">
      <div className="step-pills">
        {steps.map((s, i) => (
          <div
            key={s.key}
            className={`step-pill${i < activeIdx ? " completed" : ""}${i === activeIdx ? " active" : ""}`}
          >
            <span className="num">{i + 1}</span>
            {s.label}
          </div>
        ))}
      </div>
      <div className="step-dots">
        {steps.map((s, i) => (
          <span key={s.key} className={i === activeIdx ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}

function LoginCardBrand({ subtitle }) {
  return (
    <div className="login-card-brand">
      <img className="login-card-logo" src={BRAND_LOGO_SRC} alt="S4 Family Finance 143" />
      {subtitle ? <p className="brand-subtitle">{subtitle}</p> : null}
    </div>
  );
}

function MobileApiBanner({ nativeApp, useCloudAuth, labels, apiBase }) {
  if (!nativeApp || useCloudAuth) return null;
  // Hide noisy LAN/PC banner when talking to the live production API.
  if (isProductionApi(apiBase) && !isLocalhostApi(apiBase)) return null;
  return (
    <div className="warn-box" style={{ marginBottom: 14 }}>
      <strong>{labels.mobileApiTitle}</strong>
      <div style={{ marginTop: 6 }}>{labels.mobileApiHint}</div>
    </div>
  );
}

function ServerSettingsBlock({
  useCloudAuth,
  showAdvancedServer,
  setShowAdvancedServer,
  authLoading,
  lang,
  apiBaseDraft,
  setApiBaseDraft,
  saveApiBase,
}) {
  if (useCloudAuth) return null;
  return (
    <div className="advanced-block">
      <button
        type="button"
        className="link advanced-toggle"
        disabled={authLoading}
        onClick={() => setShowAdvancedServer((v) => !v)}
      >
        {showAdvancedServer
          ? lang === "bn"
            ? "সার্ভার সেটিংস লুকান"
            : "Hide server settings"
          : lang === "bn"
            ? "সার্ভার সেটিংস (উন্নত)"
            : "Server settings (advanced)"}
      </button>
      {showAdvancedServer ? (
        <div className="field">
          <label>{lang === "bn" ? "API URL (সার্ভার)" : "API URL (server)"}</label>
          <div className="input-wrap">
            <span className="input-icon">🌐</span>
            <input
              type="url"
              placeholder="https://app.s4businessthinking.com/api/v1"
              value={apiBaseDraft}
              disabled={authLoading}
              onChange={(e) => setApiBaseDraft(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="link"
            style={{ marginTop: 6 }}
            disabled={authLoading}
            onClick={saveApiBase}
          >
            {lang === "bn" ? "API URL সংরক্ষণ" : "Save API URL"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Architecture auth gate:
 * Register/Login → Create Family (Owner) OR Join with Invite (relationship) → Approve later.
 * UI ported from project-root login.html.
 */
export function FamilyAuthGate({
  t,
  _digits,
  appLanguage,
  lockedLanguages,
  languageLabels,
  onChangeLanguage,
  authLoading,
  setAuthLoading,
  status,
  setStatus,
  setMessage,
  apiBase,
  onApiBaseChange,
  onAuthenticated,
}) {
  const lang = appLanguage === "en" ? "en" : "bn";
  const L = UI[lang] || UI.en;
  // Firebase client removed — always VPS/API auth.
  const useCloudAuth = false;
  const [view, setView] = useState("login"); // login | createFamily | join | forgot | resetPassword | verifyOtp
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [ownerRelation, setOwnerRelation] = useState("Husband");
  const [currency, setCurrency] = useState("BDT");
  const [timezone, setTimezone] = useState("Asia/Dhaka");
  const [inviteCode, setInviteCode] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loginMethod, setLoginMethod] = useState("password");
  const [pendingAfterVerify, setPendingAfterVerify] = useState(null);
  const [otpHint, setOtpHint] = useState("");
  const [joinRelation, setJoinRelation] = useState("Wife");
  const [relationshipSerial, setRelationshipSerial] = useState("");
  const [serialLabel, setSerialLabel] = useState("");
  const [relationshipNote, setRelationshipNote] = useState("");
  const [linkedMemberId, setLinkedMemberId] = useState("");
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase || "");
  const [showAdvancedServer, setShowAdvancedServer] = useState(false);
  const nativeApp = isNativeApp();
  const menuRef = useRef(null);
  const TIMEZONE_PRESETS = ["Asia/Dhaka", "Asia/Dubai", "Asia/Kolkata", "UTC"];
  const CURRENCY_PRESETS = [
    { value: "BDT", label: "BDT — বাংলাদেশি টাকা" },
    { value: "AED", label: "AED — UAE Dirham" },
    { value: "USD", label: "USD — US Dollar" },
    { value: "INR", label: "INR — Indian Rupee" },
    { value: "SAR", label: "SAR — Saudi Riyal" },
  ];

  const mode = MODE_META[view] || MODE_META.login;
  const pwScore = passwordStrength(password);

  useEffect(() => {
    function onDocClick(e) {
      if (!menuRef.current?.contains(e.target)) setModeMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function parseJson(res) {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  function apiError(data, fallback = "Request failed") {
    if (!data || typeof data !== "object") return fallback;
    if (typeof data.detail === "string") return data.detail;
    if (typeof data.detail === "object" && data.detail?.password_errors) {
      return data.detail.password_errors.join(" · ");
    }
    if (typeof data.error === "object" && data.error?.message) return String(data.error.message);
    if (typeof data.message === "string") return data.message;
    return fallback;
  }

  async function ensureSession() {
    let loginRes = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    let loginData = await parseJson(loginRes);

    if (loginRes.ok) {
      return {
        access: loginData.access_token || loginData.data?.access_token,
        refresh: loginData.refresh_token || loginData.data?.refresh_token || "",
      };
    }

    const loginDetail = apiError(loginData, "");
    if (String(loginDetail).toLowerCase().includes("verification")) {
      setPendingAfterVerify(view === "join" ? "join" : "createFamily");
      setView("verifyOtp");
      setOtpHint(lang === "bn" ? "আগে OTP দিয়ে অ্যাকাউন্ট ভেরিফাই করুন" : "Verify your account with OTP first");
      return { needsOtp: true };
    }

    if (!fullName.trim()) {
      throw new Error(apiError(loginData, t("emailPasswordRequired")));
    }
    if (!phone.trim()) {
      throw new Error(lang === "bn" ? "মোবাইল নম্বর প্রয়োজন (*)" : "Phone number is required (*)");
    }

    const regRes = await fetch(`${apiBase}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
      }),
    });
    const regData = await parseJson(regRes);
    if (regRes.status === 201 && (regData.verification_required || Array.isArray(regData.delivered_via))) {
      const via = Array.isArray(regData.delivered_via) ? regData.delivered_via.join(", ") : "";
      setOtpHint(
        lang === "bn"
          ? `৬-অঙ্কের OTP পাঠানো হয়েছে${via ? ` (${via})` : ""} — ইমেইল ও মোবাইল চেক করুন`
          : `6-digit OTP sent${via ? ` via ${via}` : ""} — check email and mobile`,
      );
      setPendingAfterVerify(view === "join" ? "join" : "createFamily");
      setView("verifyOtp");
      setOtpCode("");
      return { needsOtp: true };
    }
    if (!regRes.ok && regRes.status !== 409) {
      throw new Error(apiError(regData, "Register failed"));
    }

    loginRes = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    loginData = await parseJson(loginRes);
    if (!loginRes.ok) {
      const detail = apiError(loginData, "Login failed");
      if (String(detail).toLowerCase().includes("verification")) {
        setPendingAfterVerify(view === "join" ? "join" : "createFamily");
        setView("verifyOtp");
        return { needsOtp: true };
      }
      throw new Error(detail);
    }

    return {
      access: loginData.access_token || loginData.data?.access_token,
      refresh: loginData.refresh_token || loginData.data?.refresh_token || "",
    };
  }

  async function completeFamilyAfterAuth(access, refresh) {
    if (pendingAfterVerify === "join") {
      const body = buildJoinInvitePayload({
        invite_code: inviteCode.trim().toUpperCase(),
        relationship_type: joinRelation,
        relationship_serial: relationshipSerial,
        serial_label: serialLabel,
        linked_member_id: linkedMemberId,
        relationship_note: relationshipNote,
      });
      const res = await fetch(`${apiBase}/invites/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify(body),
      });
      const data = await parseJson(res);
      if (!res.ok) throw new Error(apiError(data, t("joinFailedGate")));
      onAuthenticated(access, refresh);
      setMessage(t("joinRequestedGate"), "success");
      setPendingAfterVerify(null);
      setView("login");
      return;
    }

    if (pendingAfterVerify === "createFamily" || familyName.trim()) {
      const res = await fetch(`${apiBase}/families`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify({
          name: familyName.trim(),
          default_currency: currency.trim() || "BDT",
          timezone: timezone.trim() || "Asia/Dhaka",
          relationship_type: ownerRelation,
        }),
      });
      const data = await parseJson(res);
      if (!res.ok) throw new Error(apiError(data, t("familyCreateFailed")));
      onAuthenticated(access, refresh);
      setMessage(t("familyCreatedGate"), "success");
      setPendingAfterVerify(null);
      setView("login");
      return;
    }

    onAuthenticated(access, refresh);
    setMessage(t("loginSuccessful"), "success");
    setPendingAfterVerify(null);
    setView("login");
  }

  async function handleVerifyOtp(e) {
    e?.preventDefault?.();
    if (!email.trim() || !otpCode.trim()) {
      setMessage(lang === "bn" ? "ইমেইল ও OTP দিন" : "Enter email and OTP", "error");
      return;
    }
    setAuthLoading(true);
    setStatus(lang === "bn" ? "OTP যাচাই হচ্ছে…" : "Verifying OTP…");
    try {
      const useLoginOtp = pendingAfterVerify === "login";
      const res = await fetch(`${apiBase}${useLoginOtp ? "/auth/login/verify-otp" : "/auth/verify-otp"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), otp: otpCode.trim() }),
      });
      const data = await parseJson(res);
      if (!res.ok) throw new Error(apiError(data, "OTP verify failed"));
      const access = data.access_token || data.data?.access_token;
      const refresh = data.refresh_token || data.data?.refresh_token || "";
      if (!access) throw new Error("OTP verify failed — no token");
      if (pendingAfterVerify === "createFamily" || pendingAfterVerify === "join") {
        await completeFamilyAfterAuth(access, refresh);
      } else {
        onAuthenticated(access, refresh);
        setMessage(t("loginSuccessful"), "success");
        setPendingAfterVerify(null);
        setView("login");
      }
      setOtpCode("");
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleResendOtp() {
    if (!email.trim()) return;
    setAuthLoading(true);
    try {
      const useLogin = pendingAfterVerify === "login";
      const res = await fetch(`${apiBase}${useLogin ? "/auth/login/request-otp" : "/auth/resend-otp"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await parseJson(res);
      if (!res.ok) throw new Error(apiError(data, "Resend failed"));
      const via = Array.isArray(data.delivered_via) ? data.delivered_via.join(", ") : "";
      setMessage(
        lang === "bn" ? `OTP আবার পাঠানো হয়েছে${via ? ` (${via})` : ""}` : `OTP resent${via ? ` via ${via}` : ""}`,
        "success",
      );
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLoginOtpRequest(e) {
    e?.preventDefault?.();
    if (!email.trim()) {
      setMessage(t("emailPasswordRequired"), "error");
      return;
    }
    setAuthLoading(true);
    setStatus(lang === "bn" ? "OTP পাঠানো হচ্ছে…" : "Sending OTP…");
    try {
      const res = await fetch(`${apiBase}/auth/login/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await parseJson(res);
      if (!res.ok) throw new Error(apiError(data, "OTP request failed"));
      setPendingAfterVerify("login");
      setView("verifyOtp");
      setOtpCode("");
      const via = Array.isArray(data.delivered_via) ? data.delivered_via.join(", ") : "";
      setOtpHint(
        lang === "bn"
          ? `লগইন OTP পাঠানো হয়েছে${via ? ` (${via})` : ""}`
          : `Login OTP sent${via ? ` via ${via}` : ""}`,
      );
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  function requireMobileApiBase() {
    if (useCloudAuth) return true;
    if (!nativeApp || !isLocalhostApi(apiBase)) return true;
    setMessage(L.mobileApiBlocked, "error");
    setShowAdvancedServer(true);
    return false;
  }

  async function handleLogin(e) {
    e?.preventDefault?.();
    if (!email.trim() || !password) {
      setMessage(t("emailPasswordRequired"), "error");
      return;
    }
    if (!requireMobileApiBase()) return;
    setAuthLoading(true);
    setStatus(t("signingIn"));
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await parseJson(res);
      if (!res.ok) throw new Error(apiError(data, "Login failed"));
      const access = data.access_token || data.data?.access_token;
      const refresh = data.refresh_token || data.data?.refresh_token || "";
      if (!access) throw new Error("Login failed — no access token");
      if (remember) {
        try {
          localStorage.setItem("s4_remember_email", email.trim());
        } catch {
          /* ignore */
        }
      }
      onAuthenticated(access, refresh);
      setMessage(t("loginSuccessful"), "success");
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateFamily(e) {
    e?.preventDefault?.();
    if (!fullName.trim() || !email.trim() || !password || !phone.trim() || !familyName.trim()) {
      const missing = !phone.trim()
        ? lang === "bn"
          ? "মোবাইল নম্বর (*) দিন — তারপর নিচের Create বাটনে ট্যাপ করুন।"
          : "Enter phone number (*), then tap Create at the bottom."
        : t("familyGateFieldsRequired");
      setMessage(missing, "error");
      try {
        document.querySelector(".s4-login-shell--signup .form-actions")?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      } catch {
        /* ignore */
      }
      return;
    }
    if (!requireMobileApiBase()) return;
    setAuthLoading(true);
    setStatus(t("creatingFamilyGate"));
    try {
      const session = await ensureSession();
      if (session?.needsOtp) {
        setStatus("");
        setMessage(
          lang === "bn" ? "OTP পাঠানো হয়েছে — কোড দিন" : "OTP sent — enter the code",
          "success",
        );
        return;
      }
      const res = await fetch(`${apiBase}/families`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access}`,
        },
        body: JSON.stringify({
          name: familyName.trim(),
          default_currency: currency.trim() || "BDT",
          timezone: timezone.trim() || "Asia/Dhaka",
          relationship_type: ownerRelation,
        }),
      });
      const data = await parseJson(res);
      if (!res.ok) {
        throw new Error(apiError(data, t("familyCreateFailed")));
      }
      onAuthenticated(session.access, session.refresh);
      setMessage(t("familyCreatedGate"), "success");
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleJoinFamily(e) {
    e?.preventDefault?.();
    if (!fullName.trim() || !email.trim() || !password || !phone.trim() || !inviteCode.trim()) {
      setMessage(t("joinGateFieldsRequired"), "error");
      return;
    }
    if (!requireMobileApiBase()) return;
    setAuthLoading(true);
    setStatus(t("joiningFamilyGate"));
    try {
      const session = await ensureSession();
      if (session?.needsOtp) {
        setStatus("");
        setMessage(
          lang === "bn" ? "OTP পাঠানো হয়েছে — কোড দিন" : "OTP sent — enter the code",
          "success",
        );
        return;
      }
      const body = buildJoinInvitePayload({
        invite_code: inviteCode.trim().toUpperCase(),
        relationship_type: joinRelation,
        relationship_serial: relationshipSerial,
        serial_label: serialLabel,
        linked_member_id: linkedMemberId,
        relationship_note: relationshipNote,
      });
      if (needsRelationshipNote(joinRelation) && !relationshipNote.trim()) {
        setMessage(t("relationshipNoteRequired") || "Relationship note required", "error");
        setAuthLoading(false);
        return;
      }
      if (needsLinkedMember(joinRelation) && !linkedMemberId.trim()) {
        setMessage(t("linkedMemberRequired") || "Linked member id required for in-law", "error");
        setAuthLoading(false);
        return;
      }

      const res = await fetch(`${apiBase}/invites/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access}`,
        },
        body: JSON.stringify(body),
      });
      const data = await parseJson(res);
      if (!res.ok) {
        throw new Error(apiError(data, t("joinFailedGate")));
      }
      onAuthenticated(session.access, session.refresh);
      setMessage(t("joinRequestedGate"), "success");
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleForgot(e) {
    e?.preventDefault?.();
    if (!email.trim()) {
      setMessage(t("emailRequiredPasswordReset"), "error");
      return;
    }
    setAuthLoading(true);
    setStatus(t("sendingReset"));
    try {
      const res = await fetch(`${apiBase}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await parseJson(res);
      if (!res.ok) throw new Error(apiError(data, "Reset failed"));
      // Dev/staging may return the token in the JSON body.
      const inlineToken = String(data.reset_token || data.data?.reset_token || "").trim();
      if (inlineToken) {
        setResetToken(inlineToken);
        setView("resetPassword");
        setMessage(
          lang === "bn"
            ? "টোকেন পাওয়া গেছে — নিচে নতুন পাসওয়ার্ড সেট করুন (ইমেইলও চেক করুন)।"
            : "Token ready — set a new password below (also check email).",
          "success",
        );
      } else {
        setMessage(
          lang === "bn"
            ? "রিসেট লিংক ইমেইলে পাঠানো হয়েছে। লিংকে ক্লিক করলে নতুন পাসওয়ার্ড সেট করার ফর্ম খুলবে।"
            : "Reset link sent. Click it to open the form where you set a new password.",
          "success",
        );
        setView("login");
      }
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e?.preventDefault?.();
    if (!password || password.length < 8) {
      setMessage(t("emailPasswordRequired") || "Password required (min 8)", "error");
      return;
    }
    if (password !== confirmPassword) {
      setMessage(L.passwordMismatch, "error");
      return;
    }
    setAuthLoading(true);
    setStatus(lang === "bn" ? "পাসওয়ার্ড সেভ হচ্ছে…" : "Saving password…");
    try {
      {
        const token = String(resetToken || "").trim();
        if (!token) {
          throw new Error(
            lang === "bn"
              ? "রিসেট টোকেন নেই — ইমেইলের লিংক খুলুন অথবা টোকেন পেস্ট করুন।"
              : "Missing reset token — open the email link or paste the token.",
          );
        }
        const res = await fetch(`${apiBase}/auth/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, new_password: password }),
        });
        const data = await parseJson(res);
        if (!res.ok) throw new Error(apiError(data, "Reset failed"));
      }
      clearPasswordResetParams();
      setResetToken("");
      setPassword("");
      setConfirmPassword("");
      setView("login");
      setMessage(L.resetDone, "success");
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang, apiBase), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  function setMode(next) {
    setView(next);
    setModeMenuOpen(false);
    setShowPassword(false);
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem("s4_remember_email");
      if (saved) setEmail(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const params = readPasswordResetParams();
    if (params.token) {
      setResetToken(params.token);
      setView("resetPassword");
      setMessage(
        lang === "bn"
          ? "রিসেট লিংক পাওয়া গেছে — নতুন পাসওয়ার্ড সেট করুন।"
          : "Reset link detected — set your new password.",
        "success",
      );
    }
    // Only on mount — URL may include one-time token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setApiBaseDraft(apiBase || "");
  }, [apiBase]);

  function saveApiBase() {
    const next = normalizeApiBase(apiBaseDraft);
    if (!next) {
      setMessage(lang === "bn" ? "API URL প্রয়োজন" : "API URL required", "error");
      return;
    }
    try {
      const host = new URL(next).hostname.toLowerCase();
      if (/s4businessthir/i.test(host) && !/s4businessthinking\.com$/i.test(host)) {
        setMessage(
          lang === "bn"
            ? "API URL অসম্পূর্ণ। লিখুন: https://app.s4businessthinking.com/api/v1"
            : "API URL incomplete. Use: https://app.s4businessthinking.com/api/v1",
          "error",
        );
        return;
      }
    } catch {
      setMessage(lang === "bn" ? "API URL সঠিক নয়" : "Invalid API URL", "error");
      return;
    }
    try {
      localStorage.setItem("s4_api_base", next);
    } catch {
      /* ignore */
    }
    onApiBaseChange?.(next);
    setMessage(lang === "bn" ? "API URL সংরক্ষিত" : "API URL saved", "success");
  }

  const stepActive = view === "createFamily" || view === "join" ? "family" : "account";

  return (
    <div className={`s4-login-shell${authLoading ? " is-busy" : ""}${view === "createFamily" || view === "join" ? " s4-login-shell--signup" : ""}`}>
      <div className="shell">
        <div className="formside">
          <div className="stagearea">
            {view === "login" || view === "forgot" || view === "resetPassword" || view === "verifyOtp" ? (
              <div className="card">
                <div className="top-row">
                  <select
                    className="lang-select"
                    value={appLanguage}
                    disabled={authLoading}
                    aria-label={t("languageLock")}
                    onChange={(e) => onChangeLanguage(e.target.value)}
                  >
                    {lockedLanguages.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.nativeName || languageLabels[language.code] || language.code}
                      </option>
                    ))}
                  </select>
                </div>

                <LoginCardBrand subtitle={useCloudAuth ? L.cloudLoginPageSub : L.subtitle} />
                <MobileApiBanner nativeApp={nativeApp} useCloudAuth={useCloudAuth} labels={L} apiBase={apiBase} />

                <ServerSettingsBlock
                  useCloudAuth={useCloudAuth}
                  showAdvancedServer={showAdvancedServer}
                  setShowAdvancedServer={setShowAdvancedServer}
                  authLoading={authLoading}
                  lang={lang}
                  apiBaseDraft={apiBaseDraft}
                  setApiBaseDraft={setApiBaseDraft}
                  saveApiBase={saveApiBase}
                />

                {!useCloudAuth && view !== "login" && view !== "forgot" && view !== "resetPassword" ? (
                <div className="mode-select-wrap" ref={menuRef}>
                  <span className="mode-select-label">{L.modeLabel}</span>
                  <button
                    type="button"
                    className={`mode-trigger${modeMenuOpen ? " open" : ""}`}
                    disabled={authLoading}
                    onClick={() => setModeMenuOpen((v) => !v)}
                  >
                    <div className="mode-trigger-left">
                      <span className="mode-trigger-ico">{mode.ico}</span>
                      <span className="mode-trigger-text">{L[mode.key]}</span>
                    </div>
                    <span className="mode-trigger-caret">▾</span>
                  </button>
                  <div className={`mode-menu${modeMenuOpen ? " open" : ""}`}>
                    {[
                      ["login", "🔑", "btnLogin", "modeLoginSub"],
                      ["createFamily", "👑", "btnCreate", "modeCreateSub"],
                      ["join", "🔗", "btnJoin", "modeJoinSub"],
                      ["forgot", "🔓", "btnPassword", "modePasswordSub"],
                    ].map(([id, ico, labelKey, subKey]) => (
                      <button
                        key={id}
                        type="button"
                        className={`mode-opt${view === id ? " sel" : ""}`}
                        onClick={() => setMode(id)}
                      >
                        <span className="mode-opt-ico">{ico}</span>
                        <div>
                          <div className="mode-opt-text">{L[labelKey]}</div>
                          <div className="mode-opt-sub">{L[subKey]}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                ) : null}

                {view === "login" ? (
                  <form onSubmit={loginMethod === "otp" ? handleLoginOtpRequest : handleLogin}>
                    <div className="row-between" style={{ marginBottom: 12 }}>
                      <button
                        type="button"
                        className={`link${loginMethod === "password" ? "" : ""}`}
                        disabled={authLoading}
                        onClick={() => setLoginMethod("password")}
                        style={{ fontWeight: loginMethod === "password" ? 700 : 400 }}
                      >
                        {lang === "bn" ? "পাসওয়ার্ড" : "Password"}
                      </button>
                      <button
                        type="button"
                        className="link"
                        disabled={authLoading}
                        onClick={() => setLoginMethod("otp")}
                        style={{ fontWeight: loginMethod === "otp" ? 700 : 400 }}
                      >
                        OTP
                      </button>
                    </div>
                    <div className="field">
                      <label>{L.lblEmail} *</label>
                      <div className="input-wrap">
                        <span className="input-icon">✉️</span>
                        <input
                          type="email"
                          placeholder="owner@s4family.com"
                          value={email}
                          disabled={authLoading}
                          autoComplete="username"
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    {loginMethod === "password" ? (
                      <div className="field">
                        <label>{L.lblPassword} *</label>
                        <div className="input-wrap">
                          <span className="input-icon">🔒</span>
                          <input
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••••••"
                            value={password}
                            disabled={authLoading}
                            autoComplete="current-password"
                            onChange={(e) => setPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="toggle-eye"
                            disabled={authLoading}
                            onClick={() => setShowPassword((v) => !v)}
                          >
                            {showPassword ? L.hide : L.show}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="info-box">
                        {lang === "bn"
                          ? "OTP ইমেইল ও WhatsApp/SMS-এ যাবে (৬ সংখ্যা)।"
                          : "OTP goes to email and WhatsApp/SMS (6 digits)."}
                      </div>
                    )}
                    <div className="row-between">
                      <label className="remember">
                        <input
                          type="checkbox"
                          checked={remember}
                          disabled={authLoading}
                          onChange={(e) => setRemember(e.target.checked)}
                        />
                        <span>{L.remember}</span>
                      </label>
                      <button type="button" className="link" disabled={authLoading} onClick={() => setMode("forgot")}>
                        {L.forgot}
                      </button>
                    </div>
                    <button type="submit" className="btn-primary" disabled={authLoading}>
                      {authLoading
                        ? t("signingIn")
                        : loginMethod === "otp"
                          ? lang === "bn"
                            ? "OTP পাঠান"
                            : "Send OTP"
                          : L.btnLoginSubmit}
                    </button>
                    <div className="rate-note">{L.rateNote}</div>
                  </form>
                ) : view === "verifyOtp" ? (
                  <>
                    <div className="info-box">
                      {otpHint ||
                        (lang === "bn"
                          ? "ইমেইল ও মোবাইলে পাঠানো ৬-অঙ্কের OTP দিন। ভেরিফাই ছাড়া লগইন হবে না।"
                          : "Enter the 6-digit OTP sent to email and mobile. No login without verification.")}
                    </div>
                    <form onSubmit={handleVerifyOtp}>
                      <div className="field">
                        <label>{L.lblEmail} *</label>
                        <div className="input-wrap">
                          <span className="input-icon">✉️</span>
                          <input type="email" value={email} disabled={authLoading} onChange={(e) => setEmail(e.target.value)} required />
                        </div>
                      </div>
                      <div className="field">
                        <label>OTP *</label>
                        <div className="input-wrap">
                          <span className="input-icon">🔢</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            placeholder="••••••"
                            value={otpCode}
                            disabled={authLoading}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            required
                          />
                        </div>
                      </div>
                      <button type="submit" className="btn-primary" disabled={authLoading}>
                        {authLoading
                          ? lang === "bn"
                            ? "যাচাই হচ্ছে…"
                            : "Verifying…"
                          : lang === "bn"
                            ? "OTP নিশ্চিত করুন"
                            : "Confirm OTP"}
                      </button>
                      <div className="footer-note" style={{ marginTop: 12 }}>
                        <button type="button" className="link" disabled={authLoading} onClick={handleResendOtp}>
                          {lang === "bn" ? "OTP আবার পাঠান" : "Resend OTP"}
                        </button>
                        {" · "}
                        <button
                          type="button"
                          className="link"
                          disabled={authLoading}
                          onClick={() => {
                            setView(pendingAfterVerify === "join" ? "join" : pendingAfterVerify === "createFamily" ? "createFamily" : "login");
                            setOtpCode("");
                          }}
                        >
                          {L.backToLogin}
                        </button>
                      </div>
                    </form>
                  </>
                ) : view === "resetPassword" ? (
                  <>
                    <div className="card-title" style={{ marginBottom: 8 }}>
                      {L.resetFormTitle}
                    </div>
                    <div className="info-box">{L.resetFormInfo}</div>
                    <form onSubmit={handleResetPassword}>
                      {true ? (
                        <div className="field">
                          <label>{L.lblResetToken}</label>
                          <div className="input-wrap">
                            <span className="input-icon">🔑</span>
                            <input
                              type="text"
                              autoComplete="one-time-code"
                              placeholder="paste token from email"
                              value={resetToken}
                              disabled={authLoading}
                              onChange={(e) => setResetToken(e.target.value.trim())}
                              required
                            />
                          </div>
                        </div>
                      ) : null}
                      <div className="field">
                        <label>{L.lblNewPassword}</label>
                        <div className="input-wrap">
                          <span className="input-icon">🔒</span>
                          <input
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            value={password}
                            disabled={authLoading}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                          />
                          <button
                            type="button"
                            className="toggle-eye"
                            disabled={authLoading}
                            onClick={() => setShowPassword((v) => !v)}
                          >
                            {showPassword ? L.hide : L.show}
                          </button>
                        </div>
                        <div className={`pw-meter s${pwScore}`}>
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
                      <div className="field">
                        <label>{L.lblConfirmPassword}</label>
                        <div className="input-wrap">
                          <span className="input-icon">🔒</span>
                          <input
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            value={confirmPassword}
                            disabled={authLoading}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            minLength={8}
                          />
                        </div>
                      </div>
                      <button type="submit" className="btn-primary" disabled={authLoading}>
                        {authLoading
                          ? lang === "bn"
                            ? "সেভ হচ্ছে…"
                            : "Saving…"
                          : L.btnSaveNewPassword}
                      </button>
                    </form>
                    <div className="footer-note">
                      <button
                        type="button"
                        className="link"
                        disabled={authLoading}
                        onClick={() => {
                          clearPasswordResetParams();
                          setResetToken("");
                          setPassword("");
                          setConfirmPassword("");
                          setMode("login");
                        }}
                      >
                        {L.backToLogin}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="info-box">{L.resetInfo}</div>
                    <form onSubmit={handleForgot}>
                      <div className="field">
                        <label>{L.lblEmail}</label>
                        <div className="input-wrap">
                          <span className="input-icon">✉️</span>
                          <input
                            type="email"
                            placeholder="owner@s4family.com"
                            value={email}
                            disabled={authLoading}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <button type="submit" className="btn-primary" disabled={authLoading}>
                        {authLoading ? t("sendingReset") : L.btnSendReset}
                      </button>
                    </form>
                    <div className="footer-note">
                      {!useCloudAuth ? (
                        <>
                          <button
                            type="button"
                            className="link"
                            disabled={authLoading}
                            onClick={() => {
                              setPassword("");
                              setConfirmPassword("");
                              setMode("resetPassword");
                            }}
                          >
                            {L.resetTokenPaste}
                          </button>
                          {" · "}
                        </>
                      ) : null}
                      <button type="button" className="link" disabled={authLoading} onClick={() => setMode("login")}>
                        {L.backToLogin}
                      </button>
                    </div>
                  </>
                )}

                {view === "login" ? (
                  <div className="cloud-footer">
                    {useCloudAuth ? L.cloudNewUser : L.noAccount}{" "}
                    <button type="button" className="link" disabled={authLoading} onClick={() => setMode("createFamily")}>
                      {L.btnCreate}
                    </button>
                    {" · "}
                    <button type="button" className="link" disabled={authLoading} onClick={() => setMode("join")}>
                      {L.btnJoin}
                    </button>
                  </div>
                ) : null}

                {view !== "login" && view !== "forgot" && view !== "resetPassword" && view !== "verifyOtp" ? (
                <StepIndicator active={stepActive} labels={L} />
                ) : null}
                {status ? <p className="rate-note" style={{ marginTop: 12 }}>{status}</p> : null}
              </div>
            ) : null}

            {view === "createFamily" || view === "join" ? (
              <div className="card">
                <div className="top-row">
                  <select
                    className="lang-select"
                    value={appLanguage}
                    disabled={authLoading}
                    aria-label={t("languageLock")}
                    onChange={(e) => onChangeLanguage(e.target.value)}
                  >
                    {lockedLanguages.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.nativeName || languageLabels[language.code] || language.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="card-eyebrow">
                  <span>{view === "join" ? L.stepAccInvite : L.stepAccFam}</span>
                  <button type="button" className="back-btn" disabled={authLoading} onClick={() => setMode("login")}>
                    {L.back}
                  </button>
                </div>
                <div className="card-title">{L.signupTitle}</div>
                <div className="card-sub card-sub--compact">{L.signupSub}</div>

                <div className="account-path-tabs" role="tablist" aria-label={L.signupTitle}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === "join"}
                      className={`account-path-tab${view === "join" ? " active" : ""}`}
                      disabled={authLoading}
                      onClick={() => setMode("join")}
                    >
                      {L.tabJoin}
                      <span className="tab-sub">{L.tabJoinSub}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === "createFamily"}
                      className={`account-path-tab${view === "createFamily" ? " active" : ""}`}
                      disabled={authLoading}
                      onClick={() => setMode("createFamily")}
                    >
                      {L.tabCreate}
                      <span className="tab-sub">{L.tabCreateSub}</span>
                    </button>
                  </div>

                <MobileApiBanner nativeApp={nativeApp} useCloudAuth={useCloudAuth} labels={L} apiBase={apiBase} />

                <ServerSettingsBlock
                  useCloudAuth={useCloudAuth}
                  showAdvancedServer={showAdvancedServer}
                  setShowAdvancedServer={setShowAdvancedServer}
                  authLoading={authLoading}
                  lang={lang}
                  apiBaseDraft={apiBaseDraft}
                  setApiBaseDraft={setApiBaseDraft}
                  saveApiBase={saveApiBase}
                />

                {view === "createFamily" ? (
                  <form className="signup-form" onSubmit={handleCreateFamily}>
                    <div className="signup-grid">
                      <div className="signup-col">
                        <div className="signup-col-title">{L.colAccount}</div>
                        <div className="field">
                          <label>{L.lblName}</label>
                          <div className="input-wrap">
                            <span className="input-icon">👤</span>
                            <input
                              type="text"
                              value={fullName}
                              disabled={authLoading}
                              onChange={(e) => setFullName(e.target.value)}
                              required
                            />
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblEmail}</label>
                          <div className="input-wrap">
                            <span className="input-icon">✉️</span>
                            <input
                              type="email"
                              value={email}
                              disabled={authLoading}
                              onChange={(e) => setEmail(e.target.value)}
                              required
                            />
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblPhone} *</label>
                          <div className="input-wrap">
                            <span className="input-icon">📱</span>
                            <input type="tel" value={phone} disabled={authLoading} onChange={(e) => setPhone(e.target.value)} required />
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblPassword}</label>
                          <div className="input-wrap">
                            <span className="input-icon">🔒</span>
                            <input
                              type={showPassword ? "text" : "password"}
                              value={password}
                              disabled={authLoading}
                              autoComplete="new-password"
                              onChange={(e) => setPassword(e.target.value)}
                              required
                            />
                            <button
                              type="button"
                              className="toggle-eye"
                              disabled={authLoading}
                              onClick={() => setShowPassword((v) => !v)}
                            >
                              {showPassword ? L.hide : L.show}
                            </button>
                          </div>
                          <div className="pw-meter">
                            {[1, 2, 3, 4].map((n) => (
                              <i
                                key={n}
                                style={{
                                  background:
                                    pwScore >= n
                                      ? n <= 1
                                        ? "#EF4444"
                                        : n <= 2
                                          ? "#F59E0B"
                                          : n <= 3
                                            ? "#84CC16"
                                            : "#1D9E75"
                                      : undefined,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="signup-col">
                        <div className="signup-col-title">{L.colFamily}</div>
                        <div className="field">
                          <label>{L.lblFamilyName}</label>
                          <div className="input-wrap">
                            <span className="input-icon">🏠</span>
                            <input
                              type="text"
                              value={familyName}
                              disabled={authLoading}
                              onChange={(e) => setFamilyName(e.target.value)}
                              required
                            />
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblCurrency}</label>
                          <div className="input-wrap">
                            <span className="input-icon">৳</span>
                            <select
                              className="field-select"
                              value={currency}
                              disabled={authLoading}
                              onChange={(e) => setCurrency(e.target.value)}
                            >
                              {CURRENCY_PRESETS.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblTimezone}</label>
                          <div className="input-wrap">
                            <span className="input-icon">🌐</span>
                            <select
                              className="field-select"
                              value={timezone}
                              disabled={authLoading}
                              onChange={(e) => setTimezone(e.target.value)}
                            >
                              {TIMEZONE_PRESETS.map((tz) => (
                                <option key={tz} value={tz}>
                                  {tz}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblResponsible}</label>
                          <div className="pillrow">
                            {OWNER_RELATIONSHIPS.map((rel) => (
                              <button
                                key={rel}
                                type="button"
                                className={`pill${ownerRelation === rel ? " sel" : ""}`}
                                disabled={authLoading}
                                onClick={() => setOwnerRelation(rel)}
                              >
                                {relText(lang, rel)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="form-actions signup-submit-bar">
                      <button type="submit" className="btn-primary" disabled={authLoading}>
                        {authLoading ? t("creatingFamilyGate") : L.btnCreateSubmit}
                      </button>
                      <p className="hint" style={{ marginTop: 8, textAlign: "center" }}>
                        {lang === "bn"
                          ? "সব ঘর পূরণ করে এই বাটনে ট্যাপ করুন (মোবাইল নম্বর আবশ্যক)।"
                          : "Fill all fields (phone required), then tap this button."}
                      </p>
                    </div>
                  </form>
                ) : (
                  <form className="signup-form" onSubmit={handleJoinFamily}>
                    <div className="signup-grid">
                      <div className="signup-col">
                        <div className="signup-col-title">{L.colAccount}</div>
                        <div className="field">
                          <label>{L.lblName}</label>
                          <div className="input-wrap">
                            <span className="input-icon">👤</span>
                            <input
                              type="text"
                              value={fullName}
                              disabled={authLoading}
                              onChange={(e) => setFullName(e.target.value)}
                              required
                            />
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblEmail}</label>
                          <div className="input-wrap">
                            <span className="input-icon">✉️</span>
                            <input
                              type="email"
                              value={email}
                              disabled={authLoading}
                              onChange={(e) => setEmail(e.target.value)}
                              required
                            />
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblPhone} *</label>
                          <div className="input-wrap">
                            <span className="input-icon">📱</span>
                            <input type="tel" value={phone} disabled={authLoading} onChange={(e) => setPhone(e.target.value)} required />
                          </div>
                        </div>
                        <div className="field">
                          <label>{L.lblPassword}</label>
                          <div className="input-wrap">
                            <span className="input-icon">🔒</span>
                            <input
                              type={showPassword ? "text" : "password"}
                              value={password}
                              disabled={authLoading}
                              autoComplete="new-password"
                              onChange={(e) => setPassword(e.target.value)}
                              required
                            />
                            <button
                              type="button"
                              className="toggle-eye"
                              disabled={authLoading}
                              onClick={() => setShowPassword((v) => !v)}
                            >
                              {showPassword ? L.hide : L.show}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="signup-col">
                        <div className="signup-col-title">{L.colJoin}</div>
                        <div className="field">
                          <label>{L.lblInviteCode}</label>
                          <div className="input-wrap">
                            <span className="input-icon">🔗</span>
                            <input
                              type="text"
                              placeholder="S4-XXXXXX"
                              value={inviteCode}
                              disabled={authLoading}
                              style={{ textTransform: "uppercase", letterSpacing: 2 }}
                              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                              required
                            />
                          </div>
                          <div className="hint">{L.codeHint}</div>
                        </div>
                        <div className="field">
                          <label>{L.lblRelation}</label>
                          <div className="pillrow">
                            {JOIN_RELATIONSHIPS.map((rel) => (
                              <button
                                key={rel}
                                type="button"
                                className={`pill${joinRelation === rel ? " sel" : ""}`}
                                disabled={authLoading}
                                onClick={() => {
                                  setJoinRelation(rel);
                                  setSerialLabel("");
                                  setRelationshipSerial("");
                                  setRelationshipNote("");
                                  setLinkedMemberId("");
                                }}
                              >
                                {relText(lang, rel)}
                              </button>
                            ))}
                          </div>
                        </div>
                        {needsSerial(joinRelation) ? (
                          <div className="field">
                            <label>{L.lblSerial}</label>
                            <div className="pillrow">
                              {serialLabelsFor(joinRelation).map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  className={`pill${serialLabel === label ? " sel" : ""}`}
                                  disabled={authLoading}
                                  onClick={() => setSerialLabel(label)}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <div className="input-wrap" style={{ marginTop: 8 }}>
                              <span className="input-icon">🔢</span>
                              <input
                                type="text"
                                value={relationshipSerial}
                                disabled={authLoading}
                                placeholder="Custom #"
                                onChange={(e) => setRelationshipSerial(e.target.value)}
                              />
                            </div>
                          </div>
                        ) : null}
                        {needsLinkedMember(joinRelation) ? (
                          <div className="field">
                            <label>{L.lblLinkedMember}</label>
                            <div className="input-wrap">
                              <span className="input-icon">🔗</span>
                              <input
                                type="text"
                                value={linkedMemberId}
                                disabled={authLoading}
                                onChange={(e) => setLinkedMemberId(e.target.value)}
                                required
                              />
                            </div>
                          </div>
                        ) : null}
                        {needsRelationshipNote(joinRelation) ? (
                          <div className="field">
                            <label>{L.lblNote}</label>
                            <div className="input-wrap">
                              <span className="input-icon">📝</span>
                              <input
                                type="text"
                                value={relationshipNote}
                                disabled={authLoading}
                                onChange={(e) => setRelationshipNote(e.target.value)}
                                required
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="form-actions">
                      <button type="submit" className="btn-primary" disabled={authLoading}>
                        {authLoading ? t("joiningFamilyGate") : L.btnSendJoin}
                      </button>
                    </div>
                  </form>
                )}

                <StepIndicator active={stepActive} labels={L} />
                {status ? <p className="rate-note" style={{ marginTop: 12 }}>{status}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
