// --------------------
// 📦 Importaciones
// --------------------
import express from "express";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import crypto from "crypto";
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

// --------------------
// ⚙️ Configuración básica
// --------------------
dotenv.config();
const app = express();
const __dirname = process.cwd();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Permitir CORS (para admin.html y shop.html desde cualquier origen)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// --------------------
// 🗝️ Base de datos (lowdb)
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
const NODE_ENV = process.env.NODE_ENV || "sandbox";
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

const SQUARE_API =
  NODE_ENV === "production"
    ? "https://connect.squareup.com/v2/payments"
    : "https://connect.squareupsandbox.com/v2/payments";

// --------------------
// 🛍️ ENDPOINT: Productos
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
  if (!id || typeof cantidad !== "number") {
    return res.status(400).json({ error: "Datos inválidos" });
  }

  await db.read();
  const producto = db.data.productos.find(p => p.id === id);
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  if (producto.stock < cantidad) {
    return res.status(400).json({ error: "Stock insuficiente" });
  }

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
    if (!productos || !Array.isArray(productos)) {
      return res.status(400).json({ error: "Carrito vacío o datos inválidos" });
    }

    await db.read();

    for (const item of productos) {
      const prod = db.data.productos.find(p => p.id === item.id);
      if (!prod || prod.stock < item.quantity) {
        return res.status(400).json({ error: `Stock insuficiente para ${item.id}` });
      }
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
// 💰 ENDPOINT: Pagos Square
// --------------------
app.post("/process-payment", async (req, res) => {
  try {
    const { sourceId, total, email, address, firstName, lastName, productos } = req.body;

    if (!sourceId || !total) {
      return res.status(400).json({ error: "Datos de pago incompletos" });
    }

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
        location_id: LOCATION_ID,
      }),
    });

    const data = await response.json();

    if (data.payment && data.payment.status === "COMPLETED") {
      await db.read();
      for (const p of productos || []) {
        const item = db.data.productos.find(x => x.id === p.id);
        if (item) item.stock = Math.max(0, item.stock - (p.quantity || 1));
      }
      await db.write();
      res.json({ success: true, payment: data.payment });
    } else {
      res.status(500).json({ error: data.errors || "Pago no completado" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// 🌐 Servir frontend (si lo subes junto a Render)
// --------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --------------------
// 🚀 Iniciar servidor
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});
