// Adds settings.passkeys.* keys to every language bundle so the Profile
// passkey section is properly translated. Idempotent: re-running is a no-op.
const fs = require("node:fs");
const path = require("node:path");

const LOCALES = path.join(__dirname, "..", "src", "i18n", "locales");

// settings.passkeys.* per language. En deliberately matches the component
// fallback strings so nothing changes for existing users.
const KEYS = {
  en: {
    title: "Passkeys",
    description: "Sign in with your fingerprint, face or device PIN — no password needed.",
    add: "Add a passkey for this device",
    working: "Waiting for your device…",
    registered: "Passkey registered on this device",
    saved: "Passkey saved",
    savedDesc: "You can now sign in with this device's fingerprint, face or PIN.",
    failed: "Couldn't save passkey",
  },
  es: {
    title: "Passkeys",
    description: "Inicia sesión con tu huella, cara o PIN del dispositivo, sin contraseña.",
    add: "Añadir una passkey para este dispositivo",
    working: "Esperando tu dispositivo…",
    registered: "Passkey registrada en este dispositivo",
    saved: "Passkey guardada",
    savedDesc: "Ya puedes iniciar sesión con la huella, cara o PIN de este dispositivo.",
    failed: "No se pudo guardar la passkey",
  },
  fr: {
    title: "Passkeys",
    description: "Connectez-vous avec votre empreinte, votre visage ou le PIN de l'appareil, sans mot de passe.",
    add: "Ajouter une passkey pour cet appareil",
    working: "En attente de votre appareil…",
    registered: "Passkey enregistrée sur cet appareil",
    saved: "Passkey enregistrée",
    savedDesc: "Vous pouvez maintenant vous connecter avec l'empreinte, le visage ou le PIN de cet appareil.",
    failed: "Impossible d'enregistrer la passkey",
  },
  de: {
    title: "Passkeys",
    description: "Melde dich mit Fingerabdruck, Gesicht oder Geräte-PIN an — ohne Passwort.",
    add: "Passkey für dieses Gerät hinzufügen",
    working: "Warte auf dein Gerät…",
    registered: "Passkey auf diesem Gerät registriert",
    saved: "Passkey gespeichert",
    savedDesc: "Du kannst dich jetzt mit Fingerabdruck, Gesicht oder PIN dieses Geräts anmelden.",
    failed: "Passkey konnte nicht gespeichert werden",
  },
  pt: {
    title: "Passkeys",
    description: "Entre com sua digital, rosto ou PIN do dispositivo — sem senha.",
    add: "Adicionar uma passkey para este dispositivo",
    working: "Aguardando seu dispositivo…",
    registered: "Passkey registrada neste dispositivo",
    saved: "Passkey salva",
    savedDesc: "Agora você pode entrar com a digital, rosto ou PIN deste dispositivo.",
    failed: "Não foi possível salvar a passkey",
  },
  it: {
    title: "Passkeys",
    description: "Accedi con impronta, volto o PIN del dispositivo, senza password.",
    add: "Aggiungi una passkey per questo dispositivo",
    working: "In attesa del dispositivo…",
    registered: "Passkey registrata su questo dispositivo",
    saved: "Passkey salvata",
    savedDesc: "Ora puoi accedere con l'impronta, il volto o il PIN di questo dispositivo.",
    failed: "Impossibile salvare la passkey",
  },
  nl: {
    title: "Passkeys",
    description: "Log in met je vingerafdruk, gezicht of toestel-PIN — geen wachtwoord nodig.",
    add: "Voeg een passkey toe voor dit apparaat",
    working: "Wachten op je apparaat…",
    registered: "Passkey geregistreerd op dit apparaat",
    saved: "Passkey opgeslagen",
    savedDesc: "Je kunt nu inloggen met de vingerafdruk, het gezicht of de PIN van dit apparaat.",
    failed: "Kon de passkey niet opslaan",
  },
  ar: {
    title: "مفاتيح المرور",
    description: "سجّل الدخول ببصمة إصبعك أو وجهك أو رمز جهازك — دون كلمة مرور.",
    add: "إضافة مفتاح مرور لهذا الجهاز",
    working: "في انتظار جهازك…",
    registered: "تم تسجيل مفتاح المرور على هذا الجهاز",
    saved: "تم حفظ مفتاح المرور",
    savedDesc: "يمكنك الآن تسجيل الدخول ببصمة هذا الجهاز أو وجهه أو رمزه.",
    failed: "تعذّر حفظ مفتاح المرور",
  },
  zh: {
    title: "通行密钥",
    description: "使用指纹、面容或设备 PIN 码登录 — 无需密码。",
    add: "为此设备添加通行密钥",
    working: "正在等待你的设备…",
    registered: "已在此设备上注册通行密钥",
    saved: "通行密钥已保存",
    savedDesc: "现在可以使用此设备的指纹、面容或 PIN 码登录。",
    failed: "无法保存通行密钥",
  },
  ja: {
    title: "パスキー",
    description: "指紋・顔・デバイスのPINでサインイン。パスワードは不要です。",
    add: "このデバイスにパスキーを追加",
    working: "デバイスを待っています…",
    registered: "このデバイスにパスキーを登録しました",
    saved: "パスキーを保存しました",
    savedDesc: "このデバイスの指紋・顔・PINでサインインできるようになりました。",
    failed: "パスキーを保存できませんでした",
  },
  ko: {
    title: "패스키",
    description: "지문, 얼굴 또는 기기 PIN으로 로그인하세요 — 비밀번호가 필요 없습니다.",
    add: "이 기기에 패스키 추가",
    working: "기기를 기다리는 중…",
    registered: "이 기기에 패스키가 등록되었습니다",
    saved: "패스키가 저장되었습니다",
    savedDesc: "이제 이 기기의 지문, 얼굴 또는 PIN으로 로그인할 수 있습니다.",
    failed: "패스키를 저장하지 못했습니다",
  },
  hi: {
    title: "पासकी",
    description: "फिंगरप्रिंट, चेहरे या डिवाइस PIN से साइन इन करें — पासवर्ड की ज़रूरत नहीं।",
    add: "इस डिवाइस के लिए पासकी जोड़ें",
    working: "आपके डिवाइस की प्रतीक्षा…",
    registered: "पासकी इस डिवाइस पर रजिस्टर हो गई",
    saved: "पासकी सेव हो गई",
    savedDesc: "अब आप इस डिवाइस के फिंगरप्रिंट, चेहरे या PIN से साइन इन कर सकते हैं।",
    failed: "पासकी सेव नहीं हो सकी",
  },
};

const seen = new Set();
for (const [code, keys] of Object.entries(KEYS)) {
  if (seen.has(code)) throw new Error(`duplicate language: ${code}`);
  seen.add(code);
  const file = path.join(LOCALES, code, "index.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.settings = json.settings || {};
  json.settings.passkeys = json.settings.passkeys || {};
  let changed = false;
  for (const [k, v] of Object.entries(keys)) {
    if (json.settings.passkeys[k] !== v) {
      json.settings.passkeys[k] = v;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    console.log(`updated ${code}`);
  } else {
    console.log(`ok ${code}`);
  }
}
console.log("done");
