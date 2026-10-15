-- Última posición conocida de cada conductor (RF-4.1). Relación 1 a 1 con conductor.
-- No se guarda historial de posiciones (RF-4.7): cada envío pisa al anterior.
create table m4.ubicacion_actual (
  conductor_id  text             primary key,
  latitud       double precision not null,
  longitud      double precision not null,
  precision_km  real             null,
  registrada_en timestamptz      not null,
  recibida_en   timestamptz      not null default now(),

  constraint ubicacion_actual_conductor_fk
    foreign key (conductor_id) references m4.conductor (id) on delete cascade,
  constraint ubicacion_actual_latitud_ck
    check (latitud between -90 and 90),
  constraint ubicacion_actual_longitud_ck
    check (longitud between -180 and 180),
  constraint ubicacion_actual_precision_ck
    check (precision_km >= 0)
);

-- Sin índice geográfico en TP1: la búsqueda parte de conductor_disponibles_idx y filtra por
-- caja lat/lon + haversine. En TP2 la búsqueda pasa a Redis GEO (RNF-11).

comment on table m4.ubicacion_actual is
  'Última posición de cada conductor. Vence por TTL sobre recibida_en (RF-4.3).';
comment on column m4.ubicacion_actual.precision_km is 'Margen de error del GPS en km. Opcional.';
comment on column m4.ubicacion_actual.registrada_en is
  'Cuándo tomó la posición el celular (timestamp_ubicacion). Solo se reemplaza por una más nueva.';
comment on column m4.ubicacion_actual.recibida_en is 'Cuándo llegó al servidor. Se usa para el TTL.';
