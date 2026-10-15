-- Conductor: réplica mínima de lo que informa M3 más su estado de disponibilidad en M4.
-- Privacidad (RF-4.7): solo se guarda el id; nombre, documento, patente, etc. quedan en M3.
create table m4.conductor (
  id                  text        primary key,
  tipo_vehiculo       text        null,
  estado_habilitacion text        null,
  estado              text        not null default 'DESCONECTADO',
  sincronizado_en     timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  -- El formato lo define M3 (UUID o número); acá solo se evita un id vacío o absurdo.
  constraint conductor_id_ck
    check (char_length(id) between 1 and 64),
  constraint conductor_tipo_vehiculo_ck
    check (tipo_vehiculo in ('AUTO', 'MOTO')),
  constraint conductor_estado_habilitacion_ck
    check (estado_habilitacion in ('APROBADO', 'SUSPENDIDO')),
  constraint conductor_estado_ck
    check (estado in ('DESCONECTADO', 'NO_DISPONIBLE', 'DISPONIBLE', 'RESERVADO', 'EN_VIAJE'))
);

-- Búsqueda de cercanos (RF-4.2): solo disponibles y aprobados, filtrando por tipo de vehículo.
create index conductor_disponibles_idx
  on m4.conductor (tipo_vehiculo)
  where estado = 'DISPONIBLE' and estado_habilitacion = 'APROBADO';

comment on table m4.conductor is
  'Conductores informados por M3 y su estado de disponibilidad. Solo el id, sin datos personales.';
comment on column m4.conductor.id is
  'Mismo id que usa M3 (conductor_id del contrato), guardado tal cual. Texto para aceptar UUID o número.';
comment on column m4.conductor.tipo_vehiculo is 'Tipo del vehículo activo. Null hasta que M3 lo informe.';
comment on column m4.conductor.estado_habilitacion is
  'Habilitación informada por M3. Null hasta que la informe. Solo los APROBADO aparecen en búsquedas.';
comment on column m4.conductor.estado is 'Estado operativo; cada cambio se registra en historial_disponibilidad.';
comment on column m4.conductor.sincronizado_en is 'Última vez que se recibieron datos de M3.';
comment on column m4.conductor.actualizado_en is 'Último cambio de estado. Lo actualiza el backend.';
