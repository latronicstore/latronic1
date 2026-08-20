"use strict";

require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function inspeccionar() {

    try {

        console.log("");
        console.log("======================================");
        console.log("   INSPECCIÓN DE IMÁGENES LaTRONIC");
        console.log("======================================");
        console.log("");

        const result = await pool.query(`
            SELECT
                id,
                titulo,
                imagenes
            FROM productos
            ORDER BY id ASC
            LIMIT 5
        `);

        console.log(
            `Productos encontrados: ${result.rows.length}`
        );

        console.log("");

        for (const producto of result.rows) {

            console.log("--------------------------------------");

            console.log(
                "ID:",
                producto.id
            );

            console.log(
                "Título:",
                producto.titulo
            );

            console.log(
                "Tipo de imagenes:",
                typeof producto.imagenes
            );

            console.log(
                "Contenido de imagenes:"
            );

            console.dir(
                producto.imagenes,
                {
                    depth: null,
                    colors: false
                }
            );

            console.log("");
        }

        console.log("--------------------------------------");
        console.log("");
        console.log("INSPECCIÓN TERMINADA.");
        console.log("NO se modificó la base de datos.");
        console.log("");

    } catch (error) {

        console.error("");
        console.error("ERROR:");
        console.error(error.message);
        console.error("");

    } finally {

        await pool.end();

    }

}

inspeccionar();