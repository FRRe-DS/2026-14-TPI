import { describe, it, expect, vi, beforeEach } from "vitest";
import request from 'supertest';

//Mock de redis
const { redisMock } = vi.hoisted(() => ({
    redisMock: {
        hset: vi.fn(),
        geoadd: vi.fn(),
        set: vi.fn(),
        sadd: vi.fn(),
        srem: vi.fn(),
        geosearch: vi.fn(),
        exists: vi.fn(),
        sismember: vi.fn(),
        get: vi.fn(),
        del: vi.fn(),
    }
}));

vi.mock('ioredis', () => ({
    Redis: vi.fn(function () {
        return redisMock;
    })
}));
//-----

//Mock de la base de datos
const { poolMock } = vi.hoisted(() => ({
    poolMock: {
        query: vi.fn()
    }
}));

vi.mock('pg', () => ({
    Pool: vi.fn(function () {
        return poolMock;
    })
}));
//-----
 
import { app } from '../src/index.js';

beforeEach(() => {
    vi.resetAllMocks();
});

describe('PUT/api/v1/conductores/:conductor_id/ubicacion', () => {
    it('guarda la ubicación del conductor', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            latitud: -27.451,
            longitud: -58.986,
            timestamp_ubicacion: '2026-11-08T10:00:00'
        };

        //ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/ubicacion`)
            .send(datos);
        //------

        expect(respuesta.status).toBe(200);

        expect(respuesta.body.conductor_id).toBe(conductorId);
        expect(respuesta.body.timestamp_ubicacion).toBe(datos.timestamp_ubicacion);
        expect(respuesta.body.vigente).toBe(true);

        //not.toBeNaN porque crea 2 timestamp, entonces las variables si no 
        //estan vacias es porque se les asignó las generaciones
        expect(respuesta.body.recibida_en).not.toBeNaN();
        expect(respuesta.body.expira_en).not.toBeNaN();

        expect(redisMock.hset).toHaveBeenCalledWith(
            `conductor:${conductorId}:ubicacion`,
            {
                latitud: String(datos.latitud),
                longitud: String(datos.longitud),
                timestamp_ubicacion: datos.timestamp_ubicacion
            }
        );

        expect(redisMock.geoadd).toHaveBeenCalledWith(
            'conductores_geo',
            datos.longitud,
            datos.latitud,
            conductorId
        );

        expect(redisMock.set).toHaveBeenCalledWith(
            `conductor:${conductorId}:activo`,
            '1',
            'EX',
            expect.any(Number)
        );
    });

    it('guarda con la hora actual("no se provee timestap")', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            latitud: -27.451,
            longitud: -58.986,
        };

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/ubicacion`)
            .send(datos);
        //------

        expect(respuesta.status).toBe(200);

        expect(respuesta.body.vigente).toBe(true);
        expect(respuesta.body.timestamp_ubicacion).not.toBeNaN();

        expect(redisMock.hset).toHaveBeenCalledWith(
            `conductor:${conductorId}:ubicacion`,
            expect.objectContaining({timestamp_ubicacion: expect.stringMatching(/\S/)
            })
        );
    });

    it('devuelve 500 si falla HSET', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            latitud: -27.451,
            longitud: -58.986,
            timestamp_ubicacion: '2026-11-08T10:00:00'
        };

        redisMock.hset.mockRejectedValueOnce(undefined);

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/ubicacion`)
            .send(datos);
        //------

        expect(respuesta.status).toBe(500);

        expect(respuesta.body.error).toBe('Fallo interno de telemetría');

        expect(redisMock.hset).toHaveBeenCalledTimes(1);
        expect(redisMock.geoadd).not.toHaveBeenCalled();
        expect(redisMock.set).not.toHaveBeenCalled();
    });

    it('devuelve 500 si falla GEOADD', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            latitud: -27.451,
            longitud: -58.986,
            timestamp_ubicacion: '2026-11-08T10:00:00'
        };

        redisMock.geoadd.mockRejectedValueOnce(undefined);

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/ubicacion`)
            .send(datos);
        //------

        expect(respuesta.status).toBe(500);

        expect(respuesta.body.error).toBe('Fallo interno de telemetría');

        expect(redisMock.hset).toHaveBeenCalledTimes(1);
        expect(redisMock.geoadd).toHaveBeenCalledTimes(1);
        expect(redisMock.set).not.toHaveBeenCalled();
    });

    it('devuelve 500 si falla SET', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            latitud: -27.451,
            longitud: -58.986,
            timestamp_ubicacion: '2026-11-08T10:00:00'
        };

        redisMock.set.mockRejectedValueOnce(undefined);

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/ubicacion`)
            .send(datos);
        //------

        expect(respuesta.status).toBe(500);

        expect(respuesta.body.error).toBe('Fallo interno de telemetría');

        expect(redisMock.hset).toHaveBeenCalledTimes(1);
        expect(redisMock.geoadd).toHaveBeenCalledTimes(1);
        expect(redisMock.set).toHaveBeenCalledTimes(1);
    });

});

describe('PUT/api/v1/conductores/:conductor_id/estado-operativo', () => {
    it('agrega conductor(conectado y disponible)', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            event_id: 'evento-001',
            connected: true,
            available: true
        };

        poolMock.query.mockResolvedValue({
            rows: [
            { tipo_vehiculo: 'MOTO' }
            ]
        });

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/estado-operativo`)
            .send(datos);
        //------

        expect(respuesta.status).toBe(200);

        expect(respuesta.body.conductor_id).toBe(conductorId);
        expect(respuesta.body.event_id).toBe('evento-001');
        expect(respuesta.body.connected).toBe(true);
        expect(respuesta.body.available).toBe(true);

        expect(poolMock.query).toHaveBeenCalledWith(
            "SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1",
            [conductorId]
        );
   
        expect(redisMock.sadd).toHaveBeenCalledWith(
            'conductores:disponibles:MOTO',
            conductorId
        );

        expect(redisMock.srem).not.toHaveBeenCalled();
    });

    it('procesa la solicitud sin parametros', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        poolMock.query.mockResolvedValue({
            rows: [{ tipo_vehiculo: 'MOTO' }]
        });

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/estado-operativo`)
            .send({});
        //------
        
        expect(respuesta.status).toBe(200);

        expect(respuesta.body.conductor_id).toBe(conductorId);
        expect(respuesta.body.event_id).toBe('');
        expect(respuesta.body.connected).toBe(false);
        expect(respuesta.body.available).toBe(false);
        expect(respuesta.body.recibido_en.length).toBeGreaterThan(0);

        expect(poolMock.query).toHaveBeenCalledWith(
            'SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1',
            [conductorId]
        );  

        expect(redisMock.srem).toHaveBeenCalledWith(
            'conductores:disponibles:MOTO',
            conductorId
        );

        expect(redisMock.sadd).not.toHaveBeenCalled();
    });

    it('retira conductor(conectado y no disponible)', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            event_id: 'evento-001',
            connected: true,
            available: false
        };

        poolMock.query.mockResolvedValue({
            rows: [
            { tipo_vehiculo: 'MOTO' }
            ]
        });

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/estado-operativo`)
            .send(datos);
        //-----

        expect(respuesta.status).toBe(200);

        expect(respuesta.body.conductor_id).toBe(conductorId);
        expect(respuesta.body.event_id).toBe('evento-001');
        expect(respuesta.body.connected).toBe(true);
        expect(respuesta.body.available).toBe(false);

        expect(poolMock.query).toHaveBeenCalledWith(
            "SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1",
            [conductorId]
        );

        expect(redisMock.sadd).not.toHaveBeenCalled();

        expect(redisMock.srem).toHaveBeenCalledWith(
            'conductores:disponibles:MOTO',
            conductorId
        );
    });

    it('retira conductor(no conectado)', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            event_id: 'evento-001',
            connected: false,
            available: true
        };

        poolMock.query.mockResolvedValue({
            rows: [
            { tipo_vehiculo: 'MOTO' }
            ]
        });

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/estado-operativo`)
            .send(datos);
        //-----
        
        expect(respuesta.status).toBe(200);

        expect(respuesta.body.conductor_id).toBe(conductorId);
        expect(respuesta.body.event_id).toBe('evento-001');
        expect(respuesta.body.connected).toBe(false);
        expect(respuesta.body.available).toBe(false);

        expect(poolMock.query).toHaveBeenCalledWith(
            "SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1",
            [conductorId]
        );

        expect(redisMock.sadd).not.toHaveBeenCalled();

        expect(redisMock.srem).toHaveBeenCalledWith(
            'conductores:disponibles:MOTO',
            conductorId
        );
    });

    it('utiliza AUTO(querySQL devuelve[])', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            event_id: 'evento-001',
            connected: true,
            available: true
        };

        poolMock.query.mockResolvedValue({
            rows: []
        });

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/estado-operativo`)
            .send(datos);
        //-----

        expect(respuesta.status).toBe(200);

        expect(respuesta.body.conductor_id).toBe(conductorId);
        expect(respuesta.body.event_id).toBe('evento-001');
        expect(respuesta.body.connected).toBe(true);
        expect(respuesta.body.available).toBe(true);

        expect(poolMock.query).toHaveBeenCalledWith(
            "SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1",
            [conductorId]
        );

        expect(redisMock.sadd).toHaveBeenCalledWith(
            'conductores:disponibles:AUTO',
            conductorId);

        expect(redisMock.srem).not.toHaveBeenCalled();
    });

    it('captura error(SQL falla)', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            event_id: 'evento-001',
            connected: true,
            available: true
        };

        poolMock.query.mockRejectedValue(undefined);

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/estado-operativo`)
            .send(datos);
        //-----

        expect(respuesta.status).toBe(500);

        expect(respuesta.body.error).toBe("Error interno al actualizar estado");

        expect(poolMock.query).toHaveBeenCalledWith(
            "SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1",
            [conductorId]
        );

        expect(redisMock.sadd).not.toHaveBeenCalled();
        expect(redisMock.srem).not.toHaveBeenCalled();
    });

    it('captura error(Redis falla)', async () => {
        const conductorId = '00000000-0000-0000-0000-000000000000';

        const datos = {
            event_id: 'evento-001',
            connected: true,
            available: true
        };

        poolMock.query.mockResolvedValue({
            rows: [
            { tipo_vehiculo: 'MOTO' }
            ]
        });

        redisMock.sadd.mockRejectedValue(undefined);

        // ACT
        const respuesta = await request(app)
            .put(`/api/v1/conductores/${conductorId}/estado-operativo`)
            .send(datos);
        //-----

        expect(respuesta.status).toBe(500);

        expect(respuesta.body.error).toBe("Error interno al actualizar estado");

        expect(poolMock.query).toHaveBeenCalledWith(
            "SELECT tipo_vehiculo FROM conductores WHERE conductor_id = $1",
            [conductorId]
        );

        expect(redisMock.sadd).toHaveBeenCalledWith(
            'conductores:disponibles:MOTO',
            conductorId
        );

        expect(redisMock.srem).not.toHaveBeenCalled();
    });
});

describe('GET/api/v1/rutas/estimacion', () => {
    it('crea calculado_en', async () => {
        // ACT
        const respuesta = await request(app)
            .get('/api/v1/rutas/estimacion');
        //----

        expect(respuesta.status).toBe(200);
        //que no tenga 0 caracteres
        expect(respuesta.body.calculado_en.length).toBeGreaterThan(1);

        expect(respuesta.body.distancia_estimada_km).toBe(6.8);
        expect(respuesta.body.eta_minutos).toBe(18);
        expect(respuesta.body.fuente).toBe('estimacion_local');

        expect(Date.parse(respuesta.body.calculado_en)).not.toBeNaN();
    });
});

describe('POST/api/v1/geocodificaciones', () => {
    it('rellena etiqueta con datos', async () => {
        const datos = {
            direccion: 'Av. 9 de Julio 100',
            localidad: 'Buenos Aires',
            pais: 'Argentina'
        };

        // ACT
        const respuesta = await request(app)
            .post('/api/v1/geocodificaciones')
            .send(datos);
        //-----

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.coincidencias[0]).toEqual({
            latitud: -34.6037,
            longitud: -58.3816,
            etiqueta: 'Av. 9 de Julio 100, Buenos Aires, Argentina',
            confianza: 0.95
        });
    });

    it('Utiliza valores predefinidos(no se le pasan datos)', async () => {
        const datos = {};

        // ACT
        const respuesta = await request(app)
            .post('/api/v1/geocodificaciones')
            .send(datos);
        //------
        
        expect(respuesta.status).toBe(200);
        
        //La etiqueta siempre crea las ","
        expect(respuesta.body.coincidencias[0].etiqueta).toBe(
            ', Buenos Aires, '
        );
    });
});

describe('GET/api/v1/conductores/cercanos', () => {
    it('devuelve conductores activos, disponibles y sin reserva', async () => {
        redisMock.geosearch.mockResolvedValue([
            ['id1', '1.23'],
            ['id2', '2.50'],
            ['id3', '3.00'],
            ['id4', '4.00']
        ]);

        redisMock.exists
            .mockResolvedValueOnce(1) 
            .mockResolvedValueOnce(0)

            .mockResolvedValueOnce(0) 
            .mockResolvedValueOnce(0) 

            .mockResolvedValueOnce(1) 
            .mockResolvedValueOnce(0) 

            .mockResolvedValueOnce(1) 
            .mockResolvedValueOnce(1)

        redisMock.sismember
            .mockResolvedValueOnce(1) 
            .mockResolvedValueOnce(1) 
            .mockResolvedValueOnce(0) 
            .mockResolvedValueOnce(1)

        // ACT
        const respuesta = await request(app)
            .get('/api/v1/conductores/cercanos')
            .query({
                origen_latitud: '-27.451',
                origen_longitud: '-58.986',
                tipo_vehiculo: 'AUTO',
                radio_km: '5'
            });
        //-----

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.conductores).toHaveLength(1);

        expect(respuesta.body.conductores[0]).toEqual({
            conductor_id: 'id1',
            distancia_origen_km: 1.23,
            eta_retiro_minutos: 4,
            tipo_vehiculo: 'AUTO'
        });

        expect(respuesta.body.radio_aplicado_km).toBe(5);
        expect(respuesta.body.generado_en.length).toBeGreaterThan(0);
    });


    it('aplica valores predeterminados', async () => {
        redisMock.geosearch.mockResolvedValue([]);

        // ACT
        const respuesta = await request(app)
            .get('/api/v1/conductores/cercanos');
        //-----

        expect(respuesta.status).toBe(200);

        expect(respuesta.body.conductores).toEqual([]);
        expect(respuesta.body.radio_aplicado_km).toBe(5);

        expect(redisMock.geosearch).toHaveBeenCalledWith(
            'conductores_geo',
            'FROMLONLAT', 0, 0,
            'BYRADIUS', 5, 'km',
            'ASC', 'WITHDIST'
        );
    });

    it('no encuentra conductores(respuesta[])', async () => {
        redisMock.geosearch.mockResolvedValue([]);

        // ACT
        const respuesta = await request(app)
            .get('/api/v1/conductores/cercanos')
            .query({
                origen_latitud: '-27.451',
                origen_longitud: '-58.986'
            });
        //-----

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.conductores).toEqual([]);
    });


    it('Debe devolver 500 si falla la búsqueda geoespacial en Redis', async () => {
        redisMock.geosearch.mockRejectedValue(undefined);

        // ACT
        const respuesta = await request(app)
            .get('/api/v1/conductores/cercanos');
        //-----

        expect(respuesta.status).toBe(500);

        expect(respuesta.body).toEqual({
            error: 'Fallo en motor de búsqueda'
        });
    });
});

// RESERVA TEMPORAL O LIBERACIÓN
// SALUD
