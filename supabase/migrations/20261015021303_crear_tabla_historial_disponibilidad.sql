-- Registro de cada cambio de estado de un conductor (trazabilidad, RNF-19).
create table m4.historial_disponibilidad (
  id              bigint      generated always as identity primary key,
  conductor_id    text        not null,
  estado_anterior text        null,
  estado_nuevo    text        not null,
  origen          text        not null,
  referencia_id   text        null,
  correlacion_id  text        null,
  creada_en       timestamptz not null default now(),

  constraint historial_disponibilidad_conductor_fk
    foreign key (conductor_id) references m4.conductor (id) on delete restrict,
  constraint historial_disponibilidad_estado_anterior_ck
    check (estado_anterior in ('DESCONECTADO', 'NO_DISPONIBLE', 'DISPONIBLE', 'RESERVADO', 'EN_VIAJE')),
  constraint historial_disponibilidad_estado_nuevo_ck
    check (estado_nuevo in ('DESCONECTADO', 'NO_DISPONIBLE', 'DISPONIBLE', 'RESERVADO', 'EN_VIAJE')),
  constraint historial_disponibilidad_cambio_ck
    check (estado_anterior is distinct from estado_nuevo),
  constraint historial_disponibilidad_origen_ck
    check (origen in ('M3', 'M5', 'M6', 'CONDUCTOR', 'SISTEMA'))
);

-- Consulta de los cambios de un conductor en orden.
create index historial_disponibilidad_conductor_idx
  on m4.historial_disponibilidad (conductor_id, creada_en);

comment on table m4.historial_disponibilidad is 'Un registro por cada cambio de estado de un conductor.';
comment on column m4.historial_disponibilidad.estado_anterior is 'Null en el primer registro del conductor.';
comment on column m4.historial_disponibilidad.origen is 'Quién provocó el cambio.';
comment on column m4.historial_disponibilidad.referencia_id is
  'Id de la solicitud (M5) o de la reserva (M4) que causó el cambio. Null si no vino de una (por ejemplo, el conductor se conecta).';
comment on column m4.historial_disponibilidad.correlacion_id is 'Id de la petición, para cruzarlo con los logs (RNF-14).';
