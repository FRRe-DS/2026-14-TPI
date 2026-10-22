# Redis de M4 (Ubicación y Dsiponibilidad)

Redis guarda el estado dinámico de los conductores. Postgres/Supabase guarda lo durable (datos estáticos). El vínculo entre ambos es el 'conductorid'. 
Importante: las claves de Redis son internas de nuestra implementación, pero para mantener el mismo vocabulario, usamos los nombres de las variables pactadas en el contrato con los demás grupos.

## Unidades y formatos
| Concepto | Variable del contrato | Formato / unidad |
|----------|-----------------------|------------------|
|Identificador del conductor| `conductor_id` | UUID |
|Timestamp de ubicación (V5)| `timestamp_ubicacion` | ISO 8601 UTC |
|Radio de búsqueda (V6)| `radio_km` | Float, **kilómetros**|
|Tipo de vehiculo (V4)| `tipo_vehiculo` | `AUTO` o `MOTO` | 
|Estado de disponibilidad (V2)| `estado_disponibilidad` | `Disponible`/`No Disponible` |
|Estado temporal (V10)| `estado_temporal` | `Reservado` / `Liberado` |
|Idenitificador de solicitud (V11)| `solicitud_id` | UUID |

## Claves
| Clave | Tipo | Contenido | Expira |
|-------|------|-----------|--------|
| `conductor:{conductor_id}:ubicacion` | Hash | `latitud`, `longitud`, `timestamp_ubicacion`| No |
| `conductores_geo` | GEO (sorted set) | posición de cada conductor (miembro = `conductor_id`) | No (se limpia al expirar `activo`) |
| `conductor:{conductor_id}}:activo` | String | `"1"` | Sí: `UBICACION_TTL_SEGUNDOS` (30 s) |
| `conductores:disponibles:{tipo_vehiculo}` | Set | `conductor_id` de los conductores con `estado_disponibilidad = Disponible`, uno por tipo: `condcutores:disponibles:dispoinbles:AUTO` y por tipo: `conductores:disponibles:MOTO`| No |
| `conductor:{conductor_id}:reserva` | String | `solicitud_id` que lo retiene (`estado_temporal = Reservado`) | Sí: `HOLD_DURACION_SEGUNDOS` (30 s) |

Valores de TTL (30 s en el compose de ejemplo): a acordar con el grupo; el contrato solo establece que las ubicaciones vencen por TTL.

## Reglas
- Longitud primero en comandos GEO: `GEOADD conductores:geo <longitud> <latitud> <conductor_id>`.
- Cada ping del GPS: actualizar `ubicacion`, `conductores:geo` y renovar `activo`, juntos.
- Los miembros de un GEO no tienen TTL propio: si `activo` expiró, hay que sacar
  al conductor de `conductores_geo` y de `conductores:disponibles:*` y borrar su hash `ubicacion`.
- Si `activo` no existe, el conductor se considera desconectado: la API responde 404 (ubicacion expirada).
- Conductores cercanos (`GET /api/v1/conductores/cercanos`): el radio llega en `radio_km` desde M5; si no hay candidatos, M5 vuelve a consultar con un radio mayor.
  `GEOSEARCH conductores_geo FROMLONLAT <origen_longitud> <origen_latitud> BYRADIUS <radio_km> km ASC WITHDIST`
  y filtrar con `SISMEMBER conductores:disponibles:<tipo_vehiculo> <conductor_id>`. Las distancias de `WITHDIST` salen en km.
- Reserva temporal (`POST /api/v1/conductores/{conductor_id}/reserva`):
  `SET conductor:{conductor_id}:reserva <solicitud_id> NX EX <HOLD_DURACION_SEGUNDOS>`.
  Si devuelve `nil`, ya estaba reservado por otra solicitud (409). Si devuelve `OK` (201), sacar al conductor de `conductores:disponibles:*` para que no aparezca en búsquedas concurrentes.
- Liberar (`estado_temporal = Liberado`): `DEL conductor:{conductor_id}:reserva`. Volver a ponerlo en `conductores:disponibles:{tipo_vehiculo}` solo si sigue en estado Disponible.
- Cambio de estado desde M3 (`No Disponible`, suspendido o deshabilitado): quitar al conductor de `conductores:disponibles:*`. M3 filtra los conductores no habilitados, por eso Redis no guarda `estado_habilitacion`.
- Ids como texto: usar el mismo formato siempre (UUID en minúsculas) para que las claves coincidan entre escrituras y lecturas.

## Pendientes de definir
- Valores finales de `UBICACION_TTL_SEGUNDOS` y `HOLD_DURACION_SEGUNDOS`.
- Qué pasa con la disponibilidad cuando vence una reserva sin que M5 la libere.

## Conexión
- Desde otro contenedor del compose: `redis://redis:6379`
- Desde la PC: `redis://localhost:6379`
