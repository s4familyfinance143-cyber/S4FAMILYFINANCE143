import { useEffect, useMemo, useRef, useState } from "react";
import "./s4-login.css";
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
    stAccount: "Account",
    stFamily: "Family/Invite",
    stApproval: "Approval",
  },
};

const FLOWS = {
  login: {
    bn: {
      h1: "পরিবারের সব হিসাব, এক জায়গায় — নিরাপদে",
      p: "আয়-ব্যয়, বাজার লিস্ট, ঋণ, বাজেট আর সঞ্চয় — একসাথে পুরো পরিবার মিলে ব্যবস্থাপনা করুন।",
      label: "Authentication Flow",
      steps: [
        ["Login Request", 1],
        ["bcrypt verify", 0],
        ["JWT (15min)", 0],
        ["Family Dashboard", 0],
      ],
    },
    en: {
      h1: "All family accounts in one place — securely",
      p: "Income, expenses, grocery lists, loans, budgets and savings — managed together by the whole family.",
      label: "Authentication Flow",
      steps: [
        ["Login Request", 1],
        ["bcrypt verify", 0],
        ["JWT (15min)", 0],
        ["Family Dashboard", 0],
      ],
    },
  },
  createFamily: {
    bn: {
      h1: "একজন responsible person-ই Owner হবে",
      p: "Owner পুরো পরিবার, সদস্য, টাকা, রিপোর্ট, সেটিংস — সব নিয়ন্ত্রণ করতে পারবে।",
      label: "Family Creation Flow",
      steps: [
        ["User Register/Login", 1],
        ["Create Family", 1],
        ["Select Responsible Person", 1],
        ["Owner Role Auto Assign", 0],
        ["Default Accounts Seed", 0],
      ],
    },
    en: {
      h1: "One responsible person becomes Owner",
      p: "Owner controls family, members, money, reports and settings — with full audit trails.",
      label: "Family Creation Flow",
      steps: [
        ["User Register/Login", 1],
        ["Create Family", 1],
        ["Select Responsible Person", 1],
        ["Owner Role Auto Assign", 0],
        ["Default Accounts Seed", 0],
      ],
    },
  },
  join: {
    bn: {
      h1: "ইনভাইট কোড → Join Request → Approval",
      p: "কোড দেওয়ার পর status হবে PENDING। Owner/Admin approve করার আগ পর্যন্ত data দেখা যাবে না।",
      label: "Invite + Join Approval Flow",
      steps: [
        ["Owner generates code", 1],
        ["Member sends join request", 0],
        ["Owner/Admin approve", 0],
        ["Role + relationship", 0],
        ["Audit log", 0],
      ],
    },
    en: {
      h1: "Invite code → Join request → Approval",
      p: "After submitting, status is PENDING. No family data until Owner/Admin approves.",
      label: "Invite + Join Approval Flow",
      steps: [
        ["Owner generates code", 1],
        ["Member sends join request", 0],
        ["Owner/Admin approve", 0],
        ["Role + relationship", 0],
        ["Audit log", 0],
      ],
    },
  },
  forgot: {
    bn: {
      h1: "পাসওয়ার্ড নিরাপদে রিসেট করুন",
      p: "ইমেইলে রিসেট লিংক যাবে। লিংক সীমিত সময়ের জন্য বৈধ থাকবে।",
      label: "Password Reset Flow",
      steps: [
        ["Enter email", 1],
        ["Send reset link", 0],
        ["Open link", 0],
        ["Set new password", 0],
      ],
    },
    en: {
      h1: "Reset your password securely",
      p: "A reset link will be emailed. The link stays valid for a limited time.",
      label: "Password Reset Flow",
      steps: [
        ["Enter email", 1],
        ["Send reset link", 0],
        ["Open link", 0],
        ["Set new password", 0],
      ],
    },
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

/**
 * Architecture auth gate:
 * Register/Login → Create Family (Owner) OR Join with Invite (relationship) → Approve later.
 * UI ported from project-root login.html.
 */
export function FamilyAuthGate({
  t,
  digits,
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
  const menuRef = useRef(null);

  const flow = useMemo(() => FLOWS[view]?.[lang] || FLOWS.login[lang], [view, lang]);
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

  async function handleLogin(e) {
    e?.preventDefault?.();
    if (!email.trim() || !password) {
      setMessage(t("emailPasswordRequired"), "error");
      return;
    }
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
      setMessage(error.message || t("backendConnectionFailed"), "error");
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
      setMessage(error.message || t("backendConnectionFailed"), "error");
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
      setMessage(error.message || t("backendConnectionFailed"), "error");
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
      setMessage(error.message || t("backendConnectionFailed"), "error");
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
    const next = String(apiBaseDraft || "").trim().replace(/\/$/, "");
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
        <aside className="brand" aria-hidden={false}>
          <div className="brand-top">
            <div className="logo-title">⬡ S4-FAMILY</div>
            <div className="logo-sub">{L.logoSub}</div>
          </div>
          <div>
            <div className="brand-headline">
              <h1>{flow.h1}</h1>
              <p>{flow.p}</p>
            </div>
            <div className="flow-label">{flow.label}</div>
            <div className="flow">
              {flow.steps.map(([label, done], i) => {
                const isNow =
                  done === 1 && (i === flow.steps.length - 1 || flow.steps[i + 1]?.[1] === 0);
                return (
                  <div key={`${label}-${i}`}>
                    {i > 0 ? <div className="fline" /> : null}
                    <div className={`fstep${done ? " done" : ""}${isNow ? " now" : ""}`}>
                      <span className="dot" />
                      <span>{label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="brand-bottom">
            <div className="trust-row">
              <span className="chip">🔐 bcrypt + JWT</span>
              <span className="chip">🛡️ Rate Limit 5/min</span>
              <span className="chip">📱 Offline-first Sync</span>
              <span className="chip">👨‍👩‍👧‍👦 RBAC Roles</span>
            </div>
          </div>
        </aside>

        <div className="formside">
          <div className="stagearea">
            <div className="mobile-brand">⬡ S4-FAMILY</div>

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

                <div className="brand-title">{digits("S4 FAMILY FINANCE 143")}</div>
                <div className="brand-subtitle">{L.subtitle}</div>

                <div className="field">
                  <label>{lang === "bn" ? "API URL (LAN / backend)" : "API URL (LAN / backend)"}</label>
                  <div className="input-wrap">
                    <span className="input-icon">🌐</span>
                    <input
                      type="url"
                      placeholder="http://192.168.0.10:8000"
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
                  </>
                ) : null}

                <StepIndicator active={stepActive} labels={L} />
                {status ? <p className="rate-note" style={{ marginTop: 12 }}>{status}</p> : null}
              </div>
            ) : null}

            {view === "createFamily" ? (
              <div className="card">
                <div className="card-eyebrow">
                  <span>{L.stepAccFam}</span>
                  <button type="button" className="back-btn" disabled={authLoading} onClick={() => setMode("login")}>
                    {L.back}
                  </button>
                </div>
                <div className="card-title">{L.createTitle}</div>
                <div className="card-sub">{L.createSub}</div>

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
                        <option value="BDT">BDT — বাংলাদেশি টাকা</option>
                        <option value="USD">USD — US Dollar</option>
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label>{L.lblTimezone}</label>
                    <div className="input-wrap">
                      <span className="input-icon">🌐</span>
                      <input
                        type="text"
                        value={timezone}
                        disabled={authLoading}
                        onChange={(e) => setTimezone(e.target.value)}
                      />
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
