# Base de datos (Supabase)

En esta carpeta está la base de datos de M4 (Ubicación y Disponibilidad) versionada como código.
Los cambios se hacen con la **CLI de Supabase**: no se ejecuta SQL a mano desde el panel web.

| Dato | Valor |
|---|---|
| Proyecto | `TPI2026-G14-M4` |
| Project ref | `pufwbtpqecgswdxjgzhc` |
| Esquema de M4 | `m4` (no usamos `public`) |
| Data API | Desactivada: el backend se conecta directo a Postgres |

```
supabase/
├── config.toml      # configuración de la CLI
├── migrations/      # un archivo .sql por cambio, en orden de timestamp
└── .temp/           # vínculo local con el proyecto (no se sube al repo)
```

---

## Configuración inicial (una vez por integrante)

Requisitos: Node 18 o superior. No hace falta Docker ni instalar la CLI: se usa con `npx`.

1. Iniciar sesión (abre el navegador):
   ```bash
   npx supabase login
   ```
2. Vincular el repo con el proyecto (pide la contraseña de la base, que se pasa por privado, nunca por el repo):
   ```bash
   npx supabase link --project-ref pufwbtpqecgswdxjgzhc
   ```
3. Verificar que las migraciones locales y remotas coinciden:
   ```bash
   npx supabase migration list
   ```
4. Pedir el `.env` al grupo (se comparte por privado) y guardarlo en la raíz del repo (ver [Variables de entorno](#variables-de-entorno)).

---

## Cómo crear una migración

1. Desde la raíz del repo, en tu rama:
   ```bash
   npx supabase migration new nombre_del_cambio
   ```
   Se crea `supabase/migrations/<timestamp>_nombre_del_cambio.sql` vacío.
2. Escribí el SQL adentro. Siempre con el esquema explícito:
   ```sql
   create table m4.conductor (...);
   ```
3. Revisá qué se va a aplicar sin tocar la base:
   ```bash
   npx supabase db push --dry-run
   ```
4. Abrí el PR con la migración y esperá la revisión.
5. Una vez mergeado a `main`, se aplica en Supabase:
   ```bash
   npx supabase db push
   ```
6. Confirmá que quedó aplicada (columnas `local` y `remote` iguales):
   ```bash
   npx supabase migration list
   ```

### Al bajar cambios de `main`

Todos compartimos **una sola base** en Supabase, así que no hace falta que cada uno haga `db push`.
Después de un `git pull`, corré `npx supabase migration list`: si alguna migración aparece solo en `local`, avisá en el grupo antes de aplicarla, porque probablemente quien la escribió todavía no la subió.

---

## Reglas

1. **Nunca edites ni borres una migración que ya se aplicó.** Si hay que corregir algo, se crea una migración nueva (`alter table ...`).
2. **Solo se aplican migraciones que están en `main`.** Si se sube una desde una rama sin mergear, la base queda distinta al código del repo.
3. **No cambies la estructura desde el panel web** (Table Editor o SQL Editor). Lo que no está en una migración se pierde y desincroniza a todo el grupo. El panel se usa solo para mirar.
4. **Un cambio lógico por migración**, con un nombre que diga qué hace: `crear_tabla_hold`, `agregar_indice_hold_activo`.
5. **SQL portable:** nada de `auth.*` ni funciones propias de Supabase. Las mismas migraciones tienen que correr en el Postgres del `docker-compose` (RNF-04, RNF-18).
6. **Sin datos reales ni secretos** en las migraciones (RNF-06, RF-4.7).

---

## Convenciones de nombres

- Tablas y columnas en español y en `snake_case`. Tablas en singular: `conductor`, `reserva_temporal`. En el código y en la API se usa `camelCase` (`tipoVehiculo`); la traducción la hace la capa de persistencia.
- Siempre con el esquema explícito: `m4.conductor`.
- Ids: `uuid`. El de `conductor` es el mismo que usa M3. Los historiales usan `bigint generated always as identity`.
- Fechas: `timestamptz` en UTC, con sufijo `_en` (`creada_en`, `vence_en`).
- Unidades en el nombre cuando no es obvia: `precision_m` (metros). Distancias en metros y tiempos en segundos.
- Enums: `text` con un `check` que limita los valores, en español y en mayúsculas (`check (estado in ('ACTIVA', 'CONFIRMADA', ...))`). Se guarda el mismo texto que usa la API, sin tablas de traducción.
- Coordenadas: `latitud` y `longitud` como `double precision`, en ese orden, con `check` de rango (−90 a 90 y −180 a 180).

---

## Variables de entorno

El backend lee la conexión del `.env`, que está en el `.gitignore` y **nunca se sube al repo**. Se comparte por privado dentro del grupo; `.env.example` muestra qué variables lleva, sin valores reales.

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Cadena del **Session pooler** de Supabase (Dashboard → Connect). No usar la "Direct connection": es solo IPv6 y falla en muchas redes. |
| `DB_SCHEMA` | Esquema de M4: `m4`. |
| `DB_SSL` | `true` para Supabase; `false` para el Postgres local del `docker-compose`. |

Si la contraseña tiene caracteres especiales (`@`, `#`, `/`, `:`…), hay que escribirlos codificados en la URL (por ejemplo `@` → `%40`).

---

## Comandos útiles

| Comando | Para qué |
|---|---|
| `npx supabase migration new <nombre>` | Crear una migración vacía |
| `npx supabase migration list` | Comparar migraciones locales y remotas |
| `npx supabase db push --dry-run` | Ver qué se aplicaría, sin aplicarlo |
| `npx supabase db push` | Aplicar las migraciones pendientes |

### Problemas frecuentes

- **`Cannot find project ref. Have you run supabase link?`**: falta el paso 2 de la configuración inicial.
- **`Remote migration versions not found in local migrations directory`**: alguien aplicó una migración que vos no tenés. Hacé `git pull` de `main`.
- **`Found local migration files to be inserted before the last migration on remote database`**: tu migración tiene un timestamp más viejo que una ya aplicada (pasa si la creaste hace días en otra rama). Renombrá el archivo con un timestamp nuevo (`npx supabase migration new` y copiá el SQL) antes de aplicarla.
