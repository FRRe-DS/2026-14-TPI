# Pruebas de la base de datos

Verifican que las migraciones de [`supabase/migrations`](../../supabase/migrations) se aplican sin errores y que las reglas de la base (restricciones, claves únicas, claves foráneas) aceptan lo válido y rechazan lo inválido.

Corren contra un **Postgres descartable en Docker**: no tocan la base compartida de Supabase y se pueden correr las veces que haga falta.

## Cómo correrlas

Requisitos: Docker Desktop abierto y Node 18 o superior. No hace falta instalar nada más.

Desde la raíz del repo:

```bash
node tests/base-de-datos/correr-pruebas.mjs
```

El script:

1. Levanta un contenedor `postgres:17-alpine`, la misma versión mayor que Supabase.
2. Aplica las migraciones en orden, cada una en una transacción, como `npx supabase db push`.
3. Corre cada archivo de [`restricciones/`](restricciones).
4. Prueba dos reservas simultáneas sobre el mismo conductor: solo una puede quedar activa (RNF-08).
5. Borra el contenedor y termina con código 0 si todo pasó, o 1 si algo falló (sirve para CI).

La primera vez descarga la imagen de Postgres (unos 100 MB); después tarda pocos segundos.

## Cuándo correrlas

- **Antes de subir una migración nueva** y antes de `npx supabase db push`. Si una migración tiene un error de SQL, acá aparece sin romper la base compartida.
- Después de cambiar una regla, para confirmar que no se rompió otra.

## Estructura

```
tests/base-de-datos/
├── correr-pruebas.mjs     # levanta Postgres, aplica migraciones y corre todo
├── utilidades.sql         # funciones espera_ok / espera_error
└── restricciones/         # un archivo por tabla
    ├── conductor.sql
    ├── ubicacion_actual.sql
    ├── reserva_temporal.sql
    ├── historial_disponibilidad.sql
    └── direccion_simulada.sql
```

## Cómo agregar una prueba

Cada archivo de `restricciones/` empieza con `begin;` y termina con `rollback;`: los datos que carga no quedan para el archivo siguiente. Hay dos funciones:

```sql
-- Tiene que ejecutarse sin error.
select pg_temp.espera_ok('descripción de la prueba',
  $q$insert into m4.conductor (id) values ('1001')$q$);

-- Tiene que fallar por esa restricción (el nombre exacto, el que figura en la migración).
select pg_temp.espera_error('descripción de la prueba',
  $q$insert into m4.conductor (id, estado) values ('1002', 'OTRO')$q$,
  'conductor_estado_ck');
```

Si se agrega una tabla, se crea `restricciones/<tabla>.sql`; el script lo toma solo.
