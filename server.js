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
import fs from "fs";
import { Server } from "socket.io";
import http from "http";
import cors from "cors";

// --------------------
// ⚙️ Configuración básica
// --------------------
dotenv.config();
const app = express();
const __dirname = process.cwd();

// --- Configuración CORS ---
const whitelist = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://latronic1.onrender.com",
  "https://www.latronicstore.com"
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (whitelist.includes(origin)) return callback(null, true);
    callback(new Error("No permitido por CORS"));
  }
};

app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// --------------------
// 🔌 Servidor HTTP + Socket.IO
// --------------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", socket => {
  console.log("Cliente conectado:", socket.id);
  socket.on("productos-actualizados", data => socket.broadcast.emit("actualizar-productos", data));
  socket.on("disconnect", () => console.log("Cliente desconectado:", socket.id));
});

// --------------------
// 🗝️ Base de datos (LowDB v5)
// --------------------
const isRender = process.env.RENDER === "true";
const dbFile = isRender ? "/data/db.json" : path.join(__dirname, "public", "db.json");

// Crear carpeta si no existe
if (!fs.existsSync(path.dirname(dbFile))) fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

await db.read();
if (!db.data) db.data = {};
if (!db.data.productos) db.data.productos = [];

// Cargar productos iniciales si DB vacía
if (db.data.productos.length === 0) {
  const initialFile = path.join(__dirname, "public", "db.json");
  if (fs.existsSync(initialFile)) {
    const initialData = JSON.parse(fs.readFileSync(initialFile, "utf-8"));
    db.data.productos = initialData.productos || [];
    await db.write();
  }
}

// --------------------
// 💳 Configuración Square
// --------------------
const NODE_ENV = process.env.NODE_ENV || "production";
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

if (!ACCESS_TOKEN || !LOCATION_ID) {
  console.error("❌ Faltan las variables de entorno de Square (ACCESS_TOKEN o LOCATION_ID)");
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
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --------------------
// ✨ Plantillas HTML
// --------------------
function plantillaEmailTienda({ firstName, lastName, email, address, productos, total }) {
  const productosHtml = productos.map(
    p => `<tr>
      <td style="padding:8px;border-bottom:1px solid #ddd;">${p.titulo}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;">${p.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;">$${p.price}</td>
    </tr>`).join("");

  return `<div style="font-family:'Segoe UI',sans-serif;background:#fafafa;padding:20px;color:#333;">
    <div style="background:#222;color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center;">
      <h2>🛍️ Nueva Venta - LaTRONIC Store</h2>
    </div>
    <div style="background:#fff;padding:20px;border-radius:0 0 10px 10px;">
      <p><strong>Cliente:</strong> ${firstName} ${lastName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Dirección:</strong> ${address}</p>
      <p><strong>Total:</strong> $${total.toFixed(2)}</p>
      <h4 style="margin-top:20px;">Productos:</h4>
      <table style="width:100%;border-collapse:collapse;">${productosHtml}</table>
    </div>
  </div>`;
}

function plantillaEmailCliente({ firstName, lastName, productos, total, trackingId }) {
  const productosHtml = productos.map(
    p => `<tr>
      <td style="padding:8px;border-bottom:1px solid #ddd;">${p.titulo}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;">${p.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;">$${p.price}</td>
    </tr>`).join("");

  return `<div style="font-family:'Segoe UI',sans-serif;background:#f6f6f6;padding:20px;color:#333;">
    <div style="background:#e64a19;color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center;">
      <h2>Gracias por tu compra 🧡</h2>
    </div>
    <div style="background:#fff;padding:25px;border-radius:0 0 10px 10px;">
      <p>Hola <strong>${firstName} ${lastName}</strong>,</p>
      <p>Tu pago de <strong>$${total.toFixed(2)}</strong> fue procesado exitosamente.</p>
      <p>Tu número de seguimiento es: <strong>${trackingId}</strong></p>
      <h4 style="margin-top:20px;">Productos comprados:</h4>
      <table style="width:100%;border-collapse:collapse;">${productosHtml}</table>
    </div>
  </div>`;
}

// --------------------
// Funciones de envío
async function enviarEmailATienda(datos) {
  return transporter.sendMail({
    from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `🛒 Nueva venta de ${datos.firstName} ${datos.lastName}`,
    html: plantillaEmailTienda(datos)
  });
}

async function enviarEmailACliente(datos) {
  return transporter.sendMail({
    from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
    to: datos.email,
    subject: `💳 Confirmación de tu compra - LaTRONIC Store`,
    html: plantillaEmailCliente(datos)
  });
}

// --------------------
// 🛍️ ENDPOINTS Productos
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
  io.emit("actualizar-productos", db.data.productos);
  res.status(201).json(nuevo);
});

app.put("/api/productos/:id", async (req, res) => {
  await db.read();
  const index = db.data.productos.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Producto no encontrado" });
  db.data.productos[index] = { ...db.data.productos[index], ...req.body };
  await db.write();
  io.emit("actualizar-productos", db.data.productos);
  res.json(db.data.productos[index]);
});

app.delete("/api/productos/:id", async (req, res) => {
  await db.read();
  db.data.productos = db.data.productos.filter(p => p.id !== req.params.id);
  await db.write();
  io.emit("actualizar-productos", db.data.productos);
  res.json({ success: true });
});

// --------------------
// 🛒 Checkout y Pagos Square
app.post("/process-payment", async (req, res) => {
  try {
    const { sourceId, total, email, address, firstName, lastName, productos } = req.body;
    if (!sourceId || !total || !email)
      return res.status(400).json({ error: "Datos de pago incompletos" });

    const amountCents = Math.round(Number(total) * 100);
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
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: LOCATION_ID
      })
    });

    const data = await response.json();

    if (data?.payment?.status === "COMPLETED") {
      await db.read();
      for (const p of productos) {
        const item = db.data.productos.find(x => x.id === p.id);
        if (item) item.stock = Math.max(0, item.stock - (p.quantity || 1));
      }
      await db.write();

      const trackingId = "LT-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      await enviarEmailATienda({ firstName, lastName, email, address, productos, total });
      await enviarEmailACliente({ firstName, lastName, email, productos, total, trackingId });

      res.json({ success: true, payment: data.payment, trackingId });
    } else {
      res.status(500).json({ error: data.errors || "Pago no completado" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// 🌐 Servir frontend
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// --------------------
// 🚀 Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
