// index.js
import express from "express";
import admin from "firebase-admin";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Inicializar Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// ✅ Endpoint de notificación Flow
app.post("/webhook/flow", async (req, res) => {
  try {
    const { email, monto, estado } = req.body;

    if (estado !== "pagado") {
      return res.status(400).json({ message: "Pago no confirmado" });
    }

    // Buscar el documento del usuario
    const usuariosRef = db.collection("usuarios");
    const snapshot = await usuariosRef.where("email", "==", email).get();

    if (snapshot.empty) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    snapshot.forEach(async (doc) => {
      const userRef = db.collection("usuarios").doc(doc.id);
      let creditosExtra = 0;

      if (monto === 10) creditosExtra = 100;
      else if (monto === 20) creditosExtra = 250;
      else if (monto === 60) creditosExtra = 900;

      await userRef.update({
        creditos: admin.firestore.FieldValue.increment(creditosExtra),
        tipoPlan: "creditos",
        fechaActivacion: new Date(),
        duracionDias: 0,
      });
    });

    res.json({ message: "Créditos activados correctamente." });
  } catch (error) {
    console.error("Error en webhook:", error);
    res.status(500).json({ error: error.message });
  }
});

// Puerto Fly.io
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Servidor escuchando en puerto ${PORT}`));
