import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function crearTabla() {
  try {
    // Crear tabla si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        description TEXT,
        price NUMERIC DEFAULT 0,
        stock INT DEFAULT 0,
        categoria JSONB DEFAULT '{}'
      )
    `);

    // Agregar columna imagenes si no existe
    await pool.query(`
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS imagenes JSONB DEFAULT '[]'
    `);

    // Agregar columna year si no existe
    await pool.query(`
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS year TEXT
    `);

    console.log("✅ Tabla 'productos' lista y columnas necesarias aseguradas");
  } catch (err) {
    console.error("❌ Error creando/actualizando tabla:", err.message);
  } finally {
    await pool.end();
  }
}

crearTabla();
