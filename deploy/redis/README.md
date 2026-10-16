# Redis de M4 (Ubicación y Dsiponibilidad)

Redis guarda el estado dinámico de los conductores. Postgres/Supabase guarda lo durable (datos estáticos). El vínculo entre ambos es el 'conductorid'.

## Claves
| Clave | Tipo | Contenido | Expira |
|-------|------|-----------|--------|
| `driver:{id}:location` | Hash | `lat`, `lng`, `recibida_en` (epoch en segundos) | No |
| `drivers:geo` | GEO (sorted set) | posición de cada conductor (miembro = `{id}`) | No (se limpia al expirar `alive`) |
| `driver:{id}:alive` | String | `"1"` | Sí: `UBICACION_TTL_SEGUNDOS` (30 s) |
| `drivers:available` | Set | ids de conductores disponibles | No |
| `driver:{id}:hold` | String | id de la reserva que lo retiene | Sí: `HOLD_DURACION_SEGUNDOS` (30 s) |

## Reglas
- Longitud primero en comandos GEO: `GEOADD drivers:geo <lng> <lat> <id>`.
- Cada ping del GPS: actualizar `location`, `drivers:geo` y renovar `alive`, juntos.
- Los miembros de un GEO no tienen TTL propio: si `alive` expiró, hay que sacar
  al conductor de `drivers:geo` y de `drivers:available`.
- Hold: `SET driver:{id}:hold {reservaId} NX EX 30`. Si devuelve nil, ya estaba reservado.
- Cercanos: `GEOSEARCH drivers:geo FROMLONLAT <lng> <lat> BYRADIUS <metros> m ASC WITHDIST`
  y filtrar por pertenencia a `drivers:available`

## Conexión
- Desde otro contenedor del compose: `redis://redis:6379`
- Desde la PC: `redis://localhost:6379`