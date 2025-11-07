// index.js
import express from "express";
import admin from "firebase-admin";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Construye el objeto serviceAccount a partir de:
 * 1) process.env.FIREBASE_SERVICE_ACCOUNT (JSON string, recomendado), o
 * 2) variables individuales FIREBASE_*
 */
function buildServiceAccountFromEnv() {
  // Opción 1: secret único con JSON (recomendado)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      // Si el secret fue guardado con saltos escapados \\n, esto preserva el formato
      const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
      const sa = JSON.parse(saRaw);
      if (!sa.project_id || typeof sa.project_id !== "string") {
        console.error("❌ FIREBASE_SERVICE_ACCOUNT no contiene project_id válido.");
        return null;
      }
      // Asegurar que la private_key tenga saltos de línea reales
      if (sa.private_key && sa.private_key.includes("\\n")) {
        sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      }
      return sa;
    } catch (e) {
      console.error("❌ Error parseando FIREBASE_SERVICE_ACCOUNT:", e.message);
      return null;
    }
  }

  // Opción 2: variables individuales
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
    const sa = {
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
      universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
    };
    if (!sa.project_id || !sa.private_key || !sa.client_email) {
      console.error("❌ Faltan variables FIREBASE_* obligatorias (project_id, private_key, client_email).");
      return null;
    }
    return sa;
  }

  console.error("❌ No se encontró configuración de Firebase en variables de entorno.");
  return null;
}

// Construir service account
const serviceAccount = buildServiceAccountFromEnv();

try {
  if (!serviceAccount) {
    throw new Error("Credenciales de Firebase no encontradas o inválidas.");
  }

  // Inicializar app solo si no está inicializada
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("🟢 Firebase Admin SDK inicializado correctamente.");
  }
} catch (error) {
  console.error("🔴 Error al inicializar Firebase Admin SDK:", error.message);
  // si Firebase falla, no seguir (evita que la app arroje errores sin sentido)
  // pero seguimos levantando el servidor para que puedas ver logs / endpoints de salud
}

let db;
try {
  db = admin.firestore();
} catch (e) {
  console.warn("⚠️ Firestore no disponible (Firebase no inicializado). Muchas rutas requerirán Firebase.", e.message);
  db = null; // se validará antes de usar
}

// ------------------ resto de la app (webhooks / endpoints) ------------------
const PAQUETES = {
  10: 60,
  20: 125,
  50: 330,
  100: 700,
  200: 1500,
};
const CREDITOS_CORTESIA = 3;

async function otorgarCreditos(email, montoPagado) {
  if (!db) throw new Error("Firestore no inicializado.");

  const creditosBase = PAQUETES[montoPagado];
  if (!creditosBase) {
    console.log(`⚠️ Monto de pago S/${montoPagado} no coincide con ningún paquete.`);
    throw new Error("Monto de pago no válido o no configurado.");
  }

  const creditosOtorgados = creditosBase + CREDITOS_CORTESIA;
  const usuariosRef = db.collection("usuarios");
  const snapshot = await usuariosRef.where("email", "==", email).get();

  if (snapshot.empty) {
    console.log(`⚠️ Usuario con email ${email} no encontrado en Firestore.`);
    throw new Error("Usuario no encontrado.");
  }

  const docId = snapshot.docs[0].id;
  const userRef = db.collection("usuarios").doc(docId);

  let totalCreditosFinal;
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error("Documento de usuario no existe!");
      const creditosActuales = doc.data().creditos || 0;
      totalCreditosFinal = creditosActuales + creditosOtorgados;
      t.update(userRef, {
        creditos: totalCreditosFinal,
        tipoPlan: "creditos",
        fechaActivacion: admin.firestore.FieldValue.serverTimestamp(),
        duracionDias: 0,
        ultimaCompraMonto: montoPagado,
        ultimaCompraCreditos: creditosOtorgados,
      });
    });
  } catch (e) {
    console.error("❌ Falló la transacción:", e);
    throw e;
  }

  return {
    message: "Créditos activados y saldo actualizado correctamente.",
    totalCreditosFinal,
    creditosOtorgados,
  };
}

app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { email, monto, estado } = req.body;
    if (!email || !monto) return res.status(400).json({ message: "Faltan datos (email/monto)." });
    if (estado !== "approved" && estado !== "pagado") return res.status(200).json({ message: "Pago no confirmado." });
    const result = await otorgarCreditos(email, monto);
    res.json({ ok: true, result });
  } catch (e) {
    console.error("Error webhook MP:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/webhook/flow", async (req, res) => {
  try {
    const { email, monto, estado } = req.body;
    if (!email || !monto) return res.status(400).json({ message: "Faltan datos (email/monto)." });
    if (estado !== "paid" && estado !== "pagado") return res.status(200).json({ message: "Pago no confirmado." });
    const result = await otorgarCreditos(email, monto);
    res.json({ ok: true, result });
  } catch (e) {
    console.error("Error webhook Flow:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", firebaseInitialized: !!db });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`));
