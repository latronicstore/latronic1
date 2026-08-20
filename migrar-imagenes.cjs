"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// =========================================================
// CONFIGURACIÓN
// =========================================================

const IMAGE_SERVER = "http://localhost:3001";

const PROJECT_ROOT = __dirname;

const PUBLIC_ROOT = path.join(
    PROJECT_ROOT,
    "public"
);

// false = MIGRAR TODO
// true  = solamente probar algunos productos
const TEST_MODE = false;

// Si TEST_MODE = true
const TEST_LIMIT = 1;

// Tiempo entre imágenes
const DELAY_MS = 250;


// =========================================================
// POSTGRESQL
// =========================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    }
});


// =========================================================
// ESTADÍSTICAS
// =========================================================

const stats = {
    productosEncontrados: 0,
    productosProcesados: 0,
    productosActualizados: 0,

    imagenesEncontradas: 0,
    imagenesSubidas: 0,
    imagenesFaltantes: 0,
    imagenesConError: 0,

    errores: 0
};


// =========================================================
// ESPERA
// =========================================================

function esperar(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}


// =========================================================
// MIME TYPE
// =========================================================

function getMimeType(filePath) {

    const extension =
        path.extname(filePath).toLowerCase();

    const mimeTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".avif": "image/avif",
        ".svg": "image/svg+xml"
    };

    return (
        mimeTypes[extension] ||
        "application/octet-stream"
    );
}


// =========================================================
// BUSCAR IMAGEN LOCAL
// =========================================================

function encontrarImagen(imagenPath) {

    if (!imagenPath) {
        return null;
    }

    let limpio = String(imagenPath).trim();

    // Quitar comillas
    limpio = limpio.replace(
        /^["']|["']$/g,
        ""
    );

    // Convertir slash
    limpio = limpio.replace(
        /\//g,
        path.sep
    );

    // Quitar ./ inicial
    limpio = limpio.replace(
        /^\.[\\\/]/,
        ""
    );

    // Quitar slash inicial
    limpio = limpio.replace(
        /^[\\\/]+/,
        ""
    );

    // =====================================================
    // RUTAS POSIBLES
    // =====================================================

    const posiblesRutas = [];

    // 1
    posiblesRutas.push(
        path.join(
            PUBLIC_ROOT,
            limpio
        )
    );

    // 2
    posiblesRutas.push(
        path.join(
            PROJECT_ROOT,
            limpio
        )
    );

    // 3
    if (
        /^img[\\\/]/i.test(limpio)
    ) {

        const sinImg =
            limpio.replace(
                /^img[\\\/]/i,
                ""
            );

        posiblesRutas.push(
            path.join(
                PUBLIC_ROOT,
                "img",
                sinImg
            )
        );

    }

    // =====================================================
    // BUSCAR
    // =====================================================

    for (
        const posible of posiblesRutas
    ) {

        try {

            if (
                fs.existsSync(posible)
            ) {

                const stat =
                    fs.statSync(posible);

                if (
                    stat.isFile()
                ) {

                    return path.resolve(
                        posible
                    );

                }

            }

        } catch {
            // continuar
        }

    }

    return null;
}


// =========================================================
// SUBIR IMAGEN
// =========================================================
//
// IMPORTANTE:
//
// NO usamos node-fetch.
// NO usamos form-data.
//
// Node 18 tiene fetch y FormData nativos.
//
// =========================================================

async function subirImagen(filePath) {

    const mimeType =
        getMimeType(filePath);

    const fileBuffer =
        await fs.promises.readFile(
            filePath
        );

    const blob =
        new Blob(
            [
                fileBuffer
            ],
            {
                type: mimeType
            }
        );

    const form =
        new FormData();

    form.append(
        "image",
        blob,
        path.basename(filePath)
    );

    console.log(
        "Enviando:",
        path.basename(filePath)
    );

    console.log(
        "Tamaño:",
        (
            fileBuffer.length /
            1024 /
            1024
        ).toFixed(2),
        "MB"
    );

    console.log(
        "MIME:",
        mimeType
    );

    // =====================================================
    // FETCH
    // =====================================================

    const response =
        await fetch(
            `${IMAGE_SERVER}/api/images/upload`,
            {
                method: "POST",

                body: form,

                // MUY IMPORTANTE:
                // NO establecer Content-Type manualmente.
                //
                // Node necesita agregar automáticamente:
                // multipart/form-data; boundary=...
            }
        );

    const texto =
        await response.text();

    let data;

    try {

        data =
            JSON.parse(texto);

    } catch {

        throw new Error(
            `Respuesta inválida del servidor: ${texto}`
        );

    }

    if (
        !response.ok
    ) {

        throw new Error(
            data.message ||
            `HTTP ${response.status}`
        );

    }

    if (
        !data.image
    ) {

        throw new Error(
            "El servidor no devolvió data.image."
        );

    }

    return data.image;
}


// =========================================================
// ACTUALIZAR PRODUCTO
// =========================================================

async function actualizarProducto(
    id,
    nuevasImagenes
) {

    const result =
        await pool.query(
            `
            UPDATE productos
            SET imagenes = $1
            WHERE id = $2
            `,
            [
                JSON.stringify(
                    nuevasImagenes
                ),
                id
            ]
        );

    return (
        result.rowCount > 0
    );
}


// =========================================================
// PROCESAR PRODUCTO
// =========================================================

async function procesarProducto(producto) {

    console.log("");
    console.log(
        "======================================"
    );

    console.log(
        "PRODUCTO:",
        producto.id
    );

    console.log(
        "TÍTULO:",
        producto.titulo
    );

    console.log(
        "======================================"
    );


    // =====================================================
    // LEER IMÁGENES
    // =====================================================

    let imagenes;

    try {

        if (
            Array.isArray(
                producto.imagenes
            )
        ) {

            imagenes =
                producto.imagenes;

        } else {

            imagenes =
                JSON.parse(
                    producto.imagenes ||
                    "[]"
                );

        }

    } catch {

        console.error(
            "❌ No se pudo leer imagenes."
        );

        stats.errores++;

        return;
    }


    if (
        !Array.isArray(imagenes)
    ) {

        console.log(
            "⚠️ imagenes no es un array."
        );

        return;
    }


    // =====================================================
    // SI NO TIENE IMÁGENES
    // =====================================================

    if (
        imagenes.length === 0
    ) {

        console.log(
            "⚠️ Producto sin imágenes."
        );

        stats.productosProcesados++;

        return;
    }


    const nuevasImagenes = [];

    let productoTuvoError = false;


    // =====================================================
    // PROCESAR CADA IMAGEN
    // =====================================================

    for (
        const imagen of imagenes
    ) {

        console.log("");
        console.log(
            "Imagen:",
            imagen
        );


        // =================================================
        // SI YA ES CLOUDINARY
        // =================================================

        if (
            typeof imagen === "string" &&
            imagen.includes(
                "cloudinary.com"
            )
        ) {

            console.log(
                "☑️ Ya está en Cloudinary."
            );

            nuevasImagenes.push(
                imagen
            );

            continue;
        }


        // =================================================
        // BUSCAR ARCHIVO
        // =================================================

        const rutaLocal =
            encontrarImagen(
                imagen
            );


        if (
            !rutaLocal
        ) {

            console.log(
                "❌ Imagen NO encontrada:"
            );

            console.log(
                "Referencia:",
                imagen
            );

            stats.imagenesFaltantes++;

            productoTuvoError =
                true;

            continue;
        }


        console.log(
            "Ruta local:",
            rutaLocal
        );

        console.log(
            "✅ Imagen encontrada"
        );

        stats.imagenesEncontradas++;


        // =================================================
        // SUBIR
        // =================================================

        try {

            console.log(
                "Subiendo al LaTRONIC Image Server..."
            );

            const resultado =
                await subirImagen(
                    rutaLocal
                );


            console.log(
                "✅ IMAGEN SUBIDA"
            );


            console.log(
                "Filename:",
                resultado.filename
            );


            console.log(
                "Local URL:",
                resultado.localUrl
            );


            if (
                resultado.cloudinary
            ) {

                console.log(
                    "Cloudinary:",
                    resultado.cloudinary.secureUrl
                );

            }


            // =================================================
            // ELEGIR URL
            // =================================================

            let nuevaURL;


            if (
                resultado.cloudinary &&
                resultado.cloudinary.uploaded &&
                resultado.cloudinary.secureUrl
            ) {

                nuevaURL =
                    resultado.cloudinary.secureUrl;

            } else {

                nuevaURL =
                    `${IMAGE_SERVER}${resultado.localUrl}`;

            }


            console.log(
                "URL guardada:",
                nuevaURL
            );


            nuevasImagenes.push(
                nuevaURL
            );

            stats.imagenesSubidas++;


            // =================================================
            // ESPERA
            // =================================================

            await esperar(
                DELAY_MS
            );


        } catch (error) {

            console.error(
                "❌ ERROR SUBIENDO IMAGEN:"
            );

            console.error(
                error.message
            );

            stats.imagenesConError++;

            stats.errores++;

            productoTuvoError =
                true;

        }

    }


    // =====================================================
    // NO ACTUALIZAR SI HUBO ERRORES
    // =====================================================

    if (
        nuevasImagenes.length === 0
    ) {

        console.log("");

        console.log(
            "⚠️ Producto NO modificado."
        );

        console.log(
            "No se pudo subir ninguna imagen."
        );

        return;
    }


    if (
        productoTuvoError
    ) {

        console.log("");

        console.log(
            "⚠️ Producto contiene errores."
        );

        console.log(
            "⚠️ NO se modifica PostgreSQL."
        );

        console.log(
            "Esto protege las referencias originales."
        );

        return;
    }


    // =====================================================
    // ACTUALIZAR DATABASE
    // =====================================================

    try {

        const actualizado =
            await actualizarProducto(
                producto.id,
                nuevasImagenes
            );


        if (
            actualizado
        ) {

            stats.productosActualizados++;

            console.log("");

            console.log(
                "✅ PRODUCTO ACTUALIZADO"
            );

            console.log(
                "PostgreSQL:"
            );

            console.dir(
                nuevasImagenes,
                {
                    depth: null
                }
            );

        } else {

            console.log(
                "⚠️ No se encontró el producto para actualizar."
            );

        }

    } catch (error) {

        console.error(
            "❌ ERROR PostgreSQL:"
        );

        console.error(
            error.message
        );

        stats.errores++;

        return;
    }


    stats.productosProcesados++;
}


// =========================================================
// MAIN
// =========================================================

async function main() {

    console.log("");
    console.log(
        "======================================"
    );

    console.log(
        "     MIGRADOR DE IMÁGENES LaTRONIC"
    );

    console.log(
        "======================================"
    );

    console.log("");

    console.log(
        "Image Server:",
        IMAGE_SERVER
    );

    console.log(
        "Proyecto:",
        PROJECT_ROOT
    );

    console.log(
        "Public:",
        PUBLIC_ROOT
    );

    console.log(
        "Modo:",
        TEST_MODE
            ? `PRUEBA - ${TEST_LIMIT} PRODUCTO`
            : "MIGRAR TODO"
    );

    console.log("");


    // =====================================================
    // COMPROBAR FETCH
    // =====================================================

    if (
        typeof fetch !== "function"
    ) {

        console.error(
            "❌ Este Node.js no tiene fetch nativo."
        );

        console.error(
            "Versión:",
            process.version
        );

        process.exit(1);
    }


    // =====================================================
    // IMAGE SERVER
    // =====================================================

    try {

        console.log(
            "Comprobando Image Server..."
        );

        const ping =
            await fetch(
                `${IMAGE_SERVER}/api/ping`
            );


        if (
            !ping.ok
        ) {

            throw new Error(
                `HTTP ${ping.status}`
            );
        }


        const pingText =
            await ping.text();


        let pingData;

        try {

            pingData =
                JSON.parse(
                    pingText
                );

        } catch {

            pingData = {};
        }


        console.log(
            "✅ Image Server ONLINE"
        );


        if (
            pingData.server
        ) {

            console.log(
                "Servidor:",
                pingData.server
            );

        }

    } catch (error) {

        console.error("");

        console.error(
            "❌ NO SE PUEDE CONECTAR AL IMAGE SERVER"
        );

        console.error(
            "URL:",
            IMAGE_SERVER
        );

        console.error(
            "Error:",
            error.message
        );

        console.error("");

        console.error(
            "Abre el servidor con:"
        );

        console.error(
            "node server.js"
        );

        process.exit(1);
    }


    // =====================================================
    // OBTENER PRODUCTOS
    // =====================================================

    try {

        let query = `
            SELECT
                id,
                titulo,
                imagenes
            FROM productos
            WHERE imagenes IS NOT NULL
            ORDER BY id ASC
        `;


        if (
            TEST_MODE
        ) {

            query +=
                ` LIMIT ${TEST_LIMIT}`;

        }


        const result =
            await pool.query(
                query
            );


        stats.productosEncontrados =
            result.rows.length;


        console.log("");

        console.log(
            "Productos encontrados:",
            result.rows.length
        );


        if (
            result.rows.length === 0
        ) {

            console.log(
                "⚠️ No hay productos."
            );

            return;
        }


        // =================================================
        // PROCESAR PRODUCTOS
        // =================================================

        for (
            const producto
            of result.rows
        ) {

            await procesarProducto(
                producto
            );

        }

    } catch (error) {

        console.error("");

        console.error(
            "❌ ERROR GENERAL:"
        );

        console.error(
            error
        );

    } finally {

        await pool.end();
    }


    // =====================================================
    // RESUMEN
    // =====================================================

    console.log("");

    console.log(
        "======================================"
    );

    console.log(
        "           MIGRACIÓN TERMINADA"
    );

    console.log(
        "======================================"
    );

    console.log("");

    console.log(
        "Productos encontrados:",
        stats.productosEncontrados
    );

    console.log(
        "Productos procesados:",
        stats.productosProcesados
    );

    console.log(
        "Productos actualizados:",
        stats.productosActualizados
    );

    console.log("");

    console.log(
        "Imágenes encontradas:",
        stats.imagenesEncontradas
    );

    console.log(
        "Imágenes subidas:",
        stats.imagenesSubidas
    );

    console.log(
        "Imágenes faltantes:",
        stats.imagenesFaltantes
    );

    console.log(
        "Imágenes con error:",
        stats.imagenesConError
    );

    console.log(
        "Errores:",
        stats.errores
    );

    console.log("");

    console.log(
        "⚠️ Las imágenes originales NO fueron eliminadas."
    );

    console.log("");
}


// =========================================================
// EJECUTAR
// =========================================================

main();