# Guía de uso de la base de datos

Guía para quienes programan los endpoints de M4 en Node: cómo conectarse, qué reglas tienen los datos y cómo hacer las operaciones principales.

El código de esta guía se probó contra la base real (las mismas migraciones, en Postgres 17), incluida una carrera de 10 reservas simultáneas sobre el mismo conductor. Se puede copiar tal cual y adaptar a la estructura del backend.

- Estructura de la base: [`supabase/migrations`](../supabase/migrations)
- Cómo se crean y aplican migraciones: [`supabase/README.md`](../supabase/README.md)
- Pruebas de la base: [`tests/base-de-datos`](../tests/base-de-datos)
- Tablas que todavía no existen: [`supabase/tablas-futuras.md`](../supabase/tablas-futuras.md)

**Ante cualquier cambio que necesites en la base** (una columna, un índice, otra tabla), pedilo a quien está a cargo de la base: entra como migración nueva por la rama `base-de-datos`, con sus pruebas. No se cambia nada desde el panel de Supabase.

---

## 1. Qué hay en la base

Todo está en el esquema `m4`.

| Tabla | Para qué | Clave |
|---|---|---|
| `conductor` | Conductores que informa M3 y su estado de disponibilidad. | `id`: el mismo id de M3 |
| `ubicacion_actual` | Última posición de cada conductor (una fila por conductor). | `conductor_id` |
| `reserva_temporal` | Reservas (holds) que pide M5 mientras ofrece un viaje. | `id` propio; una sola `ACTIVA` por conductor |
| `historial_disponibilidad` | Un registro por cada cambio de estado de un conductor. | `id` propio |
| `direccion_simulada` | Catálogo de direcciones del proveedor de mapas simulado. | `direccion_normalizada` única |

Valores permitidos (se guardan **exactamente así**, en mayúsculas):

| Columna | Valores |
|---|---|
| `conductor.tipo_vehiculo` | `AUTO`, `MOTO` |
| `conductor.estado_habilitacion` | `APROBADO`, `SUSPENDIDO` |
| `conductor.estado` | `DESCONECTADO`, `NO_DISPONIBLE`, `DISPONIBLE`, `RESERVADO`, `EN_VIAJE` |
| `reserva_temporal.estado` | `ACTIVA`, `CONFIRMADA`, `LIBERADA`, `VENCIDA` |
| `historial_disponibilidad.origen` | `M3`, `M5`, `M6`, `CONDUCTOR`, `SISTEMA` |

## 2. Reglas de los datos

- **Ids de otros módulos** (`conductor_id` de M3, `solicitud_id` de M5): se guardan como texto, tal cual llegan, de 1 a 64 caracteres. Para la base `"ABC"` y `"abc"` son ids distintos: si son UUID, pasarlos a minúsculas antes de guardarlos o de buscarlos.
- **Ids propios** (`reserva_temporal.id`, `historial_disponibilidad.id`): los genera la base. Llegan a Node como **texto** (`"15"`), no como número.
- **Fechas**: `timestamptz`, siempre en UTC. Llegan a Node como `Date` y al convertirlas a JSON quedan en ISO 8601 (`2026-10-15T14:03:00.000Z`), que es lo que pide el contrato.
- **Coordenadas**: siempre en orden latitud, longitud. Latitud de −90 a 90 y longitud de −180 a 180.
- **Unidades**: distancias en **km** y ETA en **minutos**, como el contrato con G3. Las duraciones internas (TTL, hold) en segundos.
- **Privacidad** (RF-4.7, RNF-19): la base no guarda datos personales, solo ids. No escribir coordenadas en los logs.
- **Nombres**: la base usa `snake_case` (`conductor_id`) y la API usa los nombres del contrato. La traducción se hace en el backend, al armar la respuesta.

## 3. Conexión desde Node

Se usa el driver [`pg`](https://node-postgres.com) (`npm install pg`). **No usar `supabase-js`**: depende de la Data API, que está desactivada, no existe en el Postgres del docker-compose y no permite transacciones.

Variables del `.env` (ver [`.env.example`](../.env.example)):

| Variable | Supabase | Postgres local (Docker) |
|---|---|---|
| `DATABASE_URL` | Cadena del **Session pooler** | `postgresql://postgres:<contraseña>@<host>:5432/postgres` |
| `DB_SSL` | `true` | `false` |

Un solo pool para todo el proceso:

```js
// db.js
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
});

// Sin esto, si se corta una conexión que estaba libre en el pool, el proceso se cae.
pool.on('error', (error) => console.error('Error en una conexión libre de la base', error.message));

// Ejecuta `trabajo` dentro de una transacción: si algo falla, no queda nada a medias.
export async function enTransaccion(trabajo) {
  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    const resultado = await trabajo(cliente);
    await cliente.query('commit');
    return resultado;
  } catch (error) {
    await cliente.query('rollback');
    throw error;
  } finally {
    cliente.release();
  }
}
```

Reglas:

- **Siempre con el esquema**: `m4.conductor`, nunca `conductor` solo. Así no depende de la configuración de la conexión.
- **Siempre con parámetros** (`$1`, `$2`…), nunca armando el SQL con `+` o con template strings. Concatenar abre la puerta a inyección SQL (RNF-12).
- **`max: 5`**: el Session pooler de Supabase tiene pocas conexiones y las comparte todo el grupo. Un pool por proceso, no uno por pedido.
- `rejectUnauthorized: false` acepta el certificado de Supabase sin verificarlo. Alcanza para desarrollo; para la versión publicada se puede descargar el certificado del panel de Supabase y pasarlo en `ssl.ca`.
- Una operación que escribe en más de una tabla va en `enTransaccion`. Dentro, usar el `cliente` que recibe la función, no `pool`: si no, esa consulta queda fuera de la transacción.

## 4. Errores de la base y códigos HTTP

Cuando una regla de la base rechaza algo, `pg` lanza un error con `error.code` (tipo de error de Postgres) y `error.constraint` (nombre de la regla). Con eso se elige la respuesta RFC 7807:

```js
const ERRORES_POR_RESTRICCION = {
  ubicacion_actual_conductor_fk: { status: 404, title: 'Conductor inexistente' },
  reserva_temporal_conductor_fk: { status: 404, title: 'Conductor inexistente' },
  reserva_temporal_conductor_activa_uk: { status: 409, title: 'Conductor ya reservado' },
  reserva_temporal_solicitud_conductor_uk: { status: 409, title: 'Reserva ya cerrada para esta solicitud' },
};

export function errorDeBase(error) {
  const conocido = ERRORES_POR_RESTRICCION[error.constraint];
  if (conocido) return conocido;
  // 23514: no cumple un check (valor fuera de rango o de la lista). 22P02: formato inválido.
  if (error.code === '23514' || error.code === '22P02') return { status: 400, title: 'Datos inválidos' };
  return { status: 500, title: 'Error interno' };
}
```

Los `check` de la base son la **última defensa**: los datos se validan primero en el endpoint, para devolver un 400 con un `detail` claro (por ejemplo, "La latitud debe estar entre -90 y 90"). Nunca mandar `error.message` de Postgres al cliente: puede mostrar nombres de tablas y datos.

Lista completa de reglas, por tabla: ver las migraciones o [`tests/base-de-datos/restricciones`](../tests/base-de-datos/restricciones).

## 5. Operaciones

### 5.1 Registrar o actualizar un conductor (datos de M3)

Crea el conductor si no existe o actualiza sus datos si ya existe. No toca su estado: un conductor nuevo arranca en `DESCONECTADO`.

```js
export async function sincronizarConductor({ conductorId, tipoVehiculo, estadoHabilitacion }) {
  await pool.query(
    `insert into m4.conductor (id, tipo_vehiculo, estado_habilitacion)
     values ($1, $2, $3)
     on conflict (id) do update
       set tipo_vehiculo = excluded.tipo_vehiculo,
           estado_habilitacion = excluded.estado_habilitacion,
           sincronizado_en = now()`,
    [conductorId, tipoVehiculo, estadoHabilitacion],
  );
}
```

### 5.2 Cambiar el estado de un conductor

Todo cambio de estado **deja un registro en el historial**, en la misma transacción. Bloquea la fila del conductor (`for update`) para que dos cambios simultáneos no se pisen. Si el estado ya era ese, no hace nada.

```js
// `db` es el cliente que recibe enTransaccion.
export async function cambiarEstado(db, { conductorId, nuevo, origen, referenciaId = null, correlacionId = null }) {
  const { rows: [conductor] } = await db.query(
    'select estado from m4.conductor where id = $1 for update', [conductorId]);
  if (!conductor) return false;
  if (conductor.estado === nuevo) return true;
  await db.query(
    'update m4.conductor set estado = $2, actualizado_en = now() where id = $1', [conductorId, nuevo]);
  await db.query(
    `insert into m4.historial_disponibilidad
       (conductor_id, estado_anterior, estado_nuevo, origen, referencia_id, correlacion_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [conductorId, conductor.estado, nuevo, origen, referenciaId, correlacionId]);
  return true;
}

// Uso: M3 avisa que el conductor se conectó.
await enTransaccion((db) => cambiarEstado(db, { conductorId, nuevo: 'DISPONIBLE', origen: 'M3', correlacionId }));
```

Qué transiciones están permitidas (por ejemplo, si M3 puede pasar a `NO_DISPONIBLE` a un conductor `RESERVADO`) lo define la máquina de estados de Disponibilidad, antes de llamar a esta función. `correlacionId` es el id de la petición (RNF-14).

### 5.3 Guardar la ubicación (RF-4.1)

Guarda la posición o reemplaza la anterior, **solo si es más nueva** que la guardada: si por la red llega tarde una posición vieja, se ignora.

```js
export async function guardarUbicacion({ conductorId, latitud, longitud, precisionKm = null, registradaEn }) {
  const { rowCount } = await pool.query(
    `insert into m4.ubicacion_actual (conductor_id, latitud, longitud, precision_km, registrada_en)
     values ($1, $2, $3, $4, $5)
     on conflict (conductor_id) do update
       set latitud = excluded.latitud,
           longitud = excluded.longitud,
           precision_km = excluded.precision_km,
           registrada_en = excluded.registrada_en,
           recibida_en = now()
       where m4.ubicacion_actual.registrada_en < excluded.registrada_en`,
    [conductorId, latitud, longitud, precisionKm, registradaEn],
  );
  return rowCount === 1; // false: era más vieja que la guardada y se ignoró
}
```

- Si el conductor no existe en la base (M3 todavía no lo informó), falla con `ubicacion_actual_conductor_fk` → 404.
- Antes de llamarla, el endpoint rechaza con 400 un `registradaEn` en el futuro o más viejo que el TTL.
- `registradaEn` es la hora en que el celular tomó la posición. La hora de llegada al servidor (`recibida_en`) la pone la base y es la que se usa para el vencimiento.

### 5.4 Buscar conductores cercanos (RF-4.2, RF-4.3)

Devuelve los conductores `DISPONIBLE`, `APROBADO`, del tipo pedido, con ubicación vigente y dentro del radio, del más cercano al más lejano.

```js
export async function buscarCercanos({ latitud, longitud, tipoVehiculo, radioKm, ttlSegundos, limite }) {
  const { rows } = await pool.query(
    `select conductor_id, tipo_vehiculo, latitud, longitud, registrada_en, distancia_km
       from (
         select c.id as conductor_id, c.tipo_vehiculo, u.latitud, u.longitud, u.registrada_en,
                2 * 6371 * asin(least(1, sqrt(
                  power(sin(radians(u.latitud - $1::float8) / 2), 2)
                  + cos(radians($1::float8)) * cos(radians(u.latitud))
                    * power(sin(radians(u.longitud - $2::float8) / 2), 2)
                ))) as distancia_km
           from m4.conductor c
           join m4.ubicacion_actual u on u.conductor_id = c.id
          where c.estado = 'DISPONIBLE'
            and c.estado_habilitacion = 'APROBADO'
            and c.tipo_vehiculo = $3
            and u.recibida_en > now() - make_interval(secs => $5::float8)
            and u.latitud between $1::float8 - $4::float8 / 111.32 and $1::float8 + $4::float8 / 111.32
            and u.longitud between $2::float8 - $4::float8 / (111.32 * cos(radians($1::float8)))
                               and $2::float8 + $4::float8 / (111.32 * cos(radians($1::float8)))
       ) candidatos
      where distancia_km <= $4::float8
      order by distancia_km
      limit $6`,
    [latitud, longitud, tipoVehiculo, radioKm, ttlSegundos, limite],
  );
  return rows; // [] si no hay nadie
}
```

- `distancia_km` es la distancia en línea recta (fórmula de haversine), no por calles.
- Las dos condiciones `between` arman un cuadrado alrededor del origen para descartar rápido a los que están lejos; después se calcula la distancia exacta.
- Si la lista vuelve vacía, qué responder (200 con `[]` o ampliar el radio) lo define el contrato.

### 5.5 Reservar un conductor (hold, RF-4.4 y RNF-08)

Es la operación más delicada: dos solicitudes no pueden reservar al mismo conductor. Todo pasa en una sola transacción y empieza bloqueando la fila del conductor, así que dos reservas simultáneas del mismo conductor se resuelven de a una. La regla `reserva_temporal_conductor_activa_uk` queda de respaldo.

```js
export async function reservarConductor({ conductorId, solicitudId, duracionSegundos, correlacionId = null }) {
  return enTransaccion(async (db) => {
    // 1. Bloquea al conductor hasta el final de la transacción.
    const { rows: [conductor] } = await db.query(
      'select estado, estado_habilitacion from m4.conductor where id = $1 for update', [conductorId]);
    if (!conductor) return { resultado: 'CONDUCTOR_INEXISTENTE' };

    // 2. Si tenía una reserva activa que ya venció, la cierra y lo devuelve a DISPONIBLE
    //    (por si la tarea periódica todavía no pasó).
    const { rows: vencidas } = await db.query(
      `update m4.reserva_temporal
          set estado = 'VENCIDA', cerrada_en = now(), motivo_cierre = 'Venció sin confirmar'
        where conductor_id = $1 and estado = 'ACTIVA' and vence_en <= now()
       returning id`,
      [conductorId]);
    if (vencidas.length > 0 && conductor.estado === 'RESERVADO') {
      await cambiarEstado(db, {
        conductorId, nuevo: 'DISPONIBLE', origen: 'SISTEMA', referenciaId: String(vencidas[0].id), correlacionId,
      });
      conductor.estado = 'DISPONIBLE';
    }

    // 3. Idempotencia: si esta solicitud ya reservó a este conductor, devuelve esa reserva.
    const { rows: [previa] } = await db.query(
      'select * from m4.reserva_temporal where solicitud_id = $1 and conductor_id = $2', [solicitudId, conductorId]);
    if (previa) return { resultado: previa.estado === 'ACTIVA' ? 'EXISTENTE' : 'CERRADA', reserva: previa };

    // 4. Solo se reserva a un conductor disponible y aprobado.
    if (conductor.estado !== 'DISPONIBLE' || conductor.estado_habilitacion !== 'APROBADO') {
      return { resultado: 'NO_DISPONIBLE' };
    }

    // 5. Crea la reserva y pasa al conductor a RESERVADO, con su historial.
    const { rows: [reserva] } = await db.query(
      `insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
       values ($1, $2, now() + make_interval(secs => $3::float8))
       returning *`,
      [conductorId, solicitudId, duracionSegundos]);
    await cambiarEstado(db, { conductorId, nuevo: 'RESERVADO', origen: 'M5', referenciaId: solicitudId, correlacionId });
    return { resultado: 'CREADA', reserva };
  });
}
```

| `resultado` | Qué pasó | Respuesta |
|---|---|---|
| `CREADA` | Se reservó. | 201 |
| `EXISTENTE` | La misma solicitud ya lo tenía reservado (reintento de M5). Devuelve la misma reserva. | 200 (pendiente de acordar con G3: 200 o 201) |
| `CERRADA` | Esta solicitud ya lo había reservado y esa reserva se liberó, confirmó o venció. | 409 |
| `NO_DISPONIBLE` | Lo reservó otra solicitud, no está disponible o no está aprobado. | 409 |
| `CONDUCTOR_INEXISTENTE` | M3 no lo informó. | 404 |

### 5.6 Liberar una reserva

M5 avisa que ya no necesita al conductor. Cierra la reserva activa y lo devuelve a `DISPONIBLE`.

```js
export async function liberarReserva({ conductorId, solicitudId, motivo, correlacionId = null }) {
  return enTransaccion(async (db) => {
    const { rows: [reserva] } = await db.query(
      `update m4.reserva_temporal
          set estado = 'LIBERADA', cerrada_en = now(), motivo_cierre = $3
        where conductor_id = $1 and solicitud_id = $2 and estado = 'ACTIVA'
       returning *`,
      [conductorId, solicitudId, motivo]);
    if (!reserva) return { resultado: 'SIN_RESERVA_ACTIVA' };
    await cambiarEstado(db, { conductorId, nuevo: 'DISPONIBLE', origen: 'M5', referenciaId: solicitudId, correlacionId });
    return { resultado: 'LIBERADA', reserva };
  });
}
```

`motivo` tiene como máximo 200 caracteres. **Confirmar** una reserva sigue el mismo patrón con `estado = 'CONFIRMADA'`; a qué estado pasa el conductor y si se liberan las otras reservas activas de la misma solicitud lo define la máquina de estados de Disponibilidad.

### 5.7 Tareas periódicas

Dos tareas que el backend corre cada pocos segundos (por ejemplo con `setInterval`, cada 5 s):

```js
// Cierra las reservas activas vencidas y devuelve esos conductores a DISPONIBLE, con historial.
export async function vencerReservas() {
  const { rowCount } = await pool.query(
    `with vencidas as (
       update m4.reserva_temporal
          set estado = 'VENCIDA', cerrada_en = now(), motivo_cierre = 'Venció sin confirmar'
        where estado = 'ACTIVA' and vence_en <= now()
       returning id, conductor_id
     ), liberados as (
       update m4.conductor c
          set estado = 'DISPONIBLE', actualizado_en = now()
         from vencidas v
        where c.id = v.conductor_id and c.estado = 'RESERVADO'
       returning c.id as conductor_id, v.id as reserva_id
     )
     insert into m4.historial_disponibilidad (conductor_id, estado_anterior, estado_nuevo, origen, referencia_id)
     select conductor_id, 'RESERVADO', 'DISPONIBLE', 'SISTEMA', reserva_id::text from liberados`);
  return rowCount; // conductores liberados
}

// Borra las ubicaciones vencidas (RF-4.3 y RF-4.7: no conservar posiciones sin propósito).
export async function purgarUbicacionesVencidas(ttlSegundos) {
  const { rowCount } = await pool.query(
    'delete from m4.ubicacion_actual where recibida_en <= now() - make_interval(secs => $1::float8)',
    [ttlSegundos]);
  return rowCount;
}
```

Es una sola consulta cada una: si corren dos instancias del backend a la vez, no se pisan.

### 5.8 Geocodificación simulada (RF-4.5)

```js
// Dirección -> coordenadas. Recibe la dirección ya normalizada (minúsculas, sin tildes ni abreviaturas).
export async function geocodificar(direccionNormalizada) {
  const { rows: [direccion] } = await pool.query(
    'select direccion, latitud, longitud, ciudad from m4.direccion_simulada where direccion_normalizada = $1',
    [direccionNormalizada]);
  return direccion ?? null; // null -> 404
}

// Coordenadas -> la dirección del catálogo más cercana.
export async function geocodificarInversa({ latitud, longitud }) {
  const { rows: [direccion] } = await pool.query(
    `select direccion, latitud, longitud, ciudad
       from m4.direccion_simulada
      order by power(latitud - $1::float8, 2) + power((longitud - $2::float8) * cos(radians($1::float8)), 2)
      limit 1`,
    [latitud, longitud]);
  return direccion ?? null;
}
```

La función que normaliza el texto de la dirección vive en el backend y tiene que ser la misma que se usa para cargar el catálogo.

## 6. Qué no hacer

- Cambiar la estructura desde el panel de Supabase (Table Editor o SQL Editor). Todo cambio es una migración.
- Usar `supabase-js` o la Data API.
- Armar SQL concatenando texto.
- Escribir en más de una tabla fuera de una transacción.
- Cambiar `conductor.estado` sin registrar el historial: usar `cambiarEstado`.
- Leer o escribir tablas de otro módulo (RNF-05). Lo que se necesite de M3 o M5 se pide por su API o llega por evento.
- Guardar nombres, documentos, patentes u otros datos personales, o escribir coordenadas en los logs.
- Mandar al cliente el mensaje de error de Postgres.
