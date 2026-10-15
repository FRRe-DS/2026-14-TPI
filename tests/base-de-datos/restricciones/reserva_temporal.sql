-- Restricciones de m4.reserva_temporal (hold, RF-4.4 y RNF-08).
begin;

insert into m4.conductor (id, tipo_vehiculo, estado_habilitacion, estado)
values ('1001', 'AUTO', 'APROBADO', 'DISPONIBLE'),
       ('1002', 'AUTO', 'APROBADO', 'DISPONIBLE'),
       ('1003', 'AUTO', 'APROBADO', 'DISPONIBLE');

select pg_temp.espera_ok('acepta una reserva activa válida',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
     values ('1001', 'sol-1', now() + interval '30 seconds')$q$);

select pg_temp.espera_ok('una misma solicitud puede reservar otro conductor en paralelo',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
     values ('1002', 'sol-1', now() + interval '30 seconds')$q$);

select pg_temp.espera_error('UK2: rechaza otra solicitud sobre un conductor ya reservado (409)',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
     values ('1001', 'sol-2', now() + interval '30 seconds')$q$,
  'reserva_temporal_conductor_activa_uk');

select pg_temp.espera_error('UK1: rechaza repetir la misma solicitud sobre el mismo conductor',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, estado, vence_en, cerrada_en)
     values ('1001', 'sol-1', 'LIBERADA', now() + interval '30 seconds', now())$q$,
  'reserva_temporal_solicitud_conductor_uk');

select pg_temp.espera_error('rechaza un vencimiento anterior a la creación',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
     values ('1003', 'sol-3', now() - interval '1 second')$q$,
  'reserva_temporal_vence_ck');

select pg_temp.espera_error('rechaza una reserva cerrada sin fecha de cierre',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, estado, vence_en)
     values ('1003', 'sol-4', 'VENCIDA', now() + interval '30 seconds')$q$,
  'reserva_temporal_cierre_ck');

select pg_temp.espera_error('rechaza una reserva activa con fecha de cierre',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en, cerrada_en)
     values ('1003', 'sol-5', now() + interval '30 seconds', now())$q$,
  'reserva_temporal_cierre_ck');

select pg_temp.espera_error('rechaza un cierre anterior a la creación',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, estado, vence_en, cerrada_en)
     values ('1003', 'sol-6', 'LIBERADA', now() + interval '30 seconds', now() - interval '1 minute')$q$,
  'reserva_temporal_cerrada_ck');

select pg_temp.espera_error('rechaza un estado fuera de la lista',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, estado, vence_en, cerrada_en)
     values ('1003', 'sol-7', 'ACTIVE', now() + interval '30 seconds', now())$q$,
  'reserva_temporal_estado_ck');

select pg_temp.espera_error('rechaza un motivo de cierre de más de 200 caracteres',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, estado, vence_en, cerrada_en, motivo_cierre)
     values ('1003', 'sol-8', 'LIBERADA', now() + interval '30 seconds', now(), repeat('x', 201))$q$,
  'reserva_temporal_motivo_ck');

select pg_temp.espera_error('rechaza un id de solicitud vacío',
  $q$insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
     values ('1003', '', now() + interval '30 seconds')$q$,
  'reserva_temporal_solicitud_ck');

select pg_temp.espera_ok('al cerrar la reserva activa el conductor queda libre para otra solicitud',
  $q$update m4.reserva_temporal set estado = 'VENCIDA', cerrada_en = now(), motivo_cierre = 'venció'
     where conductor_id = '1001' and estado = 'ACTIVA';
     insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
     values ('1001', 'sol-2', now() + interval '30 seconds')$q$);

select pg_temp.espera_error('no se puede borrar un conductor que tiene reservas',
  $q$delete from m4.conductor where id = '1001'$q$,
  'reserva_temporal_conductor_fk');

rollback;
