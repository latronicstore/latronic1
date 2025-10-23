// --------------------
// 📌 Importaciones
// --------------------
import express from "express";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import crypto from "crypto";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

// Para manejar db.json con lowdb
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

// --------------------
// 📌 Configuración
// --------------------
dotenv.config();
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(process.cwd(), "public")));

// --------------------
// 📌 Middleware de autenticación básica para admin
// --------------------
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader("WWW-Authenticate", "Basic");
    return res.status(401).send("Autenticación requerida");
  }

  const [scheme, encoded] = authHeader.split(" ");
  if (scheme !== "Basic") return res.status(400).send("Formato inválido");

  const decoded = Buffer.from(encoded, "base64").toString();
  const [user, pass] = decoded.split(":");

  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) {
    return next();
  }

  res.setHeader("WWW-Authenticate", "Basic");
  return res.status(401).send("Usuario o contraseña incorrectos");
}

// --------------------
// 📌 Base de datos (lowdb con db.json)
// --------------------
const dbFile = path.join(process.cwd(), "db.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { productos: [] });

// Inicializar DB si está vacía
await db.read();
db.data ||= { productos: [] };
await db.write();

// --------------------
// 📌 Configuración Square
// --------------------
const NODE_ENV = process.env.NODE_ENV || "sandbox";
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

const SQUARE_API =
  NODE_ENV === "production"
    ? "https://connect.squareup.com/v2/payments"
    : "https://connect.squareupsandbox.com/v2/payments";

// --------------------
// 📌 ENDPOINT: Productos
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
  const nuevoProducto = req.body;
  db.data.productos.push(nuevoProducto);
  await db.write();
  res.json(nuevoProducto);
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
// 📌 ENDPOINT: Stock de productos
// --------------------
app.get("/api/stock/:id", async (req, res) => {
  await db.read();
  const producto = db.data.productos.find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
  res.json({ id: producto.id, stock: producto.stock });
});

app.post("/api/stock", async (req, res) => {
  const { id, cantidad } = req.body;

  if (!id || typeof cantidad !== "number") {
    return res.status(400).json({ error: "Faltan datos o son inválidos" });
  }

  await db.read();
  const producto = db.data.productos.find(p => p.id === id);

  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  if (producto.stock < cantidad) {
    return res.status(400).json({ error: "No hay suficiente stock" });
  }

  producto.stock -= cantidad;
  await db.write();

  res.json({ message: "Stock actualizado", producto });
});

// --------------------
// 📌 ENDPOINT: Carrito (nuevo fragmento agregado)
// --------------------
app.post("/api/cart/checkout", async (req, res) => {
  try {
    const { productos } = req.body;
    if (!productos || !Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: "Carrito vacío o datos inválidos" });
    }

    await db.read();

    // Validar stock
    const erroresStock = [];
    for (const item of productos) {
      const prodDB = db.data.productos.find(p => p.id === item.id);
      if (!prodDB) {
        erroresStock.push(`Producto ${item.id} no encontrado`);
      } else if (prodDB.stock < item.quantity) {
        erroresStock.push(`Stock insuficiente para ${prodDB.titulo}`);
      }
    }

    if (erroresStock.length > 0) {
      return res.status(400).json({ error: erroresStock });
    }

    // Reducir stock
    for (const item of productos) {
      const prodDB = db.data.productos.find(p => p.id === item.id);
      prodDB.stock -= item.quantity;
    }

    await db.write();

    res.json({ success: true, message: "Compra realizada y stock actualizado" });
  } catch (err) {
    console.error("❌ Error en checkout:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// 📌 ENDPOINT: Procesar pagos
// --------------------
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
      // Reducir stock automáticamente
      await db.read();
      for (const p of productos || []) {
        const prodDB = db.data.productos.find(item => item.id === p.id);
        if (prodDB && typeof p.quantity === "number") {
          prodDB.stock = Math.max(0, prodDB.stock - p.quantity);
        }
      }
      await db.write();

      // Enviar email de venta
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
      console.log("📩 Email de venta enviado correctamente");

      res.json({ payment: data.payment });
    } else {
      res.status(500).json({ error: data.errors || "Payment not completed" });
    }

  } catch (err) {
    console.error("❌ Error en el pago:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// 📌 ENDPOINT: Contacto (formulario About/Contact)
// --------------------
// ... aquí queda igual, no se toca

// --------------------
// 📌 Rutas frontend
// --------------------
// ... aquí queda igual

// --------------------
// 📌 Página admin protegida
// --------------------
// ... aquí queda igual

// --------------------
// 📌 Iniciar servidor
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT} - Entorno: ${NODE_ENV}`);
});
