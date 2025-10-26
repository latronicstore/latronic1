// --------------------
// 📦 Importaciones
// --------------------
import express from "express";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import crypto from "crypto";
import fetch from "node-fetch";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import nodemailer from "nodemailer";

// --------------------
// ⚙️ Configuración básica
// --------------------
dotenv.config();
const app = express();
const __dirname = process.cwd();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Permitir CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  next();
});

// --------------------
// 🗝️ Base de datos (LowDB)
// --------------------
const dbFile = path.join(__dirname, "db.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { productos: [] });

await db.read();
db.data ||= { productos: [] };
await db.write();

// --------------------
// 💳 Configuración Square
// --------------------
const NODE_ENV = process.env.NODE_ENV || "production";
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

if (!ACCESS_TOKEN || !LOCATION_ID) {
  console.error(
    "❌ Faltan las variables de entorno de Square (ACCESS_TOKEN o LOCATION_ID)"
  );
}

const SQUARE_API =
  NODE_ENV === "production"
    ? "https://connect.squareup.com/v2/payments"
    : "https://connect.squareupsandbox.com/v2/payments";

// --------------------
// 📧 Configuración Nodemailer
// --------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --------------------
// Funciones para enviar emails
// --------------------
async function enviarEmailATienda({ firstName, lastName, email, address, productos, total }) {
  const productosHtml = productos.map(p => `<li>${p.titulo} - Cantidad: ${p.quantity} - Precio: $${p.price}</li>`).join("");

  const mailOptions = {
    from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `Nueva venta de ${firstName} ${lastName}`,
    html: `
      <h3>Detalles de la venta</h3>
      <p><strong>Cliente:</strong> ${firstName} ${lastName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Dirección de envío:</strong> ${address}</p>
      <p><strong>Total:</strong> $${total.toFixed(2)}</p>
      <h4>Productos:</h4>
      <ul>${productosHtml}</ul>
    `
  };

  return transporter.sendMail(mailOptions);
}

async function enviarEmailACliente({ firstName, lastName, email, productos, total, trackingId }) {
  const productosHtml = productos.map(p => `<li>${p.titulo} - Cantidad: ${p.quantity} - Precio: $${p.price}</li>`).join("");

  const mailOptions = {
    from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Confirmación de tu compra - LaTRONIC Store`,
    html: `
      <h3>Gracias por tu compra, ${firstName} ${lastName}!</h3>
      <p>Hemos recibido tu pago de <strong>$${total.toFixed(2)}</strong>.</p>
      <p>Tu número de seguimiento es: <strong>${trackingId}</strong></p>
      <h4>Productos comprados:</h4>
      <ul>${productosHtml}</ul>
      <p>En breve recibirás actualizaciones sobre tu envío.</p>
    `
  };

  return transporter.sendMail(mailOptions);
}

// --------------------
// 🛍️ ENDPOINTS Productos
// --------------------
app.get("/api/productos", async (req, res) => {
  await db.read();
  res.json(db.data.productos);
});

app.get("/api/productos/:id", async (req, res) => {
  await db.read();
  const producto = db.data.productos.find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(producto);
});

app.post("/api/productos", async (req, res) => {
  await db.read();
  const nuevo = req.body;
  if (!nuevo.id) nuevo.id = "prod-" + Date.now();
  db.data.productos.push(nuevo);
  await db.write();
  res.status(201).json(nuevo);
});

app.put("/api/productos/:id", async (req, res) => {
  await db.read();
  const index = db.data.productos.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Producto no encontrado" });
  db.data.productos[index] = { ...db.data.productos[index], ...req.body };
  await db.write();
  res.json(db.data.productos[index]);
});

app.delete("/api/productos/:id", async (req, res) => {
  await db.read();
  db.data.productos = db.data.productos.filter(p => p.id !== req.params.id);
  await db.write();
  res.json({ success: true });
});

// --------------------
// 📦 ENDPOINT: Stock
// --------------------
app.post("/api/stock", async (req, res) => {
  const { id, cantidad } = req.body;
  if (!id || typeof cantidad !== "number") return res.status(400).json({ error: "Datos inválidos" });

  await db.read();
  const producto = db.data.productos.find(p => p.id === id);
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  if (producto.stock < cantidad) return res.status(400).json({ error: "Stock insuficiente" });

  producto.stock -= cantidad;
  await db.write();
  res.json({ message: "Stock actualizado", producto });
});

// --------------------
// 🛒 ENDPOINT: Checkout
// --------------------
app.post("/api/cart/checkout", async (req, res) => {
  try {
    const { productos } = req.body;
    if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: "Carrito vacío o datos inválidos" });

    await db.read();
    for (const item of productos) {
      const prod = db.data.productos.find(p => p.id === item.id);
      if (!prod || prod.stock < item.quantity) return res.status(400).json({ error: `Stock insuficiente para ${item.id}` });
    }

    for (const item of productos) {
      const prod = db.data.productos.find(p => p.id === item.id);
      prod.stock -= item.quantity;
    }

    await db.write();
    res.json({ success: true, message: "Stock actualizado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en checkout" });
  }
});

// --------------------
// 💰 ENDPOINT: Pagos Square + Envío de emails
// --------------------
app.post("/process-payment", async (req, res) => {
  try {
    const { sourceId, total, email, address, firstName, lastName, productos } = req.body;
    if (!sourceId || !total || !email) return res.status(400).json({ error: "Datos de pago incompletos" });

    const amountCents = Math.round(Number(total) * 100);

    const response = await fetch(SQUARE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: LOCATION_ID
      })
    });

    const data = await response.json();

    if (data?.payment?.status === "COMPLETED") {
      await db.read();
      for (const p of productos || []) {
        const item = db.data.productos.find(x => x.id === p.id);
        if (item) item.stock = Math.max(0, item.stock - (p.quantity || 1));
      }
      await db.write();

      const trackingId = "LT-" + crypto.randomBytes(4).toString("hex").toUpperCase();

      // Emails
      await enviarEmailATienda({ firstName, lastName, email, address, productos, total })
        .then(() => console.log("✅ Email a tienda enviado"))
        .catch(err => console.error("⚠️ Error enviando email a tienda:", err));

      await enviarEmailACliente({ firstName, lastName, email, productos, total, trackingId })
        .then(() => console.log("✅ Email a cliente enviado"))
        .catch(err => console.error("⚠️ Error enviando email a cliente:", err));

      res.json({ success: true, payment: data.payment, trackingId });
    } else {
      console.error("❌ Error en respuesta de Square:", data);
      res.status(500).json({ error: data.errors || "Pago no completado" });
    }

  } catch (err) {
    console.error("❌ Error en /process-payment:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// 🌐 Servir frontend
// --------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --------------------
// 🚀 Iniciar servidor
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT} - Modo: ${NODE_ENV}`);
});
