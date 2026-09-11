import type { Lang } from "@/lib/i18n";

export type AuthCopy = {
  // shared
  showPw: string;
  hidePw: string;
  passwordHint: string;
  emailLabel: string;
  passwordLabel: string;
  // register
  regTitle: string;
  regSub: string;
  regFullName: string;
  regOrg: string;
  regSubmit: string;
  regSubmitting: string;
  regHaveAccount: string;
  regLoginLink: string;
  regSentTitle: string;
  regSentSub: string;
  // verify
  verTitle: string;
  verSub: string;
  verCode: string;
  verSubmit: string;
  verSubmitting: string;
  verResend: string;
  verResent: string;
  verNeedEmail: string;
  // login
  logTitle: string;
  logSub: string;
  logSubmit: string;
  logSubmitting: string;
  logForgot: string;
  logNoAccount: string;
  logRegister: string;
  logNotVerified: string;
  logVerifyLink: string;
  // forgot
  fgTitle: string;
  fgSub: string;
  fgSubmit: string;
  fgSubmitting: string;
  fgSent: string;
  fgBack: string;
  // reset
  rsTitle: string;
  rsSub: string;
  rsCode: string;
  rsNewPw: string;
  rsSubmit: string;
  rsSubmitting: string;
  // account
  acTitle: string;
  acLoading: string;
  acNotLogged: string;
  acGoLogin: string;
  acVerified: string;
  acProfile: string;
  acFullName: string;
  acOrg: string;
  acCountry: string;
  acPhone: string;
  acSave: string;
  acSaving: string;
  acSaved: string;
  acSessions: string;
  acCurrent: string;
  acRevoke: string;
  acChangePw: string;
  acCurrentPw: string;
  acNewPw: string;
  acChangeBtn: string;
  acChanging: string;
  acChanged: string;
  acLogout: string;
};

export const authCopy: Record<Lang, AuthCopy> = {
  en: {
    showPw: "Show password",
    hidePw: "Hide password",
    passwordHint: "At least 8 characters, with letters and numbers.",
    emailLabel: "Email",
    passwordLabel: "Password",
    regTitle: "Create your account",
    regSub: "Register to manage licenses, downloads and support.",
    regFullName: "Full name",
    regOrg: "Company / family name (optional)",
    regSubmit: "Create account",
    regSubmitting: "Creating...",
    regHaveAccount: "Already have an account?",
    regLoginLink: "Log in",
    regSentTitle: "Check your email",
    regSentSub: "We sent a 6-digit verification code to your email.",
    verTitle: "Verify your email",
    verSub: "Enter the 6-digit code we sent to your email.",
    verCode: "Verification code",
    verSubmit: "Verify",
    verSubmitting: "Verifying...",
    verResend: "Resend code",
    verResent: "A new code has been sent.",
    verNeedEmail: "Enter your email to receive a code.",
    logTitle: "Customer Login",
    logSub: "Access your licenses, downloads and support.",
    logSubmit: "Login",
    logSubmitting: "Signing in...",
    logForgot: "Forgot password?",
    logNoAccount: "Don't have an account?",
    logRegister: "Register",
    logNotVerified: "Email not verified yet.",
    logVerifyLink: "Verify now",
    fgTitle: "Forgot password",
    fgSub: "Enter your email and we'll send a reset code.",
    fgSubmit: "Send reset code",
    fgSubmitting: "Sending...",
    fgSent: "If the account exists, a reset code has been sent.",
    fgBack: "Back to login",
    rsTitle: "Reset password",
    rsSub: "Enter the code and your new password.",
    rsCode: "Reset code",
    rsNewPw: "New password",
    rsSubmit: "Update password",
    rsSubmitting: "Updating...",
    acTitle: "My Account",
    acLoading: "Loading...",
    acNotLogged: "You are not logged in.",
    acGoLogin: "Go to login",
    acVerified: "Verified",
    acProfile: "Profile",
    acFullName: "Full name",
    acOrg: "Company / family name",
    acCountry: "Country",
    acPhone: "Phone",
    acSave: "Save profile",
    acSaving: "Saving...",
    acSaved: "Profile saved.",
    acSessions: "Active sessions",
    acCurrent: "This device",
    acRevoke: "Revoke",
    acChangePw: "Change password",
    acCurrentPw: "Current password",
    acNewPw: "New password",
    acChangeBtn: "Change password",
    acChanging: "Changing...",
    acChanged: "Password changed.",
    acLogout: "Logout",
  },
  bn: {
    showPw: "পাসওয়ার্ড দেখান",
    hidePw: "পাসওয়ার্ড লুকান",
    passwordHint: "কমপক্ষে ৮ অক্ষর, অক্ষর ও সংখ্যা মিলিয়ে।",
    emailLabel: "ইমেইল",
    passwordLabel: "পাসওয়ার্ড",
    regTitle: "অ্যাকাউন্ট তৈরি করুন",
    regSub: "লাইসেন্স, ডাউনলোড ও সাপোর্ট পরিচালনায় রেজিস্টার করুন।",
    regFullName: "পুরো নাম",
    regOrg: "কোম্পানি / পরিবারের নাম (ঐচ্ছিক)",
    regSubmit: "অ্যাকাউন্ট তৈরি করুন",
    regSubmitting: "তৈরি হচ্ছে...",
    regHaveAccount: "আগে থেকেই অ্যাকাউন্ট আছে?",
    regLoginLink: "লগইন করুন",
    regSentTitle: "ইমেইল দেখুন",
    regSentSub: "আপনার ইমেইলে একটি ৬-সংখ্যার ভেরিফিকেশন কোড পাঠানো হয়েছে।",
    verTitle: "ইমেইল ভেরিফাই করুন",
    verSub: "আপনার ইমেইলে পাঠানো ৬-সংখ্যার কোডটি দিন।",
    verCode: "ভেরিফিকেশন কোড",
    verSubmit: "ভেরিফাই",
    verSubmitting: "ভেরিফাই হচ্ছে...",
    verResend: "কোড আবার পাঠান",
    verResent: "নতুন কোড পাঠানো হয়েছে।",
    verNeedEmail: "কোড পেতে আপনার ইমেইল দিন।",
    logTitle: "কাস্টমার লগইন",
    logSub: "আপনার লাইসেন্স, ডাউনলোড ও সাপোর্ট অ্যাক্সেস করুন।",
    logSubmit: "লগইন",
    logSubmitting: "সাইন ইন হচ্ছে...",
    logForgot: "পাসওয়ার্ড ভুলে গেছেন?",
    logNoAccount: "অ্যাকাউন্ট নেই?",
    logRegister: "রেজিস্টার",
    logNotVerified: "ইমেইল এখনো ভেরিফাই হয়নি।",
    logVerifyLink: "এখন ভেরিফাই করুন",
    fgTitle: "পাসওয়ার্ড ভুলে গেছেন",
    fgSub: "আপনার ইমেইল দিন, আমরা রিসেট কোড পাঠাবো।",
    fgSubmit: "রিসেট কোড পাঠান",
    fgSubmitting: "পাঠানো হচ্ছে...",
    fgSent: "অ্যাকাউন্ট থাকলে একটি রিসেট কোড পাঠানো হয়েছে।",
    fgBack: "লগইনে ফিরে যান",
    rsTitle: "পাসওয়ার্ড রিসেট",
    rsSub: "কোড ও নতুন পাসওয়ার্ড দিন।",
    rsCode: "রিসেট কোড",
    rsNewPw: "নতুন পাসওয়ার্ড",
    rsSubmit: "পাসওয়ার্ড আপডেট করুন",
    rsSubmitting: "আপডেট হচ্ছে...",
    acTitle: "আমার অ্যাকাউন্ট",
    acLoading: "লোড হচ্ছে...",
    acNotLogged: "আপনি লগইন করা নেই।",
    acGoLogin: "লগইনে যান",
    acVerified: "ভেরিফাইড",
    acProfile: "প্রোফাইল",
    acFullName: "পুরো নাম",
    acOrg: "কোম্পানি / পরিবারের নাম",
    acCountry: "দেশ",
    acPhone: "ফোন",
    acSave: "প্রোফাইল সংরক্ষণ",
    acSaving: "সংরক্ষণ হচ্ছে...",
    acSaved: "প্রোফাইল সংরক্ষিত হয়েছে।",
    acSessions: "সক্রিয় সেশন",
    acCurrent: "এই ডিভাইস",
    acRevoke: "বাতিল করুন",
    acChangePw: "পাসওয়ার্ড পরিবর্তন",
    acCurrentPw: "বর্তমান পাসওয়ার্ড",
    acNewPw: "নতুন পাসওয়ার্ড",
    acChangeBtn: "পাসওয়ার্ড পরিবর্তন",
    acChanging: "পরিবর্তন হচ্ছে...",
    acChanged: "পাসওয়ার্ড পরিবর্তিত হয়েছে।",
    acLogout: "লগআউট",
  },
  hi: {
    showPw: "पासवर्ड दिखाएँ",
    hidePw: "पासवर्ड छिपाएँ",
    passwordHint: "कम से कम 8 अक्षर, अक्षर और संख्या के साथ।",
    emailLabel: "ईमेल",
    passwordLabel: "पासवर्ड",
    regTitle: "अपना खाता बनाएँ",
    regSub: "लाइसेंस, डाउनलोड और सपोर्ट प्रबंधित करने के लिए रजिस्टर करें।",
    regFullName: "पूरा नाम",
    regOrg: "कंपनी / परिवार का नाम (वैकल्पिक)",
    regSubmit: "खाता बनाएँ",
    regSubmitting: "बना रहे हैं...",
    regHaveAccount: "पहले से खाता है?",
    regLoginLink: "लॉगिन करें",
    regSentTitle: "अपना ईमेल देखें",
    regSentSub: "हमने आपके ईमेल पर 6 अंकों का सत्यापन कोड भेजा है।",
    verTitle: "अपना ईमेल सत्यापित करें",
    verSub: "आपके ईमेल पर भेजा गया 6 अंकों का कोड दर्ज करें।",
    verCode: "सत्यापन कोड",
    verSubmit: "सत्यापित करें",
    verSubmitting: "सत्यापित हो रहा है...",
    verResend: "कोड फिर से भेजें",
    verResent: "नया कोड भेज दिया गया है।",
    verNeedEmail: "कोड पाने के लिए अपना ईमेल दर्ज करें।",
    logTitle: "ग्राहक लॉगिन",
    logSub: "अपने लाइसेंस, डाउनलोड और सपोर्ट तक पहुँचें।",
    logSubmit: "लॉगिन",
    logSubmitting: "साइन इन हो रहा है...",
    logForgot: "पासवर्ड भूल गए?",
    logNoAccount: "खाता नहीं है?",
    logRegister: "रजिस्टर करें",
    logNotVerified: "ईमेल अभी सत्यापित नहीं है।",
    logVerifyLink: "अभी सत्यापित करें",
    fgTitle: "पासवर्ड भूल गए",
    fgSub: "अपना ईमेल दर्ज करें, हम रीसेट कोड भेजेंगे।",
    fgSubmit: "रीसेट कोड भेजें",
    fgSubmitting: "भेजा जा रहा है...",
    fgSent: "यदि खाता मौजूद है, तो रीसेट कोड भेज दिया गया है।",
    fgBack: "लॉगिन पर वापस जाएँ",
    rsTitle: "पासवर्ड रीसेट करें",
    rsSub: "कोड और अपना नया पासवर्ड दर्ज करें।",
    rsCode: "रीसेट कोड",
    rsNewPw: "नया पासवर्ड",
    rsSubmit: "पासवर्ड अपडेट करें",
    rsSubmitting: "अपडेट हो रहा है...",
    acTitle: "मेरा खाता",
    acLoading: "लोड हो रहा है...",
    acNotLogged: "आप लॉग इन नहीं हैं।",
    acGoLogin: "लॉगिन पर जाएँ",
    acVerified: "सत्यापित",
    acProfile: "प्रोफ़ाइल",
    acFullName: "पूरा नाम",
    acOrg: "कंपनी / परिवार का नाम",
    acCountry: "देश",
    acPhone: "फ़ोन",
    acSave: "प्रोफ़ाइल सहेजें",
    acSaving: "सहेजा जा रहा है...",
    acSaved: "प्रोफ़ाइल सहेजी गई।",
    acSessions: "सक्रिय सत्र",
    acCurrent: "यह डिवाइस",
    acRevoke: "रद्द करें",
    acChangePw: "पासवर्ड बदलें",
    acCurrentPw: "वर्तमान पासवर्ड",
    acNewPw: "नया पासवर्ड",
    acChangeBtn: "पासवर्ड बदलें",
    acChanging: "बदल रहा है...",
    acChanged: "पासवर्ड बदल दिया गया।",
    acLogout: "लॉगआउट",
  },
  ur: {
    showPw: "پاس ورڈ دکھائیں",
    hidePw: "پاس ورڈ چھپائیں",
    passwordHint: "کم از کم 8 حروف، حروف اور اعداد کے ساتھ۔",
    emailLabel: "ای میل",
    passwordLabel: "پاس ورڈ",
    regTitle: "اپنا اکاؤنٹ بنائیں",
    regSub: "لائسنس، ڈاؤن لوڈ اور سپورٹ کے انتظام کے لیے رجسٹر کریں۔",
    regFullName: "پورا نام",
    regOrg: "کمپنی / خاندان کا نام (اختیاری)",
    regSubmit: "اکاؤنٹ بنائیں",
    regSubmitting: "بن رہا ہے...",
    regHaveAccount: "پہلے سے اکاؤنٹ ہے؟",
    regLoginLink: "لاگ اِن کریں",
    regSentTitle: "اپنا ای میل دیکھیں",
    regSentSub: "ہم نے آپ کے ای میل پر 6 ہندسوں کا تصدیقی کوڈ بھیجا ہے۔",
    verTitle: "اپنا ای میل تصدیق کریں",
    verSub: "آپ کے ای میل پر بھیجا گیا 6 ہندسوں کا کوڈ درج کریں۔",
    verCode: "تصدیقی کوڈ",
    verSubmit: "تصدیق کریں",
    verSubmitting: "تصدیق ہو رہی ہے...",
    verResend: "کوڈ دوبارہ بھیجیں",
    verResent: "نیا کوڈ بھیج دیا گیا ہے۔",
    verNeedEmail: "کوڈ حاصل کرنے کے لیے اپنا ای میل درج کریں۔",
    logTitle: "کسٹمر لاگ اِن",
    logSub: "اپنے لائسنس، ڈاؤن لوڈ اور سپورٹ تک رسائی حاصل کریں۔",
    logSubmit: "لاگ اِن",
    logSubmitting: "سائن اِن ہو رہا ہے...",
    logForgot: "پاس ورڈ بھول گئے؟",
    logNoAccount: "اکاؤنٹ نہیں ہے؟",
    logRegister: "رجسٹر کریں",
    logNotVerified: "ای میل ابھی تصدیق شدہ نہیں۔",
    logVerifyLink: "ابھی تصدیق کریں",
    fgTitle: "پاس ورڈ بھول گئے",
    fgSub: "اپنا ای میل درج کریں، ہم ری سیٹ کوڈ بھیجیں گے۔",
    fgSubmit: "ری سیٹ کوڈ بھیجیں",
    fgSubmitting: "بھیجا جا رہا ہے...",
    fgSent: "اگر اکاؤنٹ موجود ہے تو ری سیٹ کوڈ بھیج دیا گیا ہے۔",
    fgBack: "لاگ اِن پر واپس جائیں",
    rsTitle: "پاس ورڈ ری سیٹ کریں",
    rsSub: "کوڈ اور اپنا نیا پاس ورڈ درج کریں۔",
    rsCode: "ری سیٹ کوڈ",
    rsNewPw: "نیا پاس ورڈ",
    rsSubmit: "پاس ورڈ اپ ڈیٹ کریں",
    rsSubmitting: "اپ ڈیٹ ہو رہا ہے...",
    acTitle: "میرا اکاؤنٹ",
    acLoading: "لوڈ ہو رہا ہے...",
    acNotLogged: "آپ لاگ اِن نہیں ہیں۔",
    acGoLogin: "لاگ اِن پر جائیں",
    acVerified: "تصدیق شدہ",
    acProfile: "پروفائل",
    acFullName: "پورا نام",
    acOrg: "کمپنی / خاندان کا نام",
    acCountry: "ملک",
    acPhone: "فون",
    acSave: "پروفائل محفوظ کریں",
    acSaving: "محفوظ ہو رہا ہے...",
    acSaved: "پروفائل محفوظ ہو گئی۔",
    acSessions: "فعال سیشنز",
    acCurrent: "یہ ڈیوائس",
    acRevoke: "منسوخ کریں",
    acChangePw: "پاس ورڈ تبدیل کریں",
    acCurrentPw: "موجودہ پاس ورڈ",
    acNewPw: "نیا پاس ورڈ",
    acChangeBtn: "پاس ورڈ تبدیل کریں",
    acChanging: "تبدیل ہو رہا ہے...",
    acChanged: "پاس ورڈ تبدیل ہو گیا۔",
    acLogout: "لاگ آؤٹ",
  },
  ar: {
    showPw: "إظهار كلمة المرور",
    hidePw: "إخفاء كلمة المرور",
    passwordHint: "8 أحرف على الأقل، مع حروف وأرقام.",
    emailLabel: "البريد الإلكتروني",
    passwordLabel: "كلمة المرور",
    regTitle: "أنشئ حسابك",
    regSub: "سجّل لإدارة التراخيص والتنزيلات والدعم.",
    regFullName: "الاسم الكامل",
    regOrg: "اسم الشركة / العائلة (اختياري)",
    regSubmit: "إنشاء حساب",
    regSubmitting: "جارٍ الإنشاء...",
    regHaveAccount: "لديك حساب بالفعل؟",
    regLoginLink: "تسجيل الدخول",
    regSentTitle: "تحقق من بريدك الإلكتروني",
    regSentSub: "أرسلنا رمز تحقق مكوّنًا من 6 أرقام إلى بريدك.",
    verTitle: "تحقق من بريدك الإلكتروني",
    verSub: "أدخل الرمز المكوّن من 6 أرقام المُرسَل إلى بريدك.",
    verCode: "رمز التحقق",
    verSubmit: "تحقق",
    verSubmitting: "جارٍ التحقق...",
    verResend: "إعادة إرسال الرمز",
    verResent: "تم إرسال رمز جديد.",
    verNeedEmail: "أدخل بريدك لتلقّي الرمز.",
    logTitle: "دخول العميل",
    logSub: "ادخل إلى تراخيصك وتنزيلاتك ودعمك.",
    logSubmit: "تسجيل الدخول",
    logSubmitting: "جارٍ تسجيل الدخول...",
    logForgot: "هل نسيت كلمة المرور؟",
    logNoAccount: "ليس لديك حساب؟",
    logRegister: "إنشاء حساب",
    logNotVerified: "لم يتم التحقق من البريد بعد.",
    logVerifyLink: "تحقق الآن",
    fgTitle: "نسيت كلمة المرور",
    fgSub: "أدخل بريدك وسنرسل رمز إعادة التعيين.",
    fgSubmit: "إرسال رمز إعادة التعيين",
    fgSubmitting: "جارٍ الإرسال...",
    fgSent: "إذا كان الحساب موجودًا، فقد تم إرسال رمز إعادة التعيين.",
    fgBack: "العودة إلى تسجيل الدخول",
    rsTitle: "إعادة تعيين كلمة المرور",
    rsSub: "أدخل الرمز وكلمة المرور الجديدة.",
    rsCode: "رمز إعادة التعيين",
    rsNewPw: "كلمة المرور الجديدة",
    rsSubmit: "تحديث كلمة المرور",
    rsSubmitting: "جارٍ التحديث...",
    acTitle: "حسابي",
    acLoading: "جارٍ التحميل...",
    acNotLogged: "أنت غير مسجّل الدخول.",
    acGoLogin: "اذهب إلى تسجيل الدخول",
    acVerified: "مُوثَّق",
    acProfile: "الملف الشخصي",
    acFullName: "الاسم الكامل",
    acOrg: "اسم الشركة / العائلة",
    acCountry: "الدولة",
    acPhone: "الهاتف",
    acSave: "حفظ الملف",
    acSaving: "جارٍ الحفظ...",
    acSaved: "تم حفظ الملف.",
    acSessions: "الجلسات النشطة",
    acCurrent: "هذا الجهاز",
    acRevoke: "إلغاء",
    acChangePw: "تغيير كلمة المرور",
    acCurrentPw: "كلمة المرور الحالية",
    acNewPw: "كلمة المرور الجديدة",
    acChangeBtn: "تغيير كلمة المرور",
    acChanging: "جارٍ التغيير...",
    acChanged: "تم تغيير كلمة المرور.",
    acLogout: "تسجيل الخروج",
  },
};
