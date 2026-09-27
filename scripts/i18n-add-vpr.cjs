// One-off: add vpr.* keys used by the internationalized VprHero to every
// language bundle. Run from repo root: node scripts/i18n-add-vpr.cjs
const fs = require("fs");

const vpr = {
  en: { trendNeedsTwo: "Trend needs 2 saves", logFirstMetric: "Log a metric to get your first score", strongProfile: "Strong overall profile", developingProfile: "Developing profile", earlyProfile: "Early in your profile", lowestVsWeighting: "Lowest {{factor}} vs your {{sport}} weighting — full breakdown on the VPR page.", sportFallback: "sport" },
  es: { trendNeedsTwo: "La tendencia necesita 2 registros", logFirstMetric: "Registra una métrica para obtener tu primera puntuación", strongProfile: "Perfil general sólido", developingProfile: "Perfil en desarrollo", earlyProfile: "Al inicio de tu perfil", lowestVsWeighting: "{{factor}} más bajo frente a la ponderación de {{sport}} — desglose completo en la página de VPR.", sportFallback: "deporte" },
  fr: { trendNeedsTwo: "La tendance nécessite 2 enregistrements", logFirstMetric: "Consignez une métrique pour obtenir votre premier score", strongProfile: "Profil global solide", developingProfile: "Profil en développement", earlyProfile: "Début de votre profil", lowestVsWeighting: "{{factor}} le plus bas face à la pondération {{sport}} — détail complet sur la page VPR.", sportFallback: "sport" },
  de: { trendNeedsTwo: "Trend benötigt 2 Speicherungen", logFirstMetric: "Trage einen Messwert ein, um deinen ersten Wert zu bekommen", strongProfile: "Starkes Gesamtprofil", developingProfile: "Profil im Aufbau", earlyProfile: "Anfang deines Profils", lowestVsWeighting: "{{factor}} am niedrigsten gegenüber deiner {{sport}}-Gewichtung — volle Aufschlüsselung auf der VPR-Seite.", sportFallback: "Sport" },
  pt: { trendNeedsTwo: "A tendência precisa de 2 registros", logFirstMetric: "Registre uma métrica para obter sua primeira pontuação", strongProfile: "Perfil geral sólido", developingProfile: "Perfil em desenvolvimento", earlyProfile: "Início do seu perfil", lowestVsWeighting: "{{factor}} mais baixo em relação à ponderação de {{sport}} — detalhes completos na página de VPR.", sportFallback: "esporte" },
  it: { trendNeedsTwo: "Il trend richiede 2 registrazioni", logFirstMetric: "Registra una metrica per ottenere il primo punteggio", strongProfile: "Profilo complessivo solido", developingProfile: "Profilo in sviluppo", earlyProfile: "Inizio del tuo profilo", lowestVsWeighting: "{{factor}} più basso rispetto alla ponderazione {{sport}} — dettaglio completo nella pagina VPR.", sportFallback: "sport" },
  nl: { trendNeedsTwo: "Trend heeft 2 opslagacties nodig", logFirstMetric: "Log een metriek voor je eerste score", strongProfile: "Sterk totaalprofiel", developingProfile: "Profiel in ontwikkeling", earlyProfile: "Begin van je profiel", lowestVsWeighting: "{{factor}} het laagst tegenover je {{sport}}-weging — volledige uitsplitsing op de VPR-pagina.", sportFallback: "sport" },
  ar: { trendNeedsTwo: "يحتاج الاتجاه إلى تسجيلين", logFirstMetric: "سجّل مقياسًا للحصول على أول نتيجة", strongProfile: "ملف قوي بشكل عام", developingProfile: "ملف قيد التطوير", earlyProfile: "بداية ملفك", lowestVsWeighting: "{{factor}} الأدنى مقابل ترجيح {{sport}} — التفصيل الكامل في صفحة المؤشر.", sportFallback: "الرياضة" },
  zh: { trendNeedsTwo: "趋势需要 2 次记录", logFirstMetric: "记录一项指标以获得首个分数", strongProfile: "整体表现强劲", developingProfile: "表现正在提升", earlyProfile: "档案尚在早期", lowestVsWeighting: "{{factor}} 低于你的{{sport}}权重 —— 完整分析见 VPR 页面。", sportFallback: "运动" },
  ja: { trendNeedsTwo: "傾向には2回の記録が必要", logFirstMetric: "指標を記録すると最初のスコアが表示されます", strongProfile: "総合的に強いプロフィール", developingProfile: "成長中のプロフィール", earlyProfile: "プロフィールの初期段階", lowestVsWeighting: "{{factor}} が {{sport}} の重み付けに対して最も低い — 詳細は VPR ページで。", sportFallback: "競技" },
  ko: { trendNeedsTwo: "추세에는 기록 2회가 필요", logFirstMetric: "지표를 기록하면 첫 점수가 표시됩니다", strongProfile: "전반적으로 강한 프로필", developingProfile: "성장 중인 프로필", earlyProfile: "프로필 초기 단계", lowestVsWeighting: "{{factor}}이(가) {{sport}} 가중치 대비 가장 낮음 — 전체 내역은 VPR 페이지에서.", sportFallback: "종목" },
  hi: { trendNeedsTwo: "ट्रेंड के लिए 2 रिकॉर्ड चाहिए", logFirstMetric: "पहला स्कोर पाने के लिए एक मीट्रिक दर्ज करें", strongProfile: "समग्र रूप से मजबूत प्रोफ़ाइल", developingProfile: "विकसित हो रही प्रोफ़ाइल", earlyProfile: "आपकी प्रोफ़ाइल की शुरुआत", lowestVsWeighting: "आपके {{sport}} वेटिंग के मुकाबले {{factor}} सबसे कम — पूरा विवरण VPR पेज पर।", sportFallback: "खेल" },
};

for (const [code, obj] of Object.entries(vpr)) {
  const p = `src/i18n/locales/${code}/index.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.vpr = { ...j.vpr, ...obj };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  console.log("vpr keys merged →", code);
}
