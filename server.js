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
import multer from "multer";
import pkg from "pg";

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
// 🗄️ Configuración de uploads con multer
// --------------------
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });
app.use("/uploads", express.static(uploadsDir));

// --------------------
// 🔌 Servidor HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://latronic1.onrender.com",
      "https://www.latronicstore.com"
    ]
  }
});

io.on("connection", (socket) => {
  console.log("✅ Cliente conectado:", socket.id);

  socket.on("disconnect", () => {
    console.log("❌ Cliente desconectado:", socket.id);
  });
});


// --------------------
// 🗝️ Conexión a PostgreSQL
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // obligatorio en Render
});

// --------------------
// 🗝️ Funciones para manejar DB en PostgreSQL
async function leerProductos() {
  const res = await pool.query("SELECT * FROM productos ORDER BY id ASC");
  return res.rows;
}

async function guardarProducto(nuevo) {
  const { id, titulo, description, price, stock, categoria, imagenes } = nuevo;
  const query = `
    INSERT INTO productos (id, titulo, description, price, stock, categoria, imagenes)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *`;
  const values = [
    id,
    titulo,
    description,
    price,
    stock,
    JSON.stringify(categoria),
    JSON.stringify(imagenes || [])  
  ];
  const res = await pool.query(query, values);
  return res.rows[0];
}


async function actualizarProducto(id, datos) {
  const keys = Object.keys(datos);
  const values = Object.values(datos).map(v => {
    // si es array u objeto, convertir a JSON válido
    if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
    return v;
  });
  const setString = keys.map((k,i) => `${k}=$${i+1}`).join(", ");
  const query = `UPDATE productos SET ${setString} WHERE id=$${keys.length+1} RETURNING *`;
  const res = await pool.query(query, [...values, id]);
  return res.rows[0];
}


async function eliminarProducto(id) {
  await pool.query("DELETE FROM productos WHERE id=$1", [id]);
}

// --------------------
// 💳 Configuración Square (sin cambios)
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
// 📧 Configuración Nodemailer (sin cambios)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --------------------
// ✨ Plantillas HTML y funciones de email (sin cambios)
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
    <p>Hola <b>${firstName} ${lastName}</b>, tu pago de <b>$${total.toFixed(2)}</b> fue procesado correctamente.</p>
    <p>Tu número de seguimiento es: <b>${trackingId}</b></p>
    <h4>Productos comprados:</h4>
    <table style="width:100%;border-collapse:collapse;">${productosHtml}</table>
  </div>`;
}

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
    subject: `💳 Confirmación de compra - LaTRONIC Store`,
    html: plantillaEmailCliente(datos)
  });
}

// --------------------
// 📨 Endpoint Contact / Ofertas (sin cambios)
app.post("/api/send-offer", async (req, res) => {
  try {
    const { email, oferta, producto } = req.body;
    if (!email || !oferta || !producto) return res.status(400).json({ success: false, error: "Missing data" });

    const mailOptionsCliente = {
      from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `🎁 LaTRONIC Special Offer`,
      html: `<div style="font-family: sans-serif; padding: 20px; background: #fafafa;">
        <h2>Offer for you ✅</h2>
        <p><b>Product:</b> ${producto}</p>
        <p><b>Offer: $</b> ${oferta}</p>
        <p>¡Thank you for choosing LaTRONIC Store!</p>
      </div>`
    };

    const mailOptionsAdmin = {
      from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `🎁 Offer sent to ${email}`,
      html: `<div style="font-family: sans-serif; padding: 20px; background: #f9f9f9;">
        <h2>Offer sent</h2>
        <p><b>Client:</b> ${email}</p>
        <p><b>Product:</b> ${producto}</p>
        <p><b>Offer: $</b> ${oferta}</p>
      </div>`
    };

    await transporter.sendMail(mailOptionsCliente);
    await transporter.sendMail(mailOptionsAdmin);

    console.log(`✅ Offer sent to ${email} About ${producto}`);
    res.json({ success: true, message: "Offer sent ✅" });
  } catch (err) {
    console.error("❌ Error sending offer:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// --------------------
// 🖼️ Endpoint subir imágenes (sin cambios)
app.post("/api/subir-imagenes", upload.array("imagenes"), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ urls: [] });
    const urls = req.files.map(file => `/uploads/${file.filename}`);
    console.log("✅ Imágenes subidas:", urls);
    res.json({ urls });
  } catch (err) {
    console.error("❌ Error subiendo imágenes:", err);
    res.status(500).json({ urls: [] });
  }
});

// --------------------
// 🛍️ ENDPOINTS Productos usando PostgreSQL
app.get("/api/productos", async (req, res) => {
  const productos = await leerProductos();
  res.json(productos);
});

app.get("/api/productos/:id", async (req, res) => {
  const productos = await leerProductos();
  const producto = productos.find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: "Product not found" });
  res.json(producto);
});

app.post("/api/productos", async (req, res) => {
  const nuevo = req.body;
  if (!nuevo.id) nuevo.id = "prod-" + Date.now();
  const producto = await guardarProducto(nuevo);
  io.emit("actualizar-productos", await leerProductos());
  res.status(201).json(producto);
});

app.put("/api/productos/:id", async (req, res) => {
  const actualizado = await actualizarProducto(req.params.id, req.body);
  io.emit("actualizar-productos", await leerProductos());
  res.json(actualizado);
});

app.delete("/api/productos/:id", async (req, res) => {
  await eliminarProducto(req.params.id);
  io.emit("actualizar-productos", await leerProductos());
  res.json({ success: true });
});

// --------------------
// 💰 Pagos Square (sin cambios)
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
      const productosDB = await leerProductos();
      carrito?.forEach(p => {
        const item = productosDB.find(x => x.id === p.id);
        if (item) item.stock = Math.max(0, item.stock - (p.quantity || 1));
      });

      // Actualizar stock en DB
      for (const p of carrito) {
        const item = productosDB.find(x => x.id === p.id);
        if (item) await actualizarProducto(item.id, { stock: item.stock });
      }

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
