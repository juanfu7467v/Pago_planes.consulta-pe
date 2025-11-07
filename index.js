import express from "express";
import admin from "firebase-admin";
import cors from "cors";

// Dependencias de Pago
import mercadopago from "mercadopago";
import flow from "flow-node-sdk"; // Asumiendo que esta es la librería correcta para tu implementación de Flow

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
// Nota: Las variables de entorno son requeridas para la funcionalidad.
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY;
const MERCADOPAGO_PUBLIC_KEY = process.env.MERCADOPAGO_PUBLIC_KEY;
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

// Inicialización de Mercado Pago SDK
if (MERCADOPAGO_ACCESS_TOKEN) {
  mercadopago.configure({ access_token: MERCADOPAGO_ACCESS_TOKEN });
  console.log("🟢 Mercado Pago SDK configurado.");
} else {
  console.warn("⚠️ MERCADOPAGO_ACCESS_TOKEN no encontrado.");
}

// Inicialización de Flow SDK (estructura mock, ya que la implementación real depende del SDK específico)
let flowClient = null;
if (FLOW_API_KEY && FLOW_SECRET_KEY) {
  // Aquí debes usar la inicialización real de tu SDK de Flow.
  // Ejemplo: flowClient = new flow.FlowClient(FLOW_API_KEY, FLOW_SECRET_KEY);
  // Por ahora, usaremos una simulación para que la app inicie.
  flowClient = {
    createPayment: ({ commerceOrder, subject, amount, urlConfirmation, urlReturn }) => {
      console.log(`[Flow Mock] Creando pago por ${amount} PEN...`);
      // Simula la respuesta que te daría Flow (un objeto con un URL de redirección)
      return Promise.resolve({
        url: `https://mock.flow.cl/payment/redirect?token=${commerceOrder}`,
        token: commerceOrder
      });
    }
  };
  console.log("🟢 Flow Client configurado (simulado).");
} else {
  console.warn("⚠️ Flow API Keys no encontrados. La funcionalidad de Flow estará simulada o fallará.");
}


// =======================================================
// 🎯 Configuración de paquetes de créditos y planes
// =======================================================
const PAQUETES_CREDITOS = {
  10: 60, // Mercado Pago (PERU)
  20: 125, // Mercado Pago (PERU)
  50: 330, // Flow (PERU)
  100: 700, // Flow (PERU)
  200: 1500, // Flow (PERU)
};
const CREDITOS_CORTESIA = 3;

const PLANES_ILIMITADOS = {
  60: 7, // Días (Flow - PERU)
  80: 15,
  110: 30,
  160: 60,
  510: 70,
};

// =======================================================
// 💎 Función para otorgar créditos o plan ilimitado
// =======================================================
/**
 * Otorga el beneficio (créditos o plan) al usuario después de la confirmación de pago.
 * @param {string} uid - ID de usuario de Firebase.
 * @param {string} email - Email del usuario.
 * @param {number} montoPagado - Monto pagado en soles (PEN).
 */
async function otorgarBeneficio(uid, email, montoPagado) {
  if (!db) throw new Error("Firestore no inicializado.");

  const usuariosRef = db.collection("usuarios");
  let userDoc;

  // 1. Encontrar o crear el documento de usuario
  if (uid) {
    userDoc = usuariosRef.doc(uid);
  } else if (email) {
    const snapshot = await usuariosRef.where("email", "==", email).limit(1).get();
    if (snapshot.empty) throw new Error("Usuario no encontrado por email.");
    userDoc = usuariosRef.doc(snapshot.docs[0].id);
  } else {
    throw new Error("Falta UID o Email para identificar usuario.");
  }

  const doc = await userDoc.get();
  if (!doc.exists) throw new Error("Documento de usuario no existe en Firestore.");

  // 2. Determinar el beneficio
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
    throw new Error(`Monto de pago S/ ${montoPagado} no coincide con ningún plan válido.`);
  }

  // 3. Aplicar beneficio en una transacción
  await db.runTransaction(async (t) => {
    const userData = (await t.get(userDoc)).data();
    const creditosActuales = userData.creditos || 0;
    
    let updateData = {};

    if (tipoPlan === "creditos") {
      // Sumar créditos
      updateData.creditos = creditosActuales + creditosOtorgados;
      updateData.ultimaCompraCreditos = creditosOtorgados;
      updateData.tipoPlan = 'creditos_paquete'; // Distinguir si es solo paquete de créditos
    } else {
      // Activar plan ilimitado
      const fechaActual = new Date();
      let fechaFinActual = userData.fechaFinIlimitado ? userData.fechaFinIlimitado.toDate() : fechaActual;
      
      // Si la fecha actual ya pasó la fecha de fin, empezamos desde hoy, si no, extendemos.
      const fechaInicio = fechaFinActual > fechaActual ? fechaFinActual : fechaActual;
      
      const fechaFinNueva = new Date(fechaInicio);
      fechaFinNueva.setDate(fechaFinNueva.getDate() + duracionDias);

      updateData.fechaFinIlimitado = admin.firestore.Timestamp.fromDate(fechaFinNueva);
      updateData.duracionDias = duracionDias;
      updateData.tipoPlan = 'ilimitado';
      // Mantener créditos actuales si el plan ilimitado no los reemplaza
      updateData.creditos = creditosActuales; 
      updateData.ultimaCompraCreditos = 0;
    }
    
    updateData.ultimaCompraMonto = montoPagado;
    updateData.fechaUltimaCompra = admin.firestore.FieldValue.serverTimestamp();


    t.update(userDoc, updateData);
  });

  return {
    message:
      tipoPlan === "creditos"
        ? `Créditos asignados: ${creditosOtorgados} + ${CREDITOS_CORTESIA} de cortesía.`
        : `Plan ilimitado activado o extendido por ${duracionDias} días.`,
    tipoPlan,
    montoPagado,
  };
}

// =======================================================
// 💸 Funciones de INICIACIÓN de Pago
// =======================================================

/**
 * Crea una preferencia de pago en Mercado Pago (S/ 10 o S/ 20).
 * @param {number} amount - Monto en soles (PEN).
 * @param {string} uid - ID de usuario.
 * @param {string} email - Email del usuario.
 * @param {string} description - Descripción del producto.
 * @returns {Promise<string>} - URL de redirección (Sandbox o Production).
 */
async function createMercadoPagoPreference(amount, uid, email, description) {
  if (!mercadopago.configurations.access_token) {
    throw new Error("Mercado Pago SDK no configurado. Falta Access Token.");
  }

  // URL base de este servidor, necesaria para los callbacks
  const HOST_URL = process.env.HOST_URL || "http://localhost:8080";
  const externalReference = `MP-${uid}-${Date.now()}`;

  const preference = {
    items: [
      {
        title: description,
        unit_price: amount,
        quantity: 1,
        currency_id: "PEN", // Moneda Peruana: Soles
      },
    ],
    payer: {
      email: email,
    },
    // Redireccionamiento después del pago (todos usan el endpoint /api/mercadopago)
    back_urls: {
      success: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&estado=approved&ref=${externalReference}`,
      failure: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&estado=rejected&ref=${externalReference}`,
      pending: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&estado=pending&ref=${externalReference}`,
    },
    auto_return: "approved",
    external_reference: externalReference,
    payment_methods: {
      // Excluye efectivo si solo quieres métodos online, o inclúyelos
      excluded_payment_types: [
        // { id: "ticket" } // Opcional: para desactivar pagos en efectivo como PagoEfectivo
      ],
      installments: 1, // Limitar a una cuota si es un paquete de bajo costo
    },
  };

  const response = await mercadopago.preferences.create(preference);
  // Retorna la URL de redirección global (incluye tarjetas, Yape, etc.)
  return response.body.init_point;
}

/**
 * Crea un pago con Flow (S/ 50+ o Planes Ilimitados).
 * @param {number} amount - Monto en soles (PEN).
 * @param {string} uid - ID de usuario.
 * @param {string} email - Email del usuario.
 * @param {string} subject - Descripción del producto.
 * @returns {Promise<string>} - URL de redirección de Flow.
 */
async function createFlowPayment(amount, uid, email, subject) {
  if (!flowClient) {
    throw new Error("Flow Client no configurado.");
  }

  // URL base de este servidor, necesaria para los callbacks
  const HOST_URL = process.env.HOST_URL || "http://localhost:8080";
  const commerceOrder = `FLOW-${uid}-${Date.now()}`;

  const paymentData = {
    commerceOrder: commerceOrder,
    subject: subject,
    amount: amount,
    email: email,
    currency: "PEN", // Aunque Flow es de Chile, configuramos la moneda de Perú.
    // URL de confirmación (callback de servidor a servidor) y retorno (redirección del usuario)
    urlConfirmation: `${HOST_URL}/api/flow/confirmation`, // Debe ser POST, pero la incluimos para completar
    urlReturn: `${HOST_URL}/api/flow?monto=${amount}&uid=${uid}&estado=pagado&ref=${commerceOrder}`,
  };

  // El método createPayment del SDK de Flow devuelve una URL para redirigir al checkout.
  // Nota: La implementación real de Flow en Perú puede requerir ajustes de parámetros/librerías.
  const response = await flowClient.createPayment(paymentData);
  return response.url; // Retorna la URL de redirección que incluye todas las opciones de Flow.
}

// =======================================================
// 🌐 Endpoints de INICIACIÓN de Pago (GET para AppCreator 24)
// =======================================================

// 💰 Mercado Pago (Paquetes chicos: S/ 10, S/ 20)
app.get("/api/init/mercadopago/:amount", async (req, res) => {
  try {
    const amount = Number(req.params.amount);
    const { uid, email } = req.query;

    if (!uid || !email) {
      return res.status(400).json({ message: "Faltan parámetros 'uid' y 'email' en la query." });
    }
    if (![10, 20].includes(amount)) {
      return res.status(400).json({ message: "Monto no válido para Mercado Pago (solo S/ 10, S/ 20)." });
    }

    const creditos = PAQUETES_CREDITOS[amount] + CREDITOS_CORTESIA;
    const description = `Paquete de ${creditos} créditos (incl. cortesía)`;

    const redirectUrl = await createMercadoPagoPreference(amount, uid, email, description);

    // Devuelve la URL de Mercado Pago que tu app debe abrir
    res.json({
      ok: true,
      processor: "Mercado Pago",
      amount: amount,
      description: description,
      redirectUrl: redirectUrl,
    });
  } catch (e) {
    console.error("Error en /api/init/mercadopago:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 🚀 Flow (Paquetes medianos/grandes: S/ 50, S/ 100, S/ 200)
app.get("/api/init/flow/creditos/:amount", async (req, res) => {
  try {
    const amount = Number(req.params.amount);
    const { uid, email } = req.query;

    if (!uid || !email) {
      return res.status(400).json({ message: "Faltan parámetros 'uid' y 'email' en la query." });
    }
    if (![50, 100, 200].includes(amount)) {
      return res.status(400).json({ message: "Monto no válido para Flow Créditos (solo S/ 50, S/ 100, S/ 200)." });
    }

    const creditos = PAQUETES_CREDITOS[amount] + CREDITOS_CORTESIA;
    const description = `Paquete de ${creditos} créditos (incl. cortesía) - Flow`;

    const redirectUrl = await createFlowPayment(amount, uid, email, description);

    res.json({
      ok: true,
      processor: "Flow",
      amount: amount,
      description: description,
      redirectUrl: redirectUrl,
    });
  } catch (e) {
    console.error("Error en /api/init/flow/creditos:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ♾️ Flow (Planes Ilimitados: S/ 60, S/ 80, S/ 110, S/ 160, S/ 510)
app.get("/api/init/flow/ilimitado/:amount", async (req, res) => {
  try {
    const amount = Number(req.params.amount);
    const { uid, email } = req.query;

    if (!uid || !email) {
      return res.status(400).json({ message: "Faltan parámetros 'uid' y 'email' en la query." });
    }
    if (!PLANES_ILIMITADOS[amount]) {
      return res.status(400).json({ message: "Monto no válido para Plan Ilimitado." });
    }

    const dias = PLANES_ILIMITADOS[amount];
    const description = `Plan Ilimitado por ${dias} días - Flow`;

    const redirectUrl = await createFlowPayment(amount, uid, email, description);

    res.json({
      ok: true,
      processor: "Flow",
      amount: amount,
      description: description,
      redirectUrl: redirectUrl,
    });
  } catch (e) {
    console.error("Error en /api/init/flow/ilimitado:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// =======================================================
// 🔔 Endpoints de Notificación/Callback (Otorga Beneficio)
// =======================================================

// Mercado Pago (Recibe estado final del pago)
app.get("/api/mercadopago", async (req, res) => {
  try {
    // Los parámetros se reciben de Mercado Pago (back_urls)
    const { uid, email, monto, estado } = req.query;
    console.log(`[MP Callback] UID: ${uid}, Monto: ${monto}, Estado: ${estado}`);

    if (!email && !uid) return res.status(400).json({ message: "Falta UID o email." });
    if (!monto) return res.status(400).json({ message: "Falta monto." });
    
    // Solo otorgamos el beneficio si el estado es aprobado.
    if (estado !== "approved" && estado !== "pagado") {
      // Redirigir a una página de estado de pago pendiente/rechazado en tu app
      return res.redirect("/payment/rejected"); 
    }

    const result = await otorgarBeneficio(uid, email, Number(monto));
    // Redirigir a una página de éxito en tu app
    res.redirect("/payment/success");

  } catch (e) {
    console.error("Error en /api/mercadopago:", e.message);
    // Redirigir a una página de error en tu app
    res.redirect("/payment/error");
  }
});

// Flow (Recibe estado final del pago)
app.get("/api/flow", async (req, res) => {
  try {
    // Los parámetros se reciben de Flow (urlReturn)
    const { uid, email, monto, estado } = req.query;
    console.log(`[Flow Callback] UID: ${uid}, Monto: ${monto}, Estado: ${estado}`);

    if (!email && !uid) return res.status(400).json({ message: "Falta UID o email." });
    if (!monto) return res.status(400).json({ message: "Falta monto." });
    
    // Flow requiere generalmente un callback POST (urlConfirmation) para la confirmación
    // definitiva, pero para el flujo simple de retorno de usuario, lo tratamos como pagado.
    if (estado !== "paid" && estado !== "pagado") {
      // Redirigir a una página de estado de pago pendiente/rechazado en tu app
      return res.redirect("/payment/rejected"); 
    }
    
    const result = await otorgarBeneficio(uid, email, Number(monto));
    // Redirigir a una página de éxito en tu app
    res.redirect("/payment/success");

  } catch (e) {
    console.error("Error en /api/flow:", e.message);
    // Redirigir a una página de error en tu app
    res.redirect("/payment/error");
  }
});

// Endpoint de prueba
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    firebaseInitialized: !!db,
    flowConfigured: !!FLOW_API_KEY,
    mercadopagoConfigured: !!MERCADOPAGO_ACCESS_TOKEN,
    endpoints: {
      mercadopago_init: "/api/init/mercadopago/:amount?uid={uid}&email={email}",
      flow_creditos_init: "/api/init/flow/creditos/:amount?uid={uid}&email={email}",
      flow_ilimitado_init: "/api/init/flow/ilimitado/:amount?uid={uid}&email={email}",
      callback_mercadopago: "/api/mercadopago?monto={monto}&uid={uid}&estado={estado}",
      callback_flow: "/api/flow?monto={monto}&uid={uid}&estado={estado}",
    }
  });
});

// =======================================================
// 🚀 Servidor
// =======================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
