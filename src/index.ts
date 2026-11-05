import express from 'express';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = 3000;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/postgres";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const UBICACION_TTL_SEGUNDOS = 30;
const HOLD_DURACION_SEGUNDOS = 600; // 10 minutos de reserva temporal según contrato

// Conexiones a PostgreSQL (persistente) y Redis (efímero/geoespacial)
const pool = new Pool({ connectionString: DATABASE_URL });
const redisClient = new Redis(REDIS_URL);

// Cargar el archivo OpenAPI
const swaggerDocument = YAML.load(path.join(__dirname, '../openapiM4.yml'));

// ACTUALIZAR UBICACIÓN VIGENTE
app.put('/api/v1/conductores/:conductor_id/ubicacion', async (req: Request, res: Response): Promise<any> => {
    const conductor_id = String(req.params.conductor_id);
    const body = req.body || {};
    const latitud = Number(body.latitud);
    const longitud = Number(body.longitud);
    const rawTs = body.timestamp_ubicacion;
    const timestamp_ubicacion = typeof rawTs === 'string' ? rawTs : (Array.isArray(rawTs) ? String(rawTs[0]) : undefined);

    try {
        const ubicacionKey = `conductor:${conductor_id}:ubicacion`;
        const activoKey = `conductor:${conductor_id}:activo`;

        // Guardar hash de ubicación, agregar a índice geoespacial y marcar activo con TTL
        await redisClient.hset(ubicacionKey, {
            latitud: String(latitud),
            longitud: String(longitud),
            timestamp_ubicacion: timestamp_ubicacion || new Date().toISOString()
        });

        await redisClient.geoadd('conductores_geo', longitud, latitud, conductor_id);
        await redisClient.set(activoKey, '1', 'EX', UBICACION_TTL_SEGUNDOS);

        const recibida_en = new Date().toISOString();
        const expira_en = new Date(Date.now() + UBICACION_TTL_SEGUNDOS * 1000).toISOString();

        return res.status(200).json({
            conductor_id,
            timestamp_ubicacion: timestamp_ubicacion || recibida_en,
            recibida_en,
            vigente: true,
            expira_en
        });
    } catch (error) {
        console.error("Error al actualizar ubicación:", error);
        return res.status(500).json({ error: "Fallo interno de telemetría" });
    }
});


// ACTUALIZAR ESTADO OPERATIVO
app.put('/api/v1/conductores/:conductor_id/estado-operativo', async (req: Request, res: Response): Promise<any> => {
    const conductor_id = String(req.params.conductor_id);
    const body = req.body || {};
    const event_id = String(body.event_id || '');
    const connected = Boolean(body.connected);
    const available = Boolean(body.available);

    try {
        const availableEfectivo = connected ? available : false;
        
        // Consultar tipo de vehículo desde PostgreSQL
        let tipoVehiculo = "AUTO";
        const dbResult = await pool.query("SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1", [conductor_id]);
        if (dbResult.rows.length > 0) {
            tipoVehiculo = String(dbResult.rows[0].tipo_vehiculo || "AUTO");
        }

        const setDisponibles = `conductores:disponibles:${tipoVehiculo}`;

        if (connected && availableEfectivo) {
            await redisClient.sadd(setDisponibles, conductor_id);
        } else {
            await redisClient.srem(setDisponibles, conductor_id);
        }

        const recibido_en = new Date().toISOString();
        return res.status(200).json({
            conductor_id,
            event_id,
            connected,
            available: availableEfectivo,
            recibido_en
        });
    } catch (error) {
        console.error("Error al actualizar estado operativo:", error);
        return res.status(500).json({ error: "Error interno al actualizar estado" });
    }
});


// BUSCAR CONDUCTORES CERCANOS
app.get('/api/v1/conductores/cercanos', async (req: Request, res: Response): Promise<any> => {
    const qLat = req.query.origen_latitud;
    const qLon = req.query.origen_longitud;
    const qTipo = req.query.tipo_vehiculo;
    const qRadio = req.query.radio_km;

    const origenLat = parseFloat(Array.isArray(qLat) ? String(qLat[0]) : String(qLat ?? '0'));
    const origenLon = parseFloat(Array.isArray(qLon) ? String(qLon[0]) : String(qLon ?? '0'));
    const tipoVehiculo = Array.isArray(qTipo) ? String(qTipo[0]) : String(qTipo ?? 'AUTO');
    const radioKm = qRadio ? parseFloat(Array.isArray(qRadio) ? String(qRadio[0]) : String(qRadio)) : 5;

    try {
        // Búsqueda geoespacial en Redis ordenada por distancia ascendente
        const resultados: any = await redisClient.geosearch(
            'conductores_geo',
            'FROMLONLAT', origenLon, origenLat,
            'BYRADIUS', radioKm, 'km',
            'ASC', 'WITHDIST'
        );

        const setDisponibles = `conductores:disponibles:${tipoVehiculo}`;
        const conductores: Array<{
            conductor_id: string;
            distancia_origen_km: number;
            eta_retiro_minutos: number;
            tipo_vehiculo: string;
        }> = [];

        if (Array.isArray(resultados)) {
            for (const item of resultados) {
                const conductorId = String(item[0]);
                const distancia = parseFloat(String(item[1]));

                // Validar que esté activo (TTL vigente), disponible en el set y sin reserva temporal
                const isActivo = await redisClient.exists(`conductor:${conductorId}:activo`);
                const isDisponible = await redisClient.sismember(setDisponibles, conductorId);
                const isReservado = await redisClient.exists(`conductor:${conductorId}:reserva`);

                if (isActivo && isDisponible && !isReservado) {
                    conductores.push({
                        conductor_id: conductorId,
                        distancia_origen_km: Number(distancia.toFixed(2)),
                        eta_retiro_minutos: Math.max(1, Math.round(distancia * 3)),
                        tipo_vehiculo: tipoVehiculo
                    });
                }
            }
        }

        return res.status(200).json({
            conductores,
            radio_aplicado_km: radioKm,
            generado_en: new Date().toISOString()
        });
    } catch (error) {
        console.error("Error en búsqueda geoespacial:", error);
        return res.status(500).json({ error: "Fallo en motor de búsqueda" });
    }
});


// RESERVA TEMPORAL O LIBERACIÓN
app.post('/api/v1/conductores/:conductor_id/reserva', async (req: Request, res: Response): Promise<any> => {
    const conductor_id = String(req.params.conductor_id);
    const body = req.body || {};
    const rawEstado = body.estado_temporal;
    const rawSol = body.solicitud_id;

    const estado_temporal = typeof rawEstado === 'string' ? rawEstado : (Array.isArray(rawEstado) ? String(rawEstado[0]) : '');
    const solicitud_id = typeof rawSol === 'string' ? rawSol : (Array.isArray(rawSol) ? String(rawSol[0]) : String(rawSol ?? ''));

    const reservaKey = `conductor:${conductor_id}:reserva`;
    const setAuto = 'conductores:disponibles:AUTO';
    const setMoto = 'conductores:disponibles:MOTO';

    try {
        if (estado_temporal === 'RESERVADO') {
            // SET NX con expiración de 10 minutos (atómico)
            const result = await redisClient.set(reservaKey, solicitud_id, 'EX', HOLD_DURACION_SEGUNDOS, 'NX');
            if (!result) {
                const currentHolder = await redisClient.get(reservaKey);
                if (currentHolder && currentHolder !== solicitud_id) {
                    return res.status(409).json({
                        type: '/errores/conductor-reservado',
                        title: 'Conductor no disponible para reserva',
                        status: 409,
                        detail: 'El conductor ya está reservado por otra solicitud.',
                        instance: req.originalUrl,
                        code: 'CONDUCTOR_RESERVADO'
                    });
                }
            }
            // Retirar temporalmente de disponibles
            await redisClient.srem(setAuto, conductor_id);
            await redisClient.srem(setMoto, conductor_id);

        } else if (estado_temporal === 'LIBERADO') {
            const currentHolder = await redisClient.get(reservaKey);
            if (currentHolder && currentHolder !== solicitud_id) {
                return res.status(409).json({
                    type: '/errores/conflicto-reserva',
                    title: 'Conflicto al liberar',
                    status: 409,
                    detail: 'La solicitud_id no coincide con la reserva actual.',
                    instance: req.originalUrl
                });
            }
            await redisClient.del(reservaKey);
        }

        const actualizado_en = new Date().toISOString();
        const expira_en = new Date(Date.now() + HOLD_DURACION_SEGUNDOS * 1000).toISOString();

        return res.status(200).json({
            conductor_id,
            solicitud_id,
            estado_temporal,
            actualizado_en,
            expira_en,
            idempotente: false
        });
    } catch (error) {
        console.error("Error en reserva temporal:", error);
        return res.status(500).json({ error: "Error interno al procesar reserva" });
    }
});


// ESTIMACIÓN DE RUTAS
app.get('/api/v1/rutas/estimacion', (req: Request, res: Response) => {
    return res.status(200).json({
        distancia_estimada_km: 6.8,
        eta_minutos: 18,
        calculado_en: new Date().toISOString(),
        fuente: 'estimacion_local'
    });
});


// GEOCODIFICACIÓN
app.post('/api/v1/geocodificaciones', (req: Request, res: Response) => {
    const body = req.body || {};
    const direccion = String(body.direccion || '');
    const localidad = String(body.localidad || 'Buenos Aires');
    const pais = String(body.pais || '');
    return res.status(200).json({
        coincidencias: [
            {
                latitud: -34.6037,
                longitud: -58.3816,
                etiqueta: `${direccion}, ${localidad}, ${pais}`,
                confianza: 0.95
            }
        ]
    });
});

// ENDPOINTS DE SALUD 
app.get('/health/live', (req: Request, res: Response) => {
    return res.status(200).json({ status: 'UP' });
});

app.get('/health/ready', async (req: Request, res: Response): Promise<any> => {
    try {
        await redisClient.ping();
        return res.status(200).json({ status: 'READY' });
    } catch (e) {
        return res.status(503).json({ status: 'DOWN' });
    }
});

// Montar la interfaz de Swagger
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Inicialización del servidor
app.listen(PORT, () => {
    console.log(`[M4] Servidor TypeScript ejecutándose en el puerto ${PORT}`);
});