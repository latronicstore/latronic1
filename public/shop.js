// shop.js

async function cargarProductos() {
    try {
        const res = await fetch("/api/productos", {
            cache: "no-store"
        });

        if (!res.ok) {
            throw new Error("Error cargando productos");
        }

        const productos = await res.json();

        console.log("Productos cargados:", productos);

        // Aquí tu código que crea las tarjetas de productos
    } catch (error) {
        console.error("Error:", error);
    }
}

cargarProductos();