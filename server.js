import express from "express";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import crypto from "crypto";
import nodemailer from "nodemailer"; 
import fetch from "node-fetch"; 

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(process.cwd(), "public")));

const NODE_ENV = process.env.NODE_ENV || "sandbox";
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

const SQUARE_API = NODE_ENV === "production"
  ? "https://connect.squareup.com/v2/payments"
  : "https://connect.squareupsandbox.com/v2/payments";

// Endpoint para procesar pagos
app.post("/process-payment", async (req, res) => {
  try {
    console.log("📥 Datos recibidos del cliente:", req.body);

    const { sourceId, total, email, address, firstName, lastName, productos } = req.body;

    if (!sourceId || !total || !firstName || !lastName || !email || !address) {
      return res.status(400).json({ error: "Faltan datos del pago o datos del cliente" });
    }

    let finalTotal = Number(total);
    const taxRateCT = 0.0635;
    if (address && address.toUpperCase().includes("CT")) {
      const taxAmount = finalTotal * taxRateCT;
      finalTotal += taxAmount;
    }

    const amountCents = Math.round(finalTotal * 100);

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
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const itemsList = (productos || [])
        .map(p => `- ${p.titulo} | Cantidad: ${p.quantity || 1} | Precio: $${p.price}`)
        .join("\n");

      const mailOptions = {
        from: `"LaTRONIC" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: "🛒 New sale in LaTRONIC LLC",
        text: `
✅ Payment processed successfully

💰 Total: $${finalTotal.toFixed(2)}
📧 Client email: ${email}
👤 Client name: ${firstName} ${lastName}
📦 Shipping address: ${address}

📝 Ordered products:
${itemsList || "No products found"}
        `,
      };

      await transporter.sendMail(mailOptions);
      console.log("📩 Email sent correctly");

      res.json({ payment: data.payment });
    } else {
      res.status(500).json({ error: data.errors || "Payment not completed" });
    }

  } catch (err) {
    console.error("❌ Error in the payment:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "Home.html"));
});

app.get("/card-charge", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "card-charge.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT} - Entorno: ${NODE_ENV}`);
});
