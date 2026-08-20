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
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");

const TEST_MODE = false;
const TEST_LIMIT = 1;

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

    imagenesTotales: 0,
    imagenesEncontradas: 0,
    imagenesSubidas: 0,
    imagenesYaCloudinary: 0,
    imagenesFaltantes: 0,
    imagenesConError: 0,

    errores: 0
};

// =========================================================
// REPORTES
// =========================================================

const missingReport = [];
const errorReport = [];

// =========================================================
// ÍNDICE DE ARCHIVOS
// =========================================================

const indiceArchivos = new Map();

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
// NORMALIZAR NOMBRE
// =========================================================

function normalizarNombre(nombre) {

    return String(nombre)
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        .toLowerCase();
}

// =========================================================
// CONSTRUIR ÍNDICE
// =========================================================

function construirIndice() {

    console.log("");
    console.log("======================================");
    console.log("BUSCANDO TODAS LAS IMÁGENES LOCALES");
    console.log("======================================");
    console.log("");

    let total = 0;

    function recorrer(carpeta) {

        let elementos;

        try {

            elementos =
                fs.readdirSync(
                    carpeta,
                    {
                        withFileTypes: true
                    }
                );

        } catch (error) {

            console.log(
                "⚠️ No se pudo leer:",
                carpeta
            );

            return;
        }

        for (
            const elemento
            of elementos
        ) {

            const ruta =
                path.join(
                    carpeta,
                    elemento.name
                );

            if (
                elemento.isDirectory()
            ) {

                recorrer(ruta);

                continue;
            }

            if (
                !elemento.isFile()
            ) {
                continue;
            }

            const extension =
                path.extname(
                    elemento.name
                ).toLowerCase();

            const permitidas = [
                ".jpg",
                ".jpeg",
                ".png",
                ".webp",
                ".gif",
                ".avif",
                ".svg"
            ];

            if (
                !permitidas.includes(
                    extension
                )
            ) {
                continue;
            }

            const nombre =
                elemento.name.toLowerCase();

            if (
                !indiceArchivos.has(nombre)
            ) {

                indiceArchivos.set(
                    nombre,
                    []
                );
            }

            indiceArchivos
                .get(nombre)
                .push(
                    path.resolve(ruta)
                );

            total++;
        }
    }

    recorrer(
        PUBLIC_ROOT
    );

    console.log(
        "✅ Imágenes locales encontradas:",
        total
    );

    console.log(
        "Nombres únicos:",
        indiceArchivos.size
    );

    console.log("");
}

// =========================================================
// BUSCAR IMAGEN
// =========================================================

function encontrarImagen(imagenPath) {

    if (!imagenPath) {
        return null;
    }

    let limpio =
        String(imagenPath)
            .trim();

    limpio =
        limpio.replace(
            /^["']|["']$/g,
            ""
        );

    limpio =
        limpio.replace(
            /\\/g,
            path.sep
        );

    // =====================================================
    // CLOUDINARY
    // =====================================================

    if (
        limpio.includes(
            "cloudinary.com"
        )
    ) {

        return {
            cloudinary: true
        };
    }

    // =====================================================
    // URL HTTP
    // =====================================================

    if (
        /^https?:\/\//i.test(limpio)
    ) {

        return null;
    }

    // =====================================================
    // RUTA ABSOLUTA
    // =====================================================

    if (
        path.isAbsolute(limpio)
    ) {

        try {

            if (
                fs.existsSync(limpio) &&
                fs.statSync(limpio).isFile()
            ) {

                return path.resolve(
                    limpio
                );
            }

        } catch {}
    }

    // =====================================================
    // LIMPIAR RUTA
    // =====================================================

    limpio =
        limpio.replace(
            /^\.[\\\/]/,
            ""
        );

    limpio =
        limpio.replace(
            /^[\\\/]+/,
            ""
        );

    // =====================================================
    // RUTAS EXACTAS
    // =====================================================

    const posibles = [

        path.join(
            PUBLIC_ROOT,
            limpio
        ),

        path.join(
            PROJECT_ROOT,
            limpio
        )
    ];

    // =====================================================
    // IMG/
    // =====================================================

    if (
        /^img[\\\/]/i.test(limpio)
    ) {

        const sinImg =
            limpio.replace(
                /^img[\\\/]/i,
                ""
            );

        posibles.push(
            path.join(
                PUBLIC_ROOT,
                "img",
                sinImg
            )
        );
    }

    // =====================================================
    // UPLOADS/
    // =====================================================

    if (
        /^uploads[\\\/]/i.test(limpio)
    ) {

        const sinUploads =
            limpio.replace(
                /^uploads[\\\/]/i,
                ""
            );

        posibles.push(
            path.join(
                PUBLIC_ROOT,
                "uploads",
                sinUploads
            )
        );
    }

    // =====================================================
    // BUSCAR RUTA EXACTA
    // =====================================================

    for (
        const ruta
        of posibles
    ) {

        try {

            if (
                fs.existsSync(ruta) &&
                fs.statSync(ruta).isFile()
            ) {

                return path.resolve(
                    ruta
                );
            }

        } catch {}
    }

    // =====================================================
    // BUSCAR POR NOMBRE
    // =====================================================

    const nombre =
        normalizarNombre(
            limpio
        );

    const coincidencias =
        indiceArchivos.get(
            nombre
        );

    if (
        !coincidencias ||
        coincidencias.length === 0
    ) {

        return null;
    }

    // =====================================================
    // UNA COINCIDENCIA
    // =====================================================

    if (
        coincidencias.length === 1
    ) {

        return coincidencias[0];
    }

    // =====================================================
    // MÚLTIPLES COINCIDENCIAS
    // =====================================================

    console.log("");
    console.log(
        "⚠️ Múltiples archivos encontrados:"
    );

    console.log(
        "Referencia:",
        limpio
    );

    for (
        const archivo
        of coincidencias
    ) {

        console.log(
            "   ",
            archivo
        );
    }

    return null;
}

// =========================================================
// SUBIR IMAGEN
// =========================================================

async function subirImagen(
    filePath
) {

    const mimeType =
        getMimeType(
            filePath
        );

    const buffer =
        await fs.promises.readFile(
            filePath
        );

    const blob =
        new Blob(
            [
                buffer
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
        path.basename(
            filePath
        )
    );

    console.log(
        "Enviando:",
        path.basename(filePath)
    );

    console.log(
        "Tamaño:",
        (
            buffer.length /
            1024 /
            1024
        ).toFixed(2),
        "MB"
    );

    console.log(
        "MIME:",
        mimeType
    );

    const response =
        await fetch(
            `${IMAGE_SERVER}/api/images/upload`,
            {
                method: "POST",
                body: form
            }
        );

    const texto =
        await response.text();

    let data;

    try {

        data =
            JSON.parse(
                texto
            );

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
    imagenes
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
                    imagenes
                ),
                id
            ]
        );

    return result.rowCount > 0;
}

// =========================================================
// PROCESAR PRODUCTO
// =========================================================

async function procesarProducto(
    producto
) {

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

    } catch (error) {

        console.error(
            "❌ No se pudo leer imagenes."
        );

        stats.errores++;

        errorReport.push(
            `Producto: ${producto.id}
Título: ${producto.titulo}
Error: ${error.message}`
        );

        stats.productosProcesados++;

        return;
    }

    if (
        !Array.isArray(imagenes)
    ) {

        console.log(
            "⚠️ imagenes no es un array."
        );

        stats.productosProcesados++;

        return;
    }

    if (
        imagenes.length === 0
    ) {

        console.log(
            "⚠️ Producto sin imágenes."
        );

        stats.productosProcesados++;

        return;
    }

    stats.imagenesTotales +=
        imagenes.length;

    const nuevasImagenes = [];

    let huboCambio = false;

    // =====================================================
    // CADA IMAGEN
    // =====================================================

    for (
        const imagen
        of imagenes
    ) {

        console.log("");
        console.log(
            "Imagen:",
            imagen
        );

        // =================================================
        // YA CLOUDINARY
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

            stats.imagenesYaCloudinary++;

            continue;
        }

        // =================================================
        // BUSCAR
        // =================================================

        const resultadoBusqueda =
            encontrarImagen(
                imagen
            );

        if (
            !resultadoBusqueda
        ) {

            console.log(
                "❌ Imagen NO encontrada."
            );

            console.log(
                "Referencia:",
                imagen
            );

            stats.imagenesFaltantes++;

            nuevasImagenes.push(
                imagen
            );

            missingReport.push(
                `Producto: ${producto.id}
Título: ${producto.titulo}
Imagen: ${imagen}`
            );

            continue;
        }

        if (
            resultadoBusqueda.cloudinary
        ) {

            nuevasImagenes.push(
                imagen
            );

            stats.imagenesYaCloudinary++;

            continue;
        }

        const rutaLocal =
            resultadoBusqueda;

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

            huboCambio = true;

            await esperar(
                DELAY_MS
            );

        } catch (error) {

            console.error(
                "❌ ERROR:",
                error.message
            );

            stats.imagenesConError++;
            stats.errores++;

            nuevasImagenes.push(
                imagen
            );

            errorReport.push(
                `Producto: ${producto.id}
Título: ${producto.titulo}
Imagen: ${imagen}
Error: ${error.message}`
            );
        }
    }

    // =====================================================
    // ACTUALIZAR POSTGRESQL
    // =====================================================

    if (
        huboCambio
    ) {

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
            }

        } catch (error) {

            console.error(
                "❌ ERROR PostgreSQL:",
                error.message
            );

            stats.errores++;

            errorReport.push(
                `Producto: ${producto.id}
Error PostgreSQL: ${error.message}`
            );
        }
    }

    stats.productosProcesados++;
}

// =========================================================
// GUARDAR REPORTES
// =========================================================

function guardarReportes() {

    const missingPath =
        path.join(
            PROJECT_ROOT,
            "migration-missing-images.txt"
        );

    const errorsPath =
        path.join(
            PROJECT_ROOT,
            "migration-errors.txt"
        );

    fs.writeFileSync(
        missingPath,
        missingReport.length
            ? missingReport.join(
                "\n\n----------------------------------------\n\n"
            )
            : "NO HAY IMÁGENES FALTANTES.",
        "utf8"
    );

    fs.writeFileSync(
        errorsPath,
        errorReport.length
            ? errorReport.join(
                "\n\n----------------------------------------\n\n"
            )
            : "NO HAY ERRORES.",
        "utf8"
    );

    console.log("");
    console.log(
        "📄 Reporte faltantes:",
        missingPath
    );

    console.log(
        "📄 Reporte errores:",
        errorsPath
    );
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
        " MIGRADOR CLOUDINARY LaTRONIC"
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

    console.log("");

    // =====================================================
    // COMPROBAR IMAGE SERVER
    // =====================================================

    try {

        console.log(
            "Comprobando Image Server..."
        );

        const response =
            await fetch(
                `${IMAGE_SERVER}/api/ping`
            );

        if (
            !response.ok
        ) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }

        console.log(
            "✅ Image Server ONLINE"
        );

    } catch (error) {

        console.error("");
        console.error(
            "❌ Image Server NO está disponible."
        );

        console.error(
            error.message
        );

        console.error("");

        console.error(
            "Ejecuta en otra terminal:"
        );

        console.error(
            "node server.js"
        );

        process.exit(1);
    }

    // =====================================================
    // INDEXAR
    // =====================================================

    construirIndice();

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

        // =================================================
        // PROCESAR
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

        stats.errores++;

    } finally {

        await pool.end();
    }

    // =====================================================
    // REPORTES
    // =====================================================

    guardarReportes();

    // =====================================================
    // RESUMEN
    // =====================================================

    console.log("");
    console.log(
        "======================================"
    );

    console.log(
        "      MIGRACIÓN TERMINADA"
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
        "Imágenes totales:",
        stats.imagenesTotales
    );

    console.log(
        "Imágenes encontradas:",
        stats.imagenesEncontradas
    );

    console.log(
        "Imágenes subidas:",
        stats.imagenesSubidas
    );

    console.log(
        "Imágenes ya en Cloudinary:",
        stats.imagenesYaCloudinary
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

    console.log(
        "🎉 Proceso terminado."
    );
}

// =========================================================
// EJECUTAR
// =========================================================

main();
