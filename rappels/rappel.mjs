// Mon Argent : deux rappels par jour (heure du Bénin, UTC+1)
//  - 14h30 : noter les dépenses de la matinée
//  - 22h30 : noter les dépenses faites depuis 14h30
// Chaque rappel part une seule fois par jour.
import admin from "firebase-admin";

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const loc = new Date(Date.now() + 3600e3);
const jour = loc.toISOString().slice(0, 10);
const min = loc.getUTCHours() * 60 + loc.getUTCMinutes();
const midi = 14 * 60 + 30, soir = 22 * 60 + 30;
let slot = process.argv[2];
if (!slot || slot === "auto") slot = min >= midi && min < midi + 150 ? "midi" : min >= soir ? "soir" : null;
if (!slot) { console.log("Pas l'heure d'un rappel"); process.exit(0); }
const meta = db.collection("meta").doc("rappels");
if (process.env.FORCE !== "1" && ((await meta.get()).data() || {})[slot] === jour) { console.log("Déjà envoyé :", slot); process.exit(0); }
await meta.set({ [slot]: jour }, { merge: true });

// 14h30 du jour, en temps universel
const coupure = Date.UTC(+jour.slice(0, 4), +jour.slice(5, 7) - 1, +jour.slice(8, 10), 13, 30);
const snap = await db.collection("argentTokens").get();
const parUid = {};
snap.docs.forEach(d => (parUid[d.data().uid] = parUid[d.data().uid] || []).push(d.id));
const msgs = [];
for (const [uid, toks] of Object.entries(parUid)) {
  const tx = (await db.collection("users").doc(uid).collection("tx").where("date", "==", jour).get()).docs.map(d => d.data());
  const n = tx.filter(t => slot === "midi" ? t.ts < coupure : t.ts >= coupure).length;
  const s = n > 1 ? "s" : "";
  const title = slot === "midi" ? "Tes dépenses de ce matin" : "Tes dépenses de l'après-midi et du soir";
  const body = slot === "midi"
    ? (n ? `${n} opération${s} notée${s} ce matin. Rien oublié ? Petit-déj, zem, crédit…` : "Il est 14h30. Note tout ce que tu as dépensé ce matin, même 50 F.")
    : (n ? `${n} opération${s} notée${s} depuis 14h30. Rien oublié avant de dormir ?` : "Note tout ce que tu as dépensé depuis 14h30, même 50 F.");
  toks.forEach(token => msgs.push({ token, data: { title, body, url: "./", tag: "argent-" + slot }, webpush: { headers: { Urgency: "high", TTL: "14400" } } }));
}
console.log(`${slot} : ${msgs.length} téléphone(s)`);
for (let i = 0; i < msgs.length; i += 500) {
  const part = msgs.slice(i, i + 500), res = await admin.messaging().sendEach(part);
  await Promise.all(res.responses.map((r, j) => { const c = r.error?.code || "";
    if (c.includes("not-registered") || c.includes("invalid-registration")) return db.collection("argentTokens").doc(part[j].token).delete(); }));
  console.log(`Envoyés : ${res.successCount}, échecs : ${res.failureCount}`);
}
