// ============================================================
// LaTRONIC SERVER
// Node.js + Express + PostgreSQL + Socket.IO + Square
// ============================================================

import express from "express";
import path from "path";
import dotenv from "dotenv";
import crypto from "crypto";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import fs from "fs";
import { Server } from "socket.io";
import http from "http";
import cors from "cors";
import multer from "multer";
import pkg from "pg";

// ============================================================
// CONFIGURACIÓN
// ============================================================

dotenv.config();

const app = express();
const server = http.createServer(app);

const __dirname = process.cwd();

const PORT = process.env.PORT || 3000;

const NODE_ENV = process.env.NODE_ENV || "production";

// ============================================================
// DOMINIOS PERMITIDOS
// ============================================================

const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://latronic1.onrender.com",
    "https://www.latronicstore.com",
    "https://latronicstore.com"
];

// ============================================================
// CORS
// ============================================================

app.use(
    cors({
        origin: function (origin, callback) {

            // Permitir requests sin origin
            // Ej: Postman, curl, servidor interno
            if (!origin) {
                return callback(null, true);
            }

            if (ALLOWED_ORIGINS.includes(origin)) {
                return callback(null, true);
            }

            console.warn("⚠️ CORS bloqueado:", origin);

            return callback(
                new Error("Not allowed by CORS")
            );
        },

        methods: [
            "GET",
            "POST",
            "PUT",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
    })
);

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json({ limit: "10mb" }));

app.use(
    express.urlencoded({
        extended: true,
        limit: "10mb"
    })
);

// ============================================================
// FRONTEND
// ============================================================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// ============================================================
// PERSISTENT DISK
// ============================================================
//
// Render:
// Persistent Disk Mount Path = /data
//
// Las imágenes se guardarán aquí:
//
// /data/imagen.jpg
//
// Y se podrán acceder desde:
//
// /uploads/imagen.jpg
//
// ============================================================

const UPLOAD_DIR = "/data";

try {

    if (!fs.existsSync(UPLOAD_DIR)) {

        fs.mkdirSync(
            UPLOAD_DIR,
            {
                recursive: true
            }
        );

        console.log(
            "📁 Directorio creado:",
            UPLOAD_DIR
        );
    }

} catch (error) {

    console.error(
        "❌ No se pudo crear /data:",
        error
    );

}

// ============================================================
// SERVIR IMÁGENES
// ============================================================

app.use(
    "/uploads",
    express.static(UPLOAD_DIR, {
        maxAge: "7d",
        etag: true
    })
);

// ============================================================
// MULTER
// ============================================================

const storage = multer.diskStorage({

    destination: (req, file, cb) => {

        cb(null, UPLOAD_DIR);

    },

    filename: (req, file, cb) => {

        const extension =
            path.extname(file.originalname)
                .toLowerCase();

        const uniqueName =
            `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`;

        cb(null, uniqueName);

    }

});

const upload = multer({

    storage,

    limits: {

        files: 30,

        fileSize: 20 * 1024 * 1024

    },

    fileFilter: (req, file, cb) => {

        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif"
        ];

        if (!allowed.includes(file.mimetype)) {

            return cb(
                new Error(
                    "Only image files are allowed."
                )
            );

        }

        cb(null, true);

    }

});

// ============================================================
// SOCKET.IO
// ============================================================

const io = new Server(server, {

    cors: {

        origin: ALLOWED_ORIGINS,

        methods: [
            "GET",
            "POST"
        ]

    }

});

io.on("connection", (socket) => {

    console.log(
        "🟢 Socket conectado:",
        socket.id
    );

    socket.on("disconnect", () => {

        console.log(
            "🔴 Socket desconectado:",
            socket.id
        );

    });

});

// ============================================================
// POSTGRESQL
// ============================================================

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {

    console.error(
        "❌ DATABASE_URL no está configurada."
    );

}

const pool = new Pool({

    connectionString:
        process.env.DATABASE_URL,

    ssl:
        NODE_ENV === "development"
            ? false
            : {
                rejectUnauthorized: false
            },

    max: 10,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000

});

// ============================================================
// TEST DATABASE
// ============================================================

pool.on("error", (err) => {

    console.error(
        "❌ PostgreSQL Pool Error:",
        err
    );

});

// ============================================================
// FUNCIONES DATABASE
// ============================================================

async function leerProductos() {

    const result = await pool.query(
        `
        SELECT *
        FROM productos
        ORDER BY id ASC
        `
    );

    return result.rows;
}

// ============================================================

async function obtenerProducto(id) {

    const result = await pool.query(
        `
        SELECT *
        FROM productos
        WHERE id = $1
        LIMIT 1
        `,
        [id]
    );

    return result.rows[0] || null;
}

// ============================================================

async function guardarProducto(nuevo) {

    const {

        id,
        titulo,
        description,
        price,
        stock,
        categoria,
        imagenes

    } = nuevo;

    const query = `
        INSERT INTO productos
        (
            id,
            titulo,
            description,
            price,
            stock,
            categoria,
            imagenes
        )
        VALUES
        (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
        )
        RETURNING *
    `;

    const values = [

        id,

        titulo || "",

        description || "",

        Number(price) || 0,

        Number(stock) || 0,

        JSON.stringify(
            categoria || {}
        ),

        JSON.stringify(
            imagenes || []
        )

    ];

    const result =
        await pool.query(
            query,
            values
        );

    return result.rows[0];

}

// ============================================================
// COLUMNAS QUE SE PUEDEN ACTUALIZAR
// ============================================================
//
// Esto evita que alguien mande:
//
// { "loquesea": "..." }
//
// y termine creando SQL inválido.
//

const ALLOWED_PRODUCT_FIELDS = [

    "titulo",

    "description",

    "price",

    "stock",

    "categoria",

    "imagenes",

    "tags"

];

// ============================================================

async function actualizarProducto(
    id,
    datos
) {

    const entries =
        Object.entries(datos)
            .filter(
                ([key]) =>
                    ALLOWED_PRODUCT_FIELDS.includes(key)
            );

    if (entries.length === 0) {

        throw new Error(
            "No valid product fields were provided."
        );

    }

    const values = [];

    const sets = [];

    entries.forEach(
        ([key, value], index) => {

            let finalValue = value;

            if (
                key === "price" ||
                key === "stock"
            ) {

                finalValue =
                    Number(value);

            }

            if (
                key === "categoria" ||
                key === "imagenes" ||
                key === "tags"
            ) {

                finalValue =
                    JSON.stringify(
                        value ?? (
                            key === "imagenes"
                                ? []
                                : {}
                        )
                    );

            }

            values.push(finalValue);

            sets.push(
                `"${key}" = $${index + 1}`
            );

        }
    );

    values.push(id);

    const query = `
        UPDATE productos
        SET ${sets.join(", ")}
        WHERE id = $${values.length}
        RETURNING *
    `;

    const result =
        await pool.query(
            query,
            values
        );

    return result.rows[0] || null;

}

// ============================================================

async function eliminarProducto(id) {

    const result =
        await pool.query(
            `
            DELETE FROM productos
            WHERE id = $1
            RETURNING *
            `,
            [id]
        );

    return result.rows[0] || null;

}

// ============================================================
// SQUARE
// ============================================================

const ACCESS_TOKEN =
    process.env.SQUARE_ACCESS_TOKEN;

const LOCATION_ID =
    process.env.SQUARE_LOCATION_ID;

const SQUARE_API =
    NODE_ENV === "production"

        ? "https://connect.squareup.com/v2/payments"

        : "https://connect.squareupsandbox.com/v2/payments";

if (
    !ACCESS_TOKEN ||
    !LOCATION_ID
) {

    console.error(
        "❌ Faltan variables de Square:"
    );

    console.error(
        "SQUARE_ACCESS_TOKEN:",
        ACCESS_TOKEN
            ? "OK"
            : "MISSING"
    );

    console.error(
        "SQUARE_LOCATION_ID:",
        LOCATION_ID
            ? "OK"
            : "MISSING"
    );

}

// ============================================================
// NODEMAILER
// ============================================================

const transporter =
    nodemailer.createTransport({

        host: "smtp.gmail.com",

        port: 465,

        secure: true,

        auth: {

            user:
                process.env.EMAIL_USER,

            pass:
                process.env.EMAIL_PASS

        }

    });

// ============================================================
// PLANTILLA EMAIL TIENDA
// ============================================================

function plantillaEmailTienda({

    firstName,
    lastName,
    email,
    address,
    productos,
    total

}) {

    const productosHtml =
        (productos || [])
            .map(
                (p) => `
                    <tr>
                        <td style="padding:8px;">
                            ${p.titulo || ""}
                        </td>

                        <td style="padding:8px;">
                            ${p.quantity || 0}
                        </td>

                        <td style="padding:8px;">
                            $${Number(p.price || 0).toFixed(2)}
                        </td>
                    </tr>
                `
            )
            .join("");

    return `
        <div
            style="
                font-family:Segoe UI,sans-serif;
                background:#fafafa;
                padding:20px;
            "
        >

            <h2>
                🛍️ Nueva Venta - LaTRONIC Store
            </h2>

            <p>
                <b>Cliente:</b>
                ${firstName || ""} ${lastName || ""}
            </p>

            <p>
                <b>Email:</b>
                ${email || ""}
            </p>

            <p>
                <b>Dirección:</b>
                ${address || ""}
            </p>

            <p>
                <b>Total:</b>
                $${Number(total || 0).toFixed(2)}
            </p>

            <h4>
                Productos:
            </h4>

            <table
                style="
                    width:100%;
                    border-collapse:collapse;
                "
            >

                <thead>
                    <tr>
                        <th align="left">
                            Product
                        </th>

                        <th align="left">
                            Quantity
                        </th>

                        <th align="left">
                            Price
                        </th>
                    </tr>
                </thead>

                <tbody>
                    ${productosHtml}
                </tbody>

            </table>

        </div>
    `;

}

// ============================================================
// PLANTILLA EMAIL CLIENTE
// ============================================================

function plantillaEmailCliente({

    firstName,
    lastName,
    productos,
    total,
    trackingId

}) {

    const productosHtml =
        (productos || [])
            .map(
                (p) => `
                    <tr>

                        <td style="padding:8px;">
                            ${p.titulo || ""}
                        </td>

                        <td style="padding:8px;">
                            ${p.quantity || 0}
                        </td>

                        <td style="padding:8px;">
                            $${Number(p.price || 0).toFixed(2)}
                        </td>

                    </tr>
                `
            )
            .join("");

    return `
        <div
            style="
                font-family:Segoe UI,sans-serif;
                background:#f6f6f6;
                padding:20px;
            "
        >

            <h2>
                Thank you for your purchase
                in LaTRONIC Store 🧡
            </h2>

            <p>
                Hola
                <b>
                    ${firstName || ""} ${lastName || ""}
                </b>,
                tu pago de
                <b>
                    $${Number(total || 0).toFixed(2)}
                </b>
                fue procesado correctamente.
            </p>

            <p>
                Your tracking number is:
                <b>
                    ${trackingId}
                </b>
            </p>

            <h4>
                Purchased products:
            </h4>

            <table
                style="
                    width:100%;
                    border-collapse:collapse;
                "
            >

                <thead>
                    <tr>

                        <th align="left">
                            Product
                        </th>

                        <th align="left">
                            Quantity
                        </th>

                        <th align="left">
                            Price
                        </th>

                    </tr>
                </thead>

                <tbody>
                    ${productosHtml}
                </tbody>

            </table>

        </div>
    `;

}

// ============================================================
// EMAIL TIENDA
// ============================================================

async function enviarEmailATienda(datos) {

    return transporter.sendMail({

        from:
            `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,

        to:
            process.env.ADMIN_EMAIL,

        subject:
            `🛒 New sale of ${datos.firstName || ""} ${datos.lastName || ""}`,

        html:
            plantillaEmailTienda(datos)

    });

}

// ============================================================
// EMAIL CLIENTE
// ============================================================

async function enviarEmailACliente(datos) {

    return transporter.sendMail({

        from:
            `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,

        to:
            datos.email,

        subject:
            "💳 Purchase confirmation - LaTRONIC Store",

        html:
            plantillaEmailCliente(datos)

    });

}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/health", async (req, res) => {

    try {

        await pool.query("SELECT 1");

        res.json({

            success: true,

            server: "LaTRONIC Server",

            database: "connected",

            environment: NODE_ENV,

            timestamp:
                new Date().toISOString()

        });

    } catch (error) {

        console.error(
            "❌ Health check:",
            error
        );

        res.status(500).json({

            success: false,

            server: "LaTRONIC Server",

            database: "error"

        });

    }

});

// ============================================================
// SEND OFFER
// ============================================================

app.post(
    "/api/send-offer",
    async (req, res) => {

        try {

            const {

                email,
                oferta,
                producto

            } = req.body;

            if (
                !email ||
                !oferta ||
                !producto
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Missing data"

                });

            }

            // ================================================
            // EMAIL AL CLIENTE
            // ================================================

            const mailOptionsCliente = {

                from:
                    `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,

                to:
                    email,

                subject:
                    "🎁 LaTRONIC Special Offer",

                html: `
                    <div
                        style="
                            font-family:sans-serif;
                            padding:20px;
                            background:#fafafa;
                        "
                    >

                        <h2>
                            Offer sent ✅
                        </h2>

                        <p>
                            <b>Product:</b>
                            ${producto}
                        </p>

                        <p>
                            <b>Offer:</b>
                            $${oferta}
                        </p>

                        <p>
                            ¡Thank you for choosing
                            LaTRONIC Store!
                        </p>

                    </div>
                `

            };

            // ================================================
            // EMAIL ADMIN
            // ================================================

            const mailOptionsAdmin = {

                from:
                    `"LaTRONIC Store" <${process.env.EMAIL_USER}>`,

                to:
                    process.env.ADMIN_EMAIL,

                subject:
                    `🎁 Offer sent from ${email}`,

                html: `
                    <div
                        style="
                            font-family:sans-serif;
                            padding:20px;
                            background:#f9f9f9;
                        "
                    >

                        <h2>
                            Offer sent
                        </h2>

                        <p>
                            <b>Client:</b>
                            ${email}
                        </p>

                        <p>
                            <b>Product:</b>
                            ${producto}
                        </p>

                        <p>
                            <b>Offer:</b>
                            $${oferta}
                        </p>

                    </div>
                `

            };

            await transporter.sendMail(
                mailOptionsCliente
            );

            await transporter.sendMail(
                mailOptionsAdmin
            );

            console.log(
                `✅ Offer sent from ${email} about ${producto}`
            );

            res.json({

                success: true,

                message:
                    "Offer sent ✅"

            });

        } catch (error) {

            console.error(
                "❌ Error sending offer:",
                error
            );

            res.status(500).json({

                success: false,

                error:
                    "Internal server error"

            });

        }

    }
);

// ============================================================
// SUBIR IMÁGENES
// ============================================================

app.post(
    "/api/subir-imagenes",
    upload.array("imagenes", 30),
    async (req, res) => {

        try {

            if (
                !req.files ||
                req.files.length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    urls: []

                });

            }

            const urls =
                req.files.map(
                    file =>
                        `/uploads/${file.filename}`
                );

            console.log(
                "✅ Imágenes subidas:",
                urls
            );

            res.json({

                success: true,

                urls,

                files:
                    req.files.map(
                        file => ({

                            filename:
                                file.filename,

                            size:
                                file.size,

                            mimetype:
                                file.mimetype,

                            url:
                                `/uploads/${file.filename}`

                        })
                    )

            });

        } catch (error) {

            console.error(
                "❌ Error subiendo imágenes:",
                error
            );

            res.status(500).json({

                success: false,

                urls: [],

                error:
                    error.message

            });

        }

    }
);

// ============================================================
// GET TODOS LOS PRODUCTOS
// ============================================================

app.get(
    "/api/productos",
    async (req, res) => {

        try {

            const productos =
                await leerProductos();

            res.json(productos);

        } catch (error) {

            console.error(
                "❌ Error obteniendo productos:",
                error
            );

            res.status(500).json({

                error:
                    "Error loading products"

            });

        }

    }
);

// ============================================================
// GET PRODUCTO POR ID
// ============================================================

app.get(
    "/api/productos/:id",
    async (req, res) => {

        try {

            const producto =
                await obtenerProducto(
                    req.params.id
                );

            if (!producto) {

                return res.status(404).json({

                    error:
                        "Product not found"

                });

            }

            res.json(producto);

        } catch (error) {

            console.error(
                "❌ Error obteniendo producto:",
                error
            );

            res.status(500).json({

                error:
                    "Error loading product"

            });

        }

    }
);

// ============================================================
// CREAR PRODUCTO
// ============================================================

app.post(
    "/api/productos",
    async (req, res) => {

        try {

            const nuevo = {
                ...req.body
            };

            if (!nuevo.id) {

                nuevo.id =
                    "prod-" +
                    Date.now();

            }

            const producto =
                await guardarProducto(
                    nuevo
                );

            // ================================================
            // AVISAR A TODOS LOS CLIENTES
            // ================================================

            io.emit(
                "actualizar-productos",
                producto
            );

            console.log(
                "🆕 Producto creado:",
                producto.id
            );

            res.status(201).json(
                producto
            );

        } catch (error) {

            console.error(
                "❌ Error creando producto:",
                error
            );

            res.status(500).json({

                error:
                    "Error creating product",

                details:
                    error.message

            });

        }

    }
);

// ============================================================
// ACTUALIZAR PRODUCTO
// ============================================================

app.put(
    "/api/productos/:id",
    async (req, res) => {

        try {

            const actualizado =
                await actualizarProducto(
                    req.params.id,
                    req.body
                );

            if (!actualizado) {

                return res.status(404).json({

                    error:
                        "Product not found"

                });

            }

            // ================================================
            // ACTUALIZAR TODOS LOS CLIENTES
            // ================================================

            io.emit(
                "actualizar-productos",
                actualizado
            );

            console.log(
                "✏️ Producto actualizado:",
                actualizado.id
            );

            res.json(
                actualizado
            );

        } catch (error) {

            console.error(
                "❌ Error actualizando producto:",
                error
            );

            res.status(500).json({

                error:
                    "Error updating product",

                details:
                    error.message

            });

        }

    }
);

// ============================================================
// ELIMINAR PRODUCTO
// ============================================================

app.delete(
    "/api/productos/:id",
    async (req, res) => {

        try {

            const eliminado =
                await eliminarProducto(
                    req.params.id
                );

            if (!eliminado) {

                return res.status(404).json({

                    error:
                        "Product not found"

                });

            }

            // ================================================
            // AVISAR A LOS CLIENTES
            // ================================================

            io.emit(
                "eliminar-producto",
                req.params.id
            );

            console.log(
                "🗑️ Producto eliminado:",
                req.params.id
            );

            res.json({

                success: true,

                id:
                    req.params.id

            });

        } catch (error) {

            console.error(
                "❌ Error eliminando producto:",
                error
            );

            res.status(500).json({

                error:
                    "Error deleting product"

            });

        }

    }
);

// ============================================================
// PROCESAR PAGO SQUARE
// ============================================================

app.post(
    "/process-payment",
    async (req, res) => {

        try {

            const {

                sourceId,
                total,
                email,
                address,
                firstName,
                lastName,
                productos: carrito

            } = req.body;

            // ================================================
            // VALIDACIÓN
            // ================================================

            if (
                !sourceId ||
                !total ||
                !email
            ) {

                return res.status(400).json({

                    error:
                        "Incomplete payment details"

                });

            }

            if (
                !Array.isArray(carrito) ||
                carrito.length === 0
            ) {

                return res.status(400).json({

                    error:
                        "Cart is empty"

                });

            }

            if (
                !ACCESS_TOKEN ||
                !LOCATION_ID
            ) {

                return res.status(500).json({

                    error:
                        "Square is not configured"

                });

            }

            // ================================================
            // VERIFICAR STOCK REAL
            // ================================================

            const productosDB =
                await leerProductos();

            for (const item of carrito) {

                const productoDB =
                    productosDB.find(
                        p => p.id === item.id
                    );

                if (!productoDB) {

                    return res.status(400).json({

                        error:
                            `Product not found: ${item.id}`

                    });

                }

                const quantity =
                    Number(item.quantity) || 1;

                const stock =
                    Number(
                        productoDB.stock
                    ) || 0;

                if (
                    quantity <= 0 ||
                    quantity > stock
                ) {

                    return res.status(400).json({

                        error:
                            `Insufficient stock for ${productoDB.titulo}`

                    });

                }

            }

            // ================================================
            // SQUARE
            // ================================================

            const amountCents =
                Math.round(
                    Number(total) * 100
                );

            if (
                !Number.isFinite(amountCents) ||
                amountCents <= 0
            ) {

                return res.status(400).json({

                    error:
                        "Invalid payment amount"

                });

            }

            const response =
                await fetch(
                    SQUARE_API,
                    {

                        method: "POST",

                        headers: {

                            "Content-Type":
                                "application/json",

                            "Authorization":
                                `Bearer ${ACCESS_TOKEN}`

                        },

                        body:
                            JSON.stringify({

                                source_id:
                                    sourceId,

                                idempotency_key:
                                    crypto.randomUUID(),

                                amount_money: {

                                    amount:
                                        amountCents,

                                    currency:
                                        "USD"

                                },

                                location_id:
                                    LOCATION_ID

                            })

                    }
                );

            const data =
                await response.json();

            // ================================================
            // PAGO COMPLETADO
            // ================================================

            if (
                data?.payment?.status ===
                "COMPLETED"
            ) {

                // ============================================
                // ACTUALIZAR STOCK
                // ============================================

                for (const item of carrito) {

                    const productoDB =
                        await obtenerProducto(
                            item.id
                        );

                    if (!productoDB) {
                        continue;
                    }

                    const quantity =
                        Number(
                            item.quantity
                        ) || 1;

                    const currentStock =
                        Number(
                            productoDB.stock
                        ) || 0;

                    const newStock =
                        Math.max(
                            0,
                            currentStock -
                            quantity
                        );

                    const actualizado =
                        await actualizarProducto(
                            productoDB.id,
                            {
                                stock: newStock
                            }
                        );

                    // ========================================
                    // SOCKET
                    // ========================================

                    if (actualizado) {

                        io.emit(
                            "actualizar-productos",
                            actualizado
                        );

                    }

                }

                // ============================================
                // TRACKING
                // ============================================

                const trackingId =
                    "LT-" +
                    crypto
                        .randomBytes(4)
                        .toString("hex")
                        .toUpperCase();

                // ============================================
                // EMAIL TIENDA
                // ============================================

                try {

                    await enviarEmailATienda({

                        firstName,

                        lastName,

                        email,

                        address,

                        productos:
                            carrito,

                        total:
                            Number(total)

                    });

                } catch (emailError) {

                    console.error(
                        "⚠️ Error enviando email a tienda:",
                        emailError
                    );

                }

                // ============================================
                // EMAIL CLIENTE
                // ============================================

                try {

                    await enviarEmailACliente({

                        firstName,

                        lastName,

                        email,

                        productos:
                            carrito,

                        total:
                            Number(total),

                        trackingId

                    });

                } catch (emailError) {

                    console.error(
                        "⚠️ Error enviando email al cliente:",
                        emailError
                    );

                }

                console.log(
                    "💰 Pago completado:",
                    trackingId
                );

                return res.json({

                    success: true,

                    payment:
                        data.payment,

                    trackingId

                });

            }

            // ================================================
            // PAGO NO COMPLETADO
            // ================================================

            console.error(
                "❌ Square payment error:",
                data
            );

            return res.status(500).json({

                success: false,

                error:
                    data.errors ||
                    "Payment not completed"

            });

        } catch (error) {

            console.error(
                "❌ Error procesando pago:",
                error
            );

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);

// ============================================================
// FRONTEND
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );

    }
);

// ============================================================

app.get(
    "/admin.html",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "admin.html"
            )
        );

    }
);

// ============================================================
// ERROR MULTER
// ============================================================

app.use(
    (err, req, res, next) => {

        if (
            err instanceof multer.MulterError
        ) {

            console.error(
                "❌ Multer error:",
                err
            );

            return res.status(400).json({

                success: false,

                error:
                    err.message

            });

        }

        if (err) {

            console.error(
                "❌ Server error:",
                err
            );

            return res.status(500).json({

                success: false,

                error:
                    err.message

            });

        }

        next();

    }
);

// ============================================================
// 404
// ============================================================

app.use(
    (req, res) => {

        res.status(404).json({

            error:
                "Route not found",

            path:
                req.originalUrl

        });

    }
);

// ============================================================
// INICIAR SERVIDOR
// ============================================================

server.listen(
    PORT,
    () => {

        console.log(
            "=========================================="
        );

        console.log(
            "🟠 LaTRONIC Server"
        );

        console.log(
            "=========================================="
        );

        console.log(
            `🚀 Puerto: ${PORT}`
        );

        console.log(
            `⚙️ Modo: ${NODE_ENV}`
        );

        console.log(
            `📁 Imágenes: ${UPLOAD_DIR}`
        );

        console.log(
            "🗄️ PostgreSQL: configurado"
        );

        console.log(
            "🔌 Socket.IO: activo"
        );

        console.log(
            "💳 Square:",
            ACCESS_TOKEN
                ? "configurado"
                : "NO CONFIGURADO"
        );

        console.log(
            "📧 Email:",
            process.env.EMAIL_USER
                ? "configurado"
                : "NO CONFIGURADO"
        );

        console.log(
            "=========================================="
        );

    }
);