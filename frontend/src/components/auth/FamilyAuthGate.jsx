import { useEffect, useRef, useState } from "react";
import "./s4-login.css";
import { BRAND_LOGO_SRC } from "../../lib/brandAssets";
import { formatFetchError, isLocalhostApi, isNativeApp } from "../../lib/runtimeEnv";
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
    backToLogin: "← লগইনে ফিরুন",
    or: "অথবা",
    noAccount: "কোনো অ্যাকাউন্ট নেই? পরিবার তৈরি করুন অথবা ইনভাইট কোড দিয়ে যোগ দিন",
    stepAccFam: "Account + Family",
    stepAccInvite: "Account + Invite",
    back: "← পিছনে",
    createTitle: "নতুন পরিবার তৈরি করুন",
    createSub: "অ্যাকাউন্ট তৈরি হবে এবং আপনি এই পরিবারের Owner হবেন",
    bcryptNote: "bcrypt দিয়ে hash হয়ে সংরক্ষণ হবে",
    responsibleHint: "এটা শুধু পরিচয়/রিপোর্টিং-এর জন্য — নিরাপত্তা অনুমতি (role) থেকে আলাদা থাকবে",
    ownerWarn:
      "Owner Protection: Owner নিজেকে delete করতে পারবে না। Ownership transfer-এ second admin approval লাগবে।",
    btnCreateSubmit: "পরিবার তৈরি করুন ও Owner হোন",
    joinTitle: "ইনভাইট কোড দিয়ে যোগ দিন",
    joinSub: "অ্যাকাউন্ট তৈরি করুন ও পরিবারের কোড দিন",
    codeHint: "কোড ঠিক যেভাবে দেওয়া হয়েছে সেভাবে লিখুন। মেয়াদোত্তীর্ণ কোড গ্রহণ করা হবে না।",
    btnSendJoin: "Join Request পাঠান",
    mobileApiTitle: "ফোনে অ্যাকাউন্ট/পরিবার তৈরি",
    mobileApiHint:
      "PC-তে backend চালু রাখুন (start_dev.ps1)। নিচে Server settings-এ PC-র Wi‑Fi IP দিন — যেমন http://192.168.1.5:8000 (127.0.0.1 ফোনে কাজ করে না)।",
    mobileApiBlocked:
      "আগে Server settings-এ PC-র API URL সেট করুন (127.0.0.1 ফোনে কাজ করে না)।",
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
    backToLogin: "← Back to login",
    or: "or",
    noAccount: "Don't have an account? Create a family or join with an invite code",
    stepAccFam: "Account + Family",
    stepAccInvite: "Account + Invite",
    back: "← Back",
    createTitle: "Create a new family",
    createSub: "An account will be created and you'll become the family Owner",
    bcryptNote: "Will be stored hashed with bcrypt",
    responsibleHint: "This is only for identity/reporting — kept separate from security permission (role)",
    ownerWarn:
      "Owner Protection: Owner cannot delete themselves. Ownership transfer requires second admin approval.",
    btnCreateSubmit: "Create family & become Owner",
    joinTitle: "Join with invite code",
    joinSub: "Create your account and enter the family code",
    codeHint: "Enter the code exactly as given. Expired codes will be rejected.",
    btnSendJoin: "Send join request",
    mobileApiTitle: "Create account/family on phone",
    mobileApiHint:
      "Keep backend running on your PC (start_dev.ps1). In Server settings below, set your PC Wi‑Fi IP — e.g. http://192.168.1.5:8000 (127.0.0.1 does not work on phone).",
    mobileApiBlocked:
      "Set your PC API URL in Server settings first (127.0.0.1 does not work on phone).",
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
};

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
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
  firebaseConfigured = false,
  firebaseFirstMode = false,
  onFirebaseGoogleSignIn,
  onCloudOnlySignIn,
}) {
  const lang = appLanguage === "en" ? "en" : "bn";
  const L = UI[lang];
  const [view, setView] = useState("login"); // login | createFamily | join | forgot
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [ownerRelation, setOwnerRelation] = useState("Husband");
  const [currency, setCurrency] = useState("BDT");
  const [timezone, setTimezone] = useState("Asia/Dhaka");
  const [inviteCode, setInviteCode] = useState("");
  const [joinRelation, setJoinRelation] = useState("Wife");
  const [relationshipSerial, setRelationshipSerial] = useState("");
  const [serialLabel, setSerialLabel] = useState("");
  const [relationshipNote, setRelationshipNote] = useState("");
  const [linkedMemberId, setLinkedMemberId] = useState("");
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase || "");
  const [showAdvancedServer, setShowAdvancedServer] = useState(() => isNativeApp());
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

    if (!loginRes.ok) {
      if (!fullName.trim()) {
        throw new Error(apiError(loginData, t("emailPasswordRequired")));
      }
      const regRes = await fetch(`${apiBase}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          password,
        }),
      });
      const regData = await parseJson(regRes);
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
        throw new Error(apiError(loginData, "Login failed"));
      }
    }

    return {
      access: loginData.access_token || loginData.data?.access_token,
      refresh: loginData.refresh_token || loginData.data?.refresh_token || "",
    };
  }

  function requireMobileApiBase() {
    if (!nativeApp || !isLocalhostApi(apiBase)) return true;
    setMessage(L.mobileApiBlocked, "error");
    setShowAdvancedServer(true);
    return false;
  }

  function MobileApiBanner() {
    if (!nativeApp) return null;
    return (
      <div className="warn-box" style={{ marginBottom: 14 }}>
        <strong>{L.mobileApiTitle}</strong>
        <div style={{ marginTop: 6 }}>{L.mobileApiHint}</div>
      </div>
    );
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
      setMessage(formatFetchError(error, lang), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateFamily(e) {
    e?.preventDefault?.();
    if (!fullName.trim() || !email.trim() || !password || !familyName.trim()) {
      setMessage(t("familyGateFieldsRequired"), "error");
      return;
    }
    if (!requireMobileApiBase()) return;
    setAuthLoading(true);
    setStatus(t("creatingFamilyGate"));
    try {
      const session = await ensureSession();
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
      setMessage(formatFetchError(error, lang), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleJoinFamily(e) {
    e?.preventDefault?.();
    if (!email.trim() || !password || !inviteCode.trim()) {
      setMessage(t("joinGateFieldsRequired"), "error");
      return;
    }
    if (!requireMobileApiBase()) return;
    setAuthLoading(true);
    setStatus(t("joiningFamilyGate"));
    try {
      const session = await ensureSession();
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
      setMessage(formatFetchError(error, lang), "error");
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
      setMessage(t("forgotSent"), "success");
      setView("login");
      setStatus("");
    } catch (error) {
      setMessage(formatFetchError(error, lang), "error");
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
    setApiBaseDraft(apiBase || "");
  }, [apiBase]);

  function saveApiBase() {
    const next = normalizeApiBase(apiBaseDraft);
    if (!next) {
      setMessage(lang === "bn" ? "API URL প্রয়োজন" : "API URL required", "error");
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
    <div className={`s4-login-shell${authLoading ? " is-busy" : ""}`}>
      <div className="shell">
        <div className="formside">
          <div className="stagearea">
            {view === "login" || view === "forgot" ? (
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

                <LoginCardBrand subtitle={L.subtitle} />
                <MobileApiBanner />

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
                      <label>{lang === "bn" ? "API URL (LAN / backend)" : "API URL (LAN / backend)"}</label>
                      <div className="input-wrap">
                        <span className="input-icon">🌐</span>
                        <input
                          type="url"
                          placeholder="http://127.0.0.1:8000"
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

                {view === "login" ? (
                  <form onSubmit={handleLogin}>
                    <div className="field">
                      <label>{L.lblEmail}</label>
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
                    <div className="field">
                      <label>{L.lblPassword}</label>
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
                      {authLoading ? t("signingIn") : L.btnLoginSubmit}
                    </button>
                    <div className="rate-note">{L.rateNote}</div>
                  </form>
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
                      <button type="button" className="link" disabled={authLoading} onClick={() => setMode("login")}>
                        {L.backToLogin}
                      </button>
                    </div>
                  </>
                )}

                {view === "login" ? (
                  <>
                    <div className="divider">
                      <span>{L.or}</span>
                    </div>
                    <div className="footer-note">{L.noAccount}</div>
                    <div className="choice-row">
                      <button type="button" className="choice-mini" disabled={authLoading} onClick={() => setMode("createFamily")}>
                        {L.btnCreate}
                      </button>
                      <button type="button" className="choice-mini" disabled={authLoading} onClick={() => setMode("join")}>
                        {L.btnJoin}
                      </button>
                    </div>
                    {firebaseConfigured ? (
                      <>
                        <div className="divider">
                          <span>{L.or}</span>
                        </div>
                        {firebaseFirstMode ? (
                          <>
                            <div className="info-box">
                              {lang === "bn"
                                ? "Backend ছাড়াই Firebase থেকে ডেটা দেখুন (read-only cache)।"
                                : "View data from Firebase without a local backend (read-only cache)."}
                            </div>
                            <button
                              type="button"
                              className="btn-primary"
                              style={{ marginTop: 8 }}
                              disabled={authLoading}
                              onClick={() => onCloudOnlySignIn?.()}
                            >
                              {lang === "bn" ? "☁ Firebase-only মোড" : "☁ Firebase-only mode"}
                            </button>
                          </>
                        ) : (
                          <div className="info-box">
                            {lang === "bn"
                              ? "লগইনের পর Settings → Cloud থেকে Firebase/Google দিয়ে অনলাইন ব্যাকআপ চালু করুন।"
                              : "After login, open Settings → Cloud to enable Firebase/Google online backup."}
                          </div>
                        )}
                        {!firebaseFirstMode ? (
                          <button
                            type="button"
                            className="btn-primary"
                            style={{ marginTop: 8 }}
                            disabled={authLoading}
                            onClick={() => onFirebaseGoogleSignIn?.()}
                          >
                            {lang === "bn" ? "Google দিয়ে Cloud অ্যাকাউন্ট" : "Cloud account with Google"}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}

                <StepIndicator active={stepActive} labels={L} />
                {status ? <p className="rate-note" style={{ marginTop: 12 }}>{status}</p> : null}
              </div>
            ) : null}

            {view === "createFamily" ? (
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
                  <span>{L.stepAccFam}</span>
                  <button type="button" className="back-btn" disabled={authLoading} onClick={() => setMode("login")}>
                    {L.back}
                  </button>
                </div>
                <div className="card-title">{L.createTitle}</div>
                <div className="card-sub">{L.createSub}</div>
                <MobileApiBanner />

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
                      <label>API URL</label>
                      <div className="input-wrap">
                        <span className="input-icon">🌐</span>
                        <input
                          type="url"
                          placeholder="http://127.0.0.1:8000"
                          value={apiBaseDraft}
                          disabled={authLoading}
                          onChange={(e) => setApiBaseDraft(e.target.value)}
                        />
                      </div>
                      <button type="button" className="link" style={{ marginTop: 6 }} disabled={authLoading} onClick={saveApiBase}>
                        {lang === "bn" ? "API URL সংরক্ষণ" : "Save API URL"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <form onSubmit={handleCreateFamily}>
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
                    <label>{L.lblPhone}</label>
                    <div className="input-wrap">
                      <span className="input-icon">📱</span>
                      <input type="tel" value={phone} disabled={authLoading} onChange={(e) => setPhone(e.target.value)} />
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
                    <div className="pw-meter-label">{L.bcryptNote}</div>
                  </div>
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
                    <div className="hint">
                      {lang === "bn"
                        ? "Asia/Dhaka = বাংলাদেশ, Asia/Dubai = সংযুক্ত আরব আমিরাত — তৈরির সময় বেছে নিন"
                        : "Asia/Dhaka = Bangladesh, Asia/Dubai = UAE — pick when creating the family"}
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
                    <div className="hint">{L.responsibleHint}</div>
                  </div>
                  <div className="warn-box">{L.ownerWarn}</div>
                  <button type="submit" className="btn-primary" disabled={authLoading}>
                    {authLoading ? t("creatingFamilyGate") : L.btnCreateSubmit}
                  </button>
                </form>
                <StepIndicator active={stepActive} labels={L} />
                {status ? <p className="rate-note" style={{ marginTop: 12 }}>{status}</p> : null}
              </div>
            ) : null}

            {view === "join" ? (
              <div className="card">
                <div className="card-eyebrow">
                  <span>{L.stepAccInvite}</span>
                  <button type="button" className="back-btn" disabled={authLoading} onClick={() => setMode("login")}>
                    {L.back}
                  </button>
                </div>
                <div className="card-title">{L.joinTitle}</div>
                <div className="card-sub">{L.joinSub}</div>
                <MobileApiBanner />

                <form onSubmit={handleJoinFamily}>
                  <div className="field">
                    <label>{L.lblName}</label>
                    <div className="input-wrap">
                      <span className="input-icon">👤</span>
                      <input
                        type="text"
                        value={fullName}
                        disabled={authLoading}
                        onChange={(e) => setFullName(e.target.value)}
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
                    <label>{L.lblPhone}</label>
                    <div className="input-wrap">
                      <span className="input-icon">📱</span>
                      <input type="tel" value={phone} disabled={authLoading} onChange={(e) => setPhone(e.target.value)} />
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
                  <div className="field">
                    <label>{L.lblInviteCode}</label>
                    <div className="input-wrap">
                      <span className="input-icon">🔗</span>
                      <input
                        type="text"
                        placeholder="S4F-XXXX"
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
                      <label>Linked member ID</label>
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
                      <label>Note</label>
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
                  <button type="submit" className="btn-primary" disabled={authLoading}>
                    {authLoading ? t("joiningFamilyGate") : L.btnSendJoin}
                  </button>
                </form>
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
