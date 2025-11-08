// --------------------
// 📦 Importaciones
// --------------------
import express from "express";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import crypto from "crypto";
import fetch from "node-fetch";
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

app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://latronic1.onrender.com",
    "https://www.latronicstore.com"
  ]
}));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// --------------------
// 🔌 Servidor HTTP + Socket.IO
// --------------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", socket => {
  console.log("Cliente conectado:", socket.id);
  socket.on("productos-actualizados", data => {
    socket.broadcast.emit("actualizar-productos", data);
  });
  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

// --------------------
// 🗝️ Funciones para manejar DB (JSON directo)
const dbPath = path.join(__dirname, "public", "db.json");

function leerProductos() {
  if (!fs.existsSync(dbPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf-8")).productos || [];
  } catch {
    return [];
  }
}

function guardarProductos(productos) {
  fs.writeFileSync(dbPath, JSON.stringify({ productos }, null, 2));
}

// --------------------
// 💳 Configuración Square
const NODE_ENV = process.env.NODE_ENV || "production";
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const SQUARE_API =
  NODE_ENV === "production"
    ? "https://connect.squareup.com/v2/payments"
    : "https://connect.squareupsandbox.com/v2/payments";

if (!ACCESS_TOKEN || !LOCATION_ID) {
  console.error("❌ Faltan las variables de entorno de Square (ACCESS_TOKEN o LOCATION_ID)");
}

// --------------------
// 📧 Configuración Nodemailer
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --------------------
// ✨ Plantillas HTML
function plantillaEmailTienda({ firstName, lastName, email, address, productos, total }) {
  const productosHtml = productos.map(p => `<tr><td>${p.titulo}</td><td>${p.quantity}</td><td>$${p.price}</td></tr>`).join("");
  return `<div style="font-family:'Segoe UI',sans-serif;background:#fafafa;padding:20px;">
    <h2>🛍️ Nueva Venta - LaTRONIC Store</h2>
    <p><b>Cliente:</b> ${firstName} ${lastName}</p>
    <p><b>Email:</b> ${email}</p>
    <p><b>Dirección:</b> ${address}</p>
    <p><b>Total:</b> $${total.toFixed(2)}</p>
    <h4>Productos:</h4>
    <table style="width:100%;border-collapse:collapse;">${productosHtml}</table>
  </div>`;
}

function plantillaEmailCliente({ firstName, lastName, productos, total, trackingId }) {
  const productosHtml = productos.map(p => `<tr><td>${p.titulo}</td><td>${p.quantity}</td><td>$${p.price}</td></tr>`).join("");
  return `<div style="font-family:'Segoe UI',sans-serif;background:#f6f6f6;padding:20px;">
    <h2>Gracias por tu compra 🧡</h2>
    <p>Hola <b>${firstName} ${lastName}</b>, tu pago de <b>$${total.toFixed(2)}</b>"It was processed successfully."</p>
    <p>Tu número de seguimiento es: <b>${trackingId}</b></p>
    <h4>Productos comprados:</h4>
    <table style="width:100%;border-collapse:collapse;">${productosHtml}</table>
  </div>`;
}

// --------------------
// ✉️ Funciones de envío de email
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
    subject: `💳"Purchase confirmation" - LaTRONIC Store`,
    html: plantillaEmailCliente(datos)
  });
}

// --------------------
// 📨 Endpoint Contact Us (Nodemailer + EmailJS opcional)
// --------------------
// 📩 Enviar ofertas a clientes
// --------------------
app.post("/api/send-offer", async (req, res) => {
  try {
    const { email, oferta, producto } = req.body; // Recibimos email, oferta y producto

    if (!email || !oferta || !producto) {
      return res.status(400).json({ success: false, error: "Missing data: email, offer, or product" });
    }

    // Email para el cliente
    const mailOptionsCliente = {
      from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `🎁 LaTRONIC Special Offer`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background: #fafafa;">
          <h2>Offer for you ✅</h2>
          <p><b>Product:</b> ${producto}</p>
          <p><b>Offer:</b> ${oferta}</p>
          <p>¡"Thank you for choosing LaTRONIC Store!"</p>
        </div>
      `
    };

    // Opcional: Email para ti (admin) notificando que se envió la oferta
    const mailOptionsAdmin = {
      from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `🎁 Offer sent to ${email}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background: #f9f9f9;">
          <h2>Offer sent</h2>
          <p><b>Client:</b> ${email}</p>
          <p><b>Product:</b> ${producto}</p>
          <p><b>Offer:</b> ${oferta}</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptionsCliente);
    await transporter.sendMail(mailOptionsAdmin);

    console.log(`✅ Offer sent to ${email} About ${producto}`);
    res.json({ success: true, message: "Payment not completed" });

  } catch (err) {
    console.error("❌ Error sending offer:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// --------------------
// 🛍️ ENDPOINTS Productos
app.get("/api/productos", (req, res) => res.json(leerProductos()));
app.get("/api/productos/:id", (req, res) => {
  const producto = leerProductos().find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: "Product not found" });
  res.json(producto);
});
app.post("/api/productos", (req, res) => {
  const productos = leerProductos();
  const nuevo = req.body;
  if (!nuevo.id) nuevo.id = "prod-" + Date.now();
  productos.push(nuevo);
  guardarProductos(productos);
  io.emit("actualizar-productos", productos);
  res.status(201).json(nuevo);
});
app.put("/api/productos/:id", (req, res) => {
  const productos = leerProductos();
  const index = productos.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Product not found"});
  productos[index] = { ...productos[index], ...req.body };
  guardarProductos(productos);
  io.emit("actualizar-productos", productos);
  res.json(productos[index]);
});
app.delete("/api/productos/:id", (req, res) => {
  const productos = leerProductos().filter(p => p.id !== req.params.id);
  guardarProductos(productos);
  io.emit("actualizar-productos", productos);
  res.json({ success: true });
});

// --------------------
// 💰 Pagos Square
app.post("/process-payment", async (req, res) => {
  try {
    const { sourceId, total, email, address, firstName, lastName, productos: carrito } = req.body;
    if (!sourceId || !total || !email) return res.status(400).json({ error: "Incomplete payment details" });

    const amountCents = Math.round(Number(total) * 100);
    const response = await fetch(SQUARE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: LOCATION_ID
      })
    });
    const data = await response.json();

    if (data?.payment?.status === "COMPLETED") {
      const productosDB = leerProductos();
      carrito?.forEach(p => {
        const item = productosDB.find(x => x.id === p.id);
        if (item) item.stock = Math.max(0, item.stock - (p.quantity || 1));
      });
      guardarProductos(productosDB);

      const trackingId = "LT-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      await enviarEmailATienda({ firstName, lastName, email, address, productos: carrito, total });
      await enviarEmailACliente({ firstName, lastName, email, productos: carrito, total, trackingId });

      res.json({ success: true, payment: data.payment, trackingId });
    } else {
      res.status(500).json({ error: data.errors || "Payment not completed" });
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
server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT} - Modo: ${NODE_ENV}`);
});
