import express from "express";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import crypto from "crypto";
import nodemailer from "nodemailer"; // ✅ Import de Nodemailer
import fetch from "node-fetch"; // Si usas Node 18+, fetch ya está incluido, sino instala node-fetch

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(process.cwd(), "public")));

const NODE_ENV = process.env.NODE_ENV || "sandbox";
const APPLICATION_ID = process.env.SQUARE_APPLICATION_ID;
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

// Elegir endpoint según entorno
const SQUARE_API = NODE_ENV === "production"
  ? "https://connect.squareup.com/v2/payments"
  : "https://connect.squareupsandbox.com/v2/payments";

// Endpoint para procesar pagos
app.post("/process-payment", async (req, res) => {
  try {
    const { sourceId, total, email, address } = req.body;
    if (!sourceId || !total) return res.status(400).json({ error: "Faltan datos del pago" });

    // --- TAX SOLO PARA CONNECTICUT ---
    let finalTotal = Number(total);
    const taxRateCT = 0.0635; // 6.35%

    if (address && address.toUpperCase().includes("CT")) {
      const taxAmount = finalTotal * taxRateCT;
      finalTotal += taxAmount;
      console.log(`💰 Tax aplicado (CT): $${taxAmount.toFixed(2)} | Total con tax: $${finalTotal.toFixed(2)}`);
    } else {
      console.log("ℹ️ No se aplica tax (solo CT paga impuestos)");
    }

    const amountCents = Math.round(finalTotal * 100);

    // Llamada al API de Square
    const response = await fetch(SQUARE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Accept": "application/json"
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: {
          amount: amountCents,
          currency: "USD"
        },
        location_id: LOCATION_ID
      })
    });

    const data = await response.json();

    if (data.payment && data.payment.status === "COMPLETED") {
      // ✅ PAGO EXITOSO

      // ---- ENVIAR EMAIL AL ADMIN ----
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS, // App Password recomendado
        },
      });

      const mailOptions = {
        from: `"LaTRONIC" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: "🛒 New sale in LaTRONIC LLC",
        text: `
✅ Payment proccess succesfull

💰 Total: $${finalTotal.toFixed(2)}
📧 Client email: ${email}
📦 Shipping address: ${address}
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log("📩 Email sent correctly");
      } catch (mailErr) {
        console.error("❌ Error sending email:", mailErr);
      }

      // ---- RESPUESTA AL FRONTEND ----
      res.json({ payment: data.payment });
    } else {
      res.status(500).json({ error: data.errors || "Payment not completed" });
    }

  } catch (err) {
    console.error("❌ Error in the payment:", err);
    res.status(500).json({ error: err.message });
  }
});

// Ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "card-charge.html"));
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT} - Entorno: ${NODE_ENV}`);
});
