-- Reserva temporal (hold) de un conductor mientras M5 le ofrece un viaje (RF-4.4, RNF-08).
create table m4.reserva_temporal (
  id            bigint      generated always as identity primary key,
  conductor_id  text        not null,
  solicitud_id  text        not null,
  estado        text        not null default 'ACTIVA',
  creada_en     timestamptz not null default now(),
  vence_en      timestamptz not null,
  cerrada_en    timestamptz null,
  motivo_cierre text        null,

  constraint reserva_temporal_conductor_fk
    foreign key (conductor_id) references m4.conductor (id) on delete restrict,
  -- El formato lo define M5 (UUID o número); acá solo se evita un id vacío o absurdo.
  constraint reserva_temporal_solicitud_ck
    check (char_length(solicitud_id) between 1 and 64),
  constraint reserva_temporal_estado_ck
    check (estado in ('ACTIVA', 'CONFIRMADA', 'LIBERADA', 'VENCIDA')),
  constraint reserva_temporal_vence_ck
    check (vence_en > creada_en),
  -- Solo la reserva activa está abierta; cualquier otro estado tiene fecha de cierre.
  constraint reserva_temporal_cierre_ck
    check ((estado = 'ACTIVA') = (cerrada_en is null)),
  constraint reserva_temporal_cerrada_ck
    check (cerrada_en >= creada_en),
  constraint reserva_temporal_motivo_ck
    check (char_length(motivo_cierre) <= 200),

  -- UK1, idempotencia: la misma solicitud no reserva dos veces al mismo conductor.
  -- Repetir con la reserva activa devuelve la misma; si ya está cerrada, 409.
  constraint reserva_temporal_solicitud_conductor_uk
    unique (solicitud_id, conductor_id)
);

-- UK2: como máximo una reserva activa por conductor. La segunda solicitud recibe 409.
-- Antes de insertar, el backend vence en la misma transacción las activas con vence_en <= now().
create unique index reserva_temporal_conductor_activa_uk
  on m4.reserva_temporal (conductor_id)
  where estado = 'ACTIVA';

-- Job de vencimiento: reservas activas cuyo vence_en ya pasó.
create index reserva_temporal_vencimiento_idx
  on m4.reserva_temporal (vence_en)
  where estado = 'ACTIVA';

comment on table m4.reserva_temporal is
  'Holds de conductores pedidos por M5. Una solicitud puede reservar varios conductores en paralelo.';
comment on column m4.reserva_temporal.solicitud_id is 'Id de la solicitud de M5, guardado tal cual.';
comment on column m4.reserva_temporal.vence_en is 'Si no se confirma ni libera antes, pasa a VENCIDA.';
comment on column m4.reserva_temporal.cerrada_en is 'Cuándo se confirmó, liberó o venció. Null mientras está ACTIVA.';
