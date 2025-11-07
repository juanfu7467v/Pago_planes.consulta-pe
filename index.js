import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import flow from "flow-node-sdk"; // asegúrate de tenerlo en package.json si lo usas

const app = express();
app.use(cors());
app.use(express.json());

// =======================================================
// 🔧 Configuración de Firebase desde variables de entorno
// =======================================================
function buildServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
      const sa = JSON.parse(saRaw);
      if (sa.private_key && sa.private_key.includes("\\n")) {
        sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      }
      return sa;
    } catch (e) {
      console.error("❌ Error parseando FIREBASE_SERVICE_ACCOUNT:", e.message);
      return null;
    }
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
    return {
      type: process.env.FIREBASE_TYPE || "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : undefined,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    };
  }

  console.error("❌ No se encontró configuración de Firebase.");
  return null;
}

// Inicializar Firebase
const serviceAccount = buildServiceAccountFromEnv();
try {
  if (!serviceAccount) throw new Error("Credenciales Firebase inválidas.");
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("🟢 Firebase Admin SDK inicializado correctamente.");
  }
} catch (error) {
  console.error("🔴 Error al inicializar Firebase:", error.message);
}

let db;
try {
  db = admin.firestore();
} catch (e) {
  console.warn("⚠️ Firestore no disponible:", e.message);
  db = null;
}

// =======================================================
// 💳 Configuración de Flow y Mercado Pago
// =======================================================
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY;
const MERCADOPAGO_PUBLIC_KEY = process.env.MERCADOPAGO_PUBLIC_KEY;
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

// =======================================================
// 🎯 Configuración de paquetes de créditos y planes
// =======================================================
const PAQUETES_CREDITOS = {
  10: 60,
  20: 125,
  50: 330,
  100: 700,
  200: 1500,
};
const CREDITOS_CORTESIA = 3;

const PLANES_ILIMITADOS = {
  60: 7,
  80: 15,
  110: 30,
  160: 60,
  510: 70,
};

// =======================================================
// 💎 Función para otorgar créditos o plan ilimitado
// =======================================================
async function otorgarBeneficio(uid, email, montoPagado) {
  if (!db) throw new Error("Firestore no inicializado.");

  const usuariosRef = db.collection("usuarios");
  let userDoc;

  if (uid) {
    userDoc = usuariosRef.doc(uid);
  } else if (email) {
    const snapshot = await usuariosRef.where("email", "==", email).get();
    if (snapshot.empty) throw new Error("Usuario no encontrado por email.");
    userDoc = usuariosRef.doc(snapshot.docs[0].id);
  } else {
    throw new Error("Falta UID o Email para identificar usuario.");
  }

  const doc = await userDoc.get();
  if (!doc.exists) throw new Error("Documento de usuario no existe en Firestore.");

  let tipoPlan = "creditos";
  let creditosOtorgados = 0;
  let duracionDias = 0;

  if (PAQUETES_CREDITOS[montoPagado]) {
    tipoPlan = "creditos";
    creditosOtorgados = PAQUETES_CREDITOS[montoPagado] + CREDITOS_CORTESIA;
  } else if (PLANES_ILIMITADOS[montoPagado]) {
    tipoPlan = "ilimitado";
    duracionDias = PLANES_ILIMITADOS[montoPagado];
  } else {
    throw new Error("Monto de pago no coincide con ningún plan.");
  }

  await db.runTransaction(async (t) => {
    const userData = (await t.get(userDoc)).data();
    const creditosActuales = userData.creditos || 0;
    const nuevosCreditos =
      tipoPlan === "creditos" ? creditosActuales + creditosOtorgados : creditosActuales;

    t.update(userDoc, {
      creditos: nuevosCreditos,
      tipoPlan,
      fechaActivacion: admin.firestore.FieldValue.serverTimestamp(),
      duracionDias,
      ultimaCompraMonto: montoPagado,
      ultimaCompraCreditos: creditosOtorgados,
    });
  });

  return {
    message:
      tipoPlan === "creditos"
        ? `Créditos asignados: ${creditosOtorgados}`
        : `Plan ilimitado activado por ${duracionDias} días`,
    tipoPlan,
    montoPagado,
  };
}

// =======================================================
// 🌐 Endpoints para pagos
// =======================================================

// Mercado Pago
app.get("/api/mercadopago", async (req, res) => {
  try {
    const { uid, email, monto, estado } = req.query;
    if (!email && !uid) return res.status(400).json({ message: "Falta UID o email." });
    if (!monto) return res.status(400).json({ message: "Falta monto." });
    if (estado !== "approved" && estado !== "pagado")
      return res.status(200).json({ message: "Pago no confirmado." });

    const result = await otorgarBeneficio(uid, email, Number(monto));
    res.json({ ok: true, result });
  } catch (e) {
    console.error("Error en /api/mercadopago:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Flow
app.get("/api/flow", async (req, res) => {
  try {
    const { uid, email, monto, estado } = req.query;
    if (!email && !uid) return res.status(400).json({ message: "Falta UID o email." });
    if (!monto) return res.status(400).json({ message: "Falta monto." });
    if (estado !== "paid" && estado !== "pagado")
      return res.status(200).json({ message: "Pago no confirmado." });

    const result = await otorgarBeneficio(uid, email, Number(monto));
    res.json({ ok: true, result });
  } catch (e) {
    console.error("Error en /api/flow:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint de prueba
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    firebaseInitialized: !!db,
    flowConfigured: !!FLOW_API_KEY,
    mercadopagoConfigured: !!MERCADOPAGO_ACCESS_TOKEN,
  });
});

// =======================================================
// 🚀 Servidor
// =======================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
