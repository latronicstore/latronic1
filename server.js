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

// Obtener todos los productos
app.get("/api/productos", async (req, res) => {
  await db.read();
  res.json(db.data.productos);
});

// Obtener producto por ID
app.get("/api/productos/:id", async (req, res) => {
  await db.read();
  const producto = db.data.productos.find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(producto);
});

// Agregar producto nuevo
app.post("/api/productos", async (req, res) => {
  await db.read();
  const nuevoProducto = req.body;
  db.data.productos.push(nuevoProducto);
  await db.write();
  res.json(nuevoProducto);
});

// Actualizar producto
app.put("/api/productos/:id", async (req, res) => {
  await db.read();
  const index = db.data.productos.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Producto no encontrado" });

  db.data.productos[index] = { ...db.data.productos[index], ...req.body };
  await db.write();
  res.json(db.data.productos[index]);
});

// Eliminar producto
app.delete("/api/productos/:id", async (req, res) => {
  await db.read();
  db.data.productos = db.data.productos.filter(p => p.id !== req.params.id);
  await db.write();
  res.json({ success: true });
});

// --------------------
// 📌 ENDPOINT: Stock de productos
// --------------------

// Obtener stock de un producto
app.get("/api/stock/:id", async (req, res) => {
  await db.read();
  const producto = db.data.productos.find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
  res.json({ id: producto.id, stock: producto.stock });
});

// Actualizar stock manualmente (restar cantidad)
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
      // --------------------
      // 📌 Reducir stock automáticamente
      // --------------------
      await db.read();
      for (const p of productos || []) {
        const prodDB = db.data.productos.find(item => item.id === p.id);
        if (prodDB && typeof p.quantity === "number") {
          prodDB.stock = Math.max(0, prodDB.stock - p.quantity);
        }
      }
      await db.write();

      // --------------------
      // 📌 Enviar email de venta
      // --------------------
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
app.post("/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Faltan datos del formulario" });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"LaTRONIC Contact" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: "📨 Nuevo mensaje desde Contact Form",
      text: `
👤 Nombre: ${name}
📧 Email: ${email}

📝 Mensaje:
${message}
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("📩 Email de contacto enviado correctamente");

    res.json({ success: true, message: "Mensaje enviado correctamente" });

  } catch (err) {
    console.error("❌ Error en contacto:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// 📌 Rutas frontend
// --------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "Home.html"));
});

app.get("/card-charge", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "card-charge.html"));
});

// --------------------
// 📌 Iniciar servidor
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT} - Entorno: ${NODE_ENV}`);
});
