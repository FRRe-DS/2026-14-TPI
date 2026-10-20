# UTN FRRE - Trabajo Práctico Integrador: Desarrollo de Software

## Módulo 4: Ubicación y Disponibilidad

*Materia:* Desarrollo de Software  
*Universidad:* Universidad Tecnológica Nacional – Facultad Regional Resistencia  
*Comisión:* Grupo 14  


# Integrantes - Grupo 14
* Tomás AHLBOM
* Ana Paula GOMEZ GOUIRIC
* Malena Jazmín GUZMAN
* Martina Montserrat MANZANARES MEDINA
* Emilia RAPISARDA MARTÍNEZ ROLÓN
* Ariana Milena RODRIGUEZ SCORDO
* Victoria MARTIN RODICH
* Rodrigo Mariano VALDEZ
* Maximiliano SUSTER
* Axel Josué TERUEL


# 1. Descripción del Módulo

El Módulo 4 (Ubicación y Disponibilidad) es responsable de gestionar y determinar en tiempo real la posición geográfica vigente del conductor, su disponibilidad operativa, la proximidad a los clientes, el cálculo de distancias de recorrido y el Tiempo Estimado de Llegada (ETA).

# Integración con otros Módulos
* M3 (Conductores y Vehículos): consulta el perfil de los conductores, validando su estado de habilitación (`Aprobado`, `Suspendido`) y cambios de disponibilidad (`Disponible`, `No Disponible`).
* M5 (Solicitud y Despacho): provee el listado de conductores disponibles/cercanos filtrados por tipo de vehículo (`AUTO`, `MOTO`) y gestiona reservas temporales de conductores durante las ofertas de viaje.
* M7 (Tarifas, Pagos y Liquidaciones) y M9 (Reservas de Viajes): provee estimaciones de distancia (`km`) y tiempo (`minutos`) requeridas para el cálculo de tarifas y la planificación de viajes diferidos.
* API de Mapas Externa: interfaz con proveedor externo (o servicio simulado) para geocodificación, trazado de rutas y cálculo de tiempos/distancias.


# 2. Requerimientos Funcionales (RF)

| ID | Requerimiento | Descripción |
| :--- | :--- | :--- |
| **RF-4.1** | Actualización de ubicación | Recibe coordenadas geográficas del conductor con marca temporal (`ISO 8601 UTC`) mientras permanezca conectado. |
| **RF-4.2** | Conductores cercanos | Consulta conductores disponibles y habilitados próximos a una ubicación de origen según el tipo de vehículo solicitado. |
| **RF-4.3** | Vencimiento de ubicación | Exclusión automática de ubicaciones antiguas mediante tiempo de vida (TTL) configurable para evitar "conductores fantasma". |
| **RF-4.4** | Cambio de disponibilidad | Refleja cambios de disponibilidad y gestiona la reserva temporal de un conductor durante un proceso de despacho o asignación. |
| **RF-4.5** | Geocodificación | Resolución de direcciones físicas a coordenadas (y viceversa) mediante un proveedor externo o simulador. |
| **RF-4.6** | ETA y distancia | Estimación de distancia (`km`) y tiempo de llegada (`minutos`) para apoyo al despacho, cálculo de tarifas y cancelaciones. |
| **RF-4.7** | Privacidad de ubicación | Limitación estricta de la conservación y exposición de coordenadas al contexto y ventana temporal del viaje. |



# 3. Requerimientos No Funcionales (RNF) y Decisiones de Arquitectura

**RNF-01 (Libertad Tecnológica):**
  * Lenguaje: TypeScript.
  * Runtime / Framework Backend: Node.js con Express.js.
  * TypeScript garantiza tipado estático fuertemente alineado con los esquemas de OpenAPI, reduciendo fallas en tiempo de ejecución y asegurando consistencia en los contratos de datos entre microservicios.


**RNF-03 (Contratos y Manejo de Errores):**
  * Estándar de errores basado en RFC 7807 (Problem Details for HTTP APIs), devolviendo un objeto JSON homogéneo con los campos `type`, `title`, `status`, `detail` e `instance`.


**RNF-05 (Propiedad de Datos y Persistencia):**
  * Base de datos: PostgreSQL hospedado en Supabase.
  * Autonomía estricta de persistencia: queda prohibida la consulta o modificación directa sobre tablas pertenencias a otros módulos.
  * *Para ver la guía de configuración de la base de datos, migraciones y convenciones, consultar la [Guía de Supabase en `/supabase`](./supabase/README.md)*.


# 4. Contrato de API (OpenAPI Specs)

Acordado en conjunto entre Grupo 14 y Grupo 3

## Endpoints Principales

1.`POST /api/v1/ubicaciones`
* Propósito: registrar/actualizar la posición y timestamp del conductor (RF-4.1).
* Body: `conductor_id` (UUID/Text), `latitud` (Float), `longitud` (Float), `timestamp_ubicacion` (ISO 8601 UTC).

2.`GET /api/v1/conductores/cercanos`
* Propósito: obtener listado de conductores disponibles y habilitados cercanos a una posición (RF-4.2).
* Query Params: `origen_latitud`, `origen_longitud`, `tipo_vehiculo` (`AUTO` / `MOTO`), `radio_km`.

3.`POST /api/v1/conductores/{conductor_id}/reserva`
* Propósito: realizar reserva temporal (`Reservado` / `Liberado`) de un conductor para evitar asignaciones concurrentes (RF-4.4).
* Body: `estado_temporal`, `solicitud_id`.

4.`GET /api/v1/rutas/estimacion`
* Propósito: calcular distancia estimada (`km`) y tiempo estimado (`minutos`) entre origen y destino (RF-4.6).
* Query Params: `origen_latitud`, `origen_longitud`, `destino_latitud`, `destino_longitud`.
* Response: `distancia_estimada_km` (Float), `eta_minutos` (Integer).

# Respuestas HTTP Standard
* `200 OK` / `201 Created`: operación procesada exitosamente.
* `400 Bad Request`: error en tipos de datos o coordenadas/radio fuera de rango.
* `404 Not Found`: conductor inexistente o ubicación caducada (TTL).
* `409 Conflict`: intento de reserva sobre un conductor bloqueado simultáneamente por otra oferta.
* `500 Internal Server Error`: fallo de base de datos o indisponibilidad del servicio de mapas.
