import express from "express";
import admin from "firebase-admin";
import cors from "cors";

const app = express();
// Configurar middlewares
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// 🔥 CONFIGURACIÓN DE FIREBASE ADMIN SDK
// Las variables de entorno serán inyectadas por Fly.io.
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  // Reemplazar saltos de línea para que la clave privada se lea correctamente
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"), 
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

// Inicializar Firebase
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("🟢 Firebase Admin SDK inicializado correctamente.");
  }
} catch (error) {
  console.error("🔴 Error al inicializar Firebase Admin SDK:", error.message);
}

const db = admin.firestore();

// -------------------------------------------------------------
// 💰 CONFIGURACIÓN DE PAQUETES DE CRÉDITOS
const PAQUETES = {
  10: 60,   // S/ 10 -> 60 ⚡
  20: 125,  // S/ 20 -> 125 🚀
  50: 330,  // S/ 50 -> 330 💎
  100: 700, // S/ 100 -> 700 👑
  200: 1500, // S/ 200 -> 1500 🔥
};
const CREDITOS_CORTESIA = 3; 

// -------------------------------------------------------------
// ⚙️ FUNCIÓN PRINCIPAL PARA OTORGAR CRÉDITOS (CON TRANSACCIÓN)
async function otorgarCreditos(email, montoPagado) {
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
  let creditosActuales;

  // Usar una transacción para asegurar la lectura del saldo actual y la escritura del nuevo saldo
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) {
        throw new Error("Documento de usuario no existe!");
      }

      // Obtener el saldo actual, si no existe se asume 0
      creditosActuales = doc.data().creditos || 0;
      totalCreditosFinal = creditosActuales + creditosOtorgados;

      // Actualizar el documento dentro de la transacción
      t.update(userRef, {
        creditos: totalCreditosFinal,
        tipoPlan: "creditos",
        // Usar serverTimestamp para la hora exacta de la transacción
        fechaActivacion: admin.firestore.FieldValue.serverTimestamp(), 
        duracionDias: 0, // No aplica duración para créditos
        ultimaCompraMonto: montoPagado,
        ultimaCompraCreditos: creditosOtorgados,
      });
    });
  } catch (e) {
    console.error(`❌ Falló la transacción de Firestore para ${email}:`, e);
    throw new Error(`Error en la transacción de créditos: ${e.message}`);
  }

  // -----------------------------------------------------------------
  // CONSTRUCCIÓN DEL MENSAJE DE FELICITACIÓN
  // -----------------------------------------------------------------
  const mensajeNotificacion = `
✨ ¡Felicitaciones, ${email}! 🎉
Tu compra de S/ ${montoPagado} (${creditosBase} créditos base) fue activada con éxito ✅
Y porque valoramos que sigas con nosotros, te añadimos ${CREDITOS_CORTESIA} créditos extra de regalo 🎁

👉 En total ahora tienes ${totalCreditosFinal} créditos disponibles.
¡Úsalos como quieras y sácales el máximo provecho con Consulta PE! 🚀
  `.trim();

  console.log(`✅ Transacción exitosa para ${email}. Otorgados: ${creditosOtorgados}. Nuevo Total: ${totalCreditosFinal}`);
  
  return {
    message: "Créditos activados y saldo actualizado correctamente.",
    notificacion: mensajeNotificacion,
  };
}

// -------------------------------------------------------------
// 💳 WEBHOOK MERCADO PAGO (Ejemplo de webhook)
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    // Asumimos que Mercado Pago o tu capa intermedia envían estos datos en el body
    const { email, monto, estado } = req.body; 

    // Validar estado de pago
    if (!email || !monto || (estado !== "approved" && estado !== "pagado")) {
      console.log(`⚠️ Pago de MP no procesado: ${JSON.stringify(req.body)}`);
      // Retornar 200 OK para evitar reintentos de Mercado Pago, pero con mensaje informativo
      return res.status(200).json({ message: "Estado de pago no finalizado (no approved/pagado) o datos faltantes." });
    }

    const result = await otorgarCreditos(email, monto);
    
    // Devolver la notificación para que tu sistema de notificaciones la use
    res.json({ 
      message: result.message, 
      notificacion: result.notificacion 
    });

  } catch (error) {
    console.error("❌ Error en webhook Mercado Pago:", error);
    // Retornar 500 para indicar un error interno del servidor
    res.status(500).json({ error: "Error interno al procesar el pago. " + error.message });
  }
});

// -------------------------------------------------------------
// 💰 WEBHOOK FLOW (Ejemplo de webhook)
app.post("/webhook/flow", async (req, res) => {
  try {
    // Asumimos que Flow o tu capa intermedia envían estos datos en el body
    const { email, monto, estado } = req.body; 

    // Validar estado de pago
    if (!email || !monto || (estado !== "paid" && estado !== "pagado")) {
      console.log(`⚠️ Pago de Flow no procesado: ${JSON.stringify(req.body)}`);
      // Retornar 200 OK para evitar reintentos de Flow, pero con mensaje informativo
      return res.status(200).json({ message: "Estado de pago no finalizado (no paid/pagado) o datos faltantes." });
    }

    const result = await otorgarCreditos(email, monto);

    // Devolver la notificación
    res.json({ 
      message: result.message, 
      notificacion: result.notificacion 
    });

  } catch (error) {
    console.error("❌ Error en webhook Flow:", error);
    // Retornar 500 para indicar un error interno del servidor
    res.status(500).json({ error: "Error interno al procesar el pago. " + error.message });
  }
});

// -------------------------------------------------------------
// 🧠 TEST GENERAL
app.get("/", (req, res) => {
  res.send("🚀 API de pagos funcionando correctamente. Esperando webhooks...");
});

// -------------------------------------------------------------
// 🔊 INICIO DEL SERVIDOR
const PORT = process.env.PORT || 8080;
// Escuchar en 0.0.0.0 es necesario para Fly.io
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`)
);
