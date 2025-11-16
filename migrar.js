import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ruta de tu db.json
const dbPath = path.join(process.cwd(), "public", "db.json");

async function migrar() {
  if (!fs.existsSync(dbPath)) {
    console.error("❌ No se encontró db.json");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
  const productos = data.productos || [];

  console.log(`🔹 Encontrados ${productos.length} productos en db.json`);

  let insertados = 0;
  let actualizados = 0;
  let errores = 0;

  for (const p of productos) {
    const { id, titulo, description, price, stock, categoria, imagenes, year } = p;

    try {
      const res = await pool.query(
        `INSERT INTO productos (id, titulo, description, price, stock, categoria, imagenes, year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE
         SET titulo = EXCLUDED.titulo,
             description = EXCLUDED.description,
             price = EXCLUDED.price,
             stock = EXCLUDED.stock,
             categoria = EXCLUDED.categoria,
             imagenes = EXCLUDED.imagenes,
             year = EXCLUDED.year
         RETURNING xmax`,
        [
          id,
          titulo,
          description || "",
          price || 0,
          stock || 0,
          JSON.stringify(categoria || {}),
          JSON.stringify(imagenes || []),
          year || null
        ]
      );

      if (res.rows[0].xmax === "0") insertados++;
      else actualizados++;
      console.log(`✅ Migrado: ${titulo}`);
    } catch (err) {
      console.error(`❌ Error migrando ${titulo}:`, err.message);
      errores++;
    }
  }

  console.log("\n🎉 Migración completada");
  console.log(`📊 Insertados: ${insertados}, Actualizados: ${actualizados}, Errores: ${errores}`);

  await pool.end();
}

migrar();
