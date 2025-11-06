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

// Leer productos
function leerProductos() {
  if (!fs.existsSync(dbPath)) return [];
  const data = fs.readFileSync(dbPath, "utf-8");
  try {
    return JSON.parse(data).productos || [];
  } catch (e) {
    return [];
  }
}

// Guardar productos
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
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --------------------
// ✨ Plantillas HTML (idénticas a las tuyas)
function plantillaEmailTienda({ firstName, lastName, email, address, productos, total }) {
  const productosHtml = productos.map(p => `<tr>
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
  const productosHtml = productos.map(p => `<tr>
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
  const mailOptions = {
    from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `🛒 Nueva venta de ${datos.firstName} ${datos.lastName}`,
    html: plantillaEmailTienda(datos)
  };
  return transporter.sendMail(mailOptions);
}

async function enviarEmailACliente(datos) {
  const mailOptions = {
    from: `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,
    to: datos.email,
    subject: `💳 Confirmación de tu compra - LaTRONIC Store`,
    html: plantillaEmailCliente(datos)
  };
  return transporter.sendMail(mailOptions);
}

// --------------------
// 🛍️ ENDPOINTS Productos
app.get("/api/productos", (req, res) => {
  const productos = leerProductos();
  res.json(productos);
});

app.get("/api/productos/:id", (req, res) => {
  const productos = leerProductos();
  const producto = productos.find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
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
  if (index === -1) return res.status(404).json({ error: "Producto no encontrado" });
  productos[index] = { ...productos[index], ...req.body };
  guardarProductos(productos);
  io.emit("actualizar-productos", productos);
  res.json(productos[index]);
});

app.delete("/api/productos/:id", (req, res) => {
  let productos = leerProductos();
  productos = productos.filter(p => p.id !== req.params.id);
  guardarProductos(productos);
  io.emit("actualizar-productos", productos);
  res.json({ success: true });
});

// --------------------
// 🛒 Checkout (actualizar stock)
app.post("/api/cart/checkout", (req, res) => {
  const { productos: carrito } = req.body;
  if (!carrito || !Array.isArray(carrito)) return res.status(400).json({ error: "Carrito vacío o datos inválidos" });

  const productos = leerProductos();
  for (const item of carrito) {
    const prod = productos.find(p => p.id === item.id);
    if (!prod || prod.stock < item.quantity) return res.status(400).json({ error: `Stock insuficiente para ${item.id}` });
  }

  for (const item of carrito) {
    const prod = productos.find(p => p.id === item.id);
    prod.stock -= item.quantity;
  }

  guardarProductos(productos);
  res.json({ success: true, message: "Stock actualizado correctamente" });
});

// --------------------
// 💰 Pagos Square
app.post("/process-payment", async (req, res) => {
  try {
    const { sourceId, total, email, address, firstName, lastName, productos: carrito } = req.body;
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
      const productosDB = leerProductos();
      for (const p of carrito || []) {
        const item = productosDB.find(x => x.id === p.id);
        if (item) item.stock = Math.max(0, item.stock - (p.quantity || 1));
      }
      guardarProductos(productosDB);

      const trackingId = "LT-" + crypto.randomBytes(4).toString("hex").toUpperCase();

      await enviarEmailATienda({ firstName, lastName, email, address, productos: carrito, total }).catch(console.error);
      await enviarEmailACliente({ firstName, lastName, email, productos: carrito, total, trackingId }).catch(console.error);

      res.json({ success: true, payment: data.payment, trackingId });
    } else {
      console.error("Error Square:", data);
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
server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT} - Modo: ${NODE_ENV}`);
});
