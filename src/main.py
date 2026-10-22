from fastapi import FastAPI, Query
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager
import asyncpg
import redis.asyncio as redis
import uvicorn

DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/postgres"
# El docker-compose expone Redis en el puerto 6379 estándar
REDIS_URL = "redis://localhost:6379"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Conexión a PostgreSQL (Estado Persistente)
    print("[DB] Conectando a PostgreSQL...")
    try:
        app.state.db_pool = await asyncpg.create_pool(DATABASE_URL)
        print("[DB] PostgreSQL conectado.")
    except Exception as e:
        print(f"[DB] Error en Postgres: {e}")

    # 2. Conexión a Redis (Estado Efímero y Geoespacial)
    print("[Redis] Conectando a Redis...")
    try:
        # decode_responses=True convierte los bytes de Redis a strings de Python automáticamente
        app.state.redis = redis.from_url(REDIS_URL, decode_responses=True)
        await app.state.redis.ping()
        print("[Redis] Redis conectado.")
    except Exception as e:
        print(f"[Redis] Error en Redis: {e}")
    
    yield  # La API recibe peticiones en este punto
    
    # 3. Limpieza al apagar el servidor
    print("Apagando conexiones...")
    if hasattr(app.state, 'db_pool'):
        await app.state.db_pool.close()
    if hasattr(app.state, 'redis'):
        await app.state.redis.aclose()

app = FastAPI(
    title="M4 API - Ubicación y Disponibilidad",
    version="1.0.0",
    lifespan=lifespan
)

class UbicacionBody(BaseModel):
    conductor_id: str = Field(..., description="UUID del conductor")
    latitud: float = Field(..., ge=-90, le=90)
    longitud: float = Field(..., ge=-180, le=180)
    timestamp_ubicacion: str

@app.post("/api/v1/ubicaciones", status_code=200, summary="Actualización de ubicación viva")
async def registrar_ubicacion(body: UbicacionBody):
    # Insertamos la coordenada en una clave espacial de Redis llamada "conductores_geo"
    # La sintaxis de GEOADD exige el orden: longitud, latitud, nombre_del_miembro
    try:
        await app.state.redis.geoadd(
            "conductores_geo", 
            (body.longitud, body.latitud, body.conductor_id)
        )
        print(f"[Redis] Coordenada actualizada: {body.conductor_id} ({body.latitud}, {body.longitud})")
    except Exception as e:
        print(f"Error al guardar en Redis: {e}")
        return {"error": "Fallo interno de telemetría", "status": 500}
    
    return {"mensaje": "Ubicación procesada correctamente"}

@app.get("/api/v1/conductores/cercanos", summary="Obtener conductores cercanos (RF-4.2)")
async def obtener_conductores_cercanos(
    origen_latitud: float = Query(..., ge=-90, le=90, description="Latitud del cliente"),
    origen_longitud: float = Query(..., ge=-180, le=180, description="Longitud del cliente"),
    radio_km: float = Query(..., gt=0, le=200, description="Radio de búsqueda en kilómetros")
):
    try:
        # El motor de Redis busca en el radio, withdist=True nos devuelve a cuántos KM están,
        # y sort="ASC" los ordena del más cercano al más lejano.
        resultados = await app.state.redis.geosearch(
            name="conductores_geo",
            longitude=origen_longitud,
            latitude=origen_latitud,
            radius=radio_km,
            unit="km",
            withdist=True,
            sort="ASC"
        )
        #Nos falta lo de tipo de Vehiculo todavia 
        conductores = [
            {"conductor_id": res[0], "distancia_km": res[1]}
            for res in resultados
        ]
        
        return {
            "origen": {"latitud": origen_latitud, "longitud": origen_longitud},
            "radio_busqueda_km": radio_km,
            "total_encontrados": len(conductores),
            "conductores": conductores
        }
        
    except Exception as e:
        print(f"Error en búsqueda geoespacial de Redis: {e}")
        return {"error": "Fallo interno en el motor de búsqueda", "status": 500}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)