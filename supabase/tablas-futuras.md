# Tablas futuras

Tablas que están en el diagrama de la base pero que **todavía no tienen migración**.
Cuando se necesiten, se crean con una migración nueva (`npx supabase migration new crear_tabla_<nombre>`), siguiendo las [convenciones](README.md#convenciones-de-nombres).

| Tabla | Cuándo entra | Por qué todavía no |
|---|---|---|
| `evento_outbox` | TP2 (RNF-09, RNF-10) | Hace falta recién cuando M4 publique eventos por RabbitMQ. |
| `evento_procesado` | TP2 (RNF-09) | Par de `evento_outbox` para consumir eventos de M3/M5/M6 sin duplicar efectos. |
| `configuracion` | Cuando el Operador tenga que cambiar parámetros sin reiniciar | Por ahora los parámetros van como variables de entorno. |
| `historial_ubicacion` | Solo si la demo necesita mostrar recorridos | RF-4.7: no conservar posiciones sin un propósito definido. |
| `cache_ruta` | Solo con un proveedor de mapas real | Con el simulado el cálculo es instantáneo; en TP2 el caché va en Redis. |

---

## `evento_outbox`

Eventos que M4 tiene que publicar a otros módulos. Se escribe **en la misma transacción** que el cambio de estado que lo origina; un proceso aparte lo publica y marca `publicado_en`.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` PK | Es el id del evento: los consumidores lo usan para detectar duplicados. |
| `tipo` | `text` | Nombre del evento según el catálogo común con G3. |
| `payload` | `jsonb` | Contenido del evento. |
| `correlacion_id` | `text` null | Id de la petición que lo generó (RNF-14). |
| `creado_en` | `timestamptz` | |
| `publicado_en` | `timestamptz` null | Null mientras está pendiente. |
| `intentos` | `integer` default 0 | Reintentos de publicación (RNF-13). |
| `ultimo_error` | `text` null | |

Índice parcial `(creado_en) where publicado_en is null` para buscar pendientes.

## `evento_procesado`

Eventos de otros módulos que M4 ya consumió (inbox). Antes de aplicar un evento se inserta su id; si ya existía, se descarta.

| Columna | Tipo | Nota |
|---|---|---|
| `evento_id` | `uuid` PK | Id que manda el módulo que publicó. |
| `tipo` | `text` | |
| `procesado_en` | `timestamptz` | |

## `configuracion`

Parámetros de negocio que el Operador puede ajustar. Si se crea, pasa a ser **la única fuente** de esos valores: se cargan los iniciales en la migración y se dejan de leer del entorno. Nunca secretos ni URLs (RNF-06).

| Columna | Tipo | Nota |
|---|---|---|
| `clave` | `text` PK | Nombre del parámetro, con la unidad. |
| `valor` | `text` | El backend lo valida y convierte al leerlo. |
| `descripcion` | `text` | Para qué sirve. |
| `actualizada_en` | `timestamptz` | |

Claves previstas: `UBICACION_TTL_SEGUNDOS`, `CERCANOS_RADIO_INICIAL_KM`, `CERCANOS_PASO_KM`, `CERCANOS_RADIO_MAXIMO_KM`, `CERCANOS_LIMITE_RESULTADOS`, `HOLD_DURACION_SEGUNDOS`, `ETA_VELOCIDAD_PROMEDIO_KMH`, `ETA_FACTOR_DESVIO`.

## `historial_ubicacion`

Posiciones pasadas de cada conductor. Mismas columnas que `ubicacion_actual` más un id propio.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | `bigint generated always as identity` PK | |
| `conductor_id` | `text` FK a `conductor` | |
| `latitud`, `longitud` | `double precision` | Con `check` de rango. |
| `precision_km` | `real` null | |
| `registrada_en` | `timestamptz` | Cuándo la tomó el celular. |
| `recibida_en` | `timestamptz` | Se usa para purgar. |

Índices `(recibida_en)` para la purga y `(conductor_id, recibida_en)` para el recorrido. Necesita un job que borre lo más viejo que la retención definida (RF-4.7).

## `cache_ruta`

Distancia y ETA ya calculados entre dos puntos, para no volver a pagarle al proveedor de mapas. Si llega a hacer falta, conviene resolverlo en Redis con TTL (RNF-11) y no en Postgres.
