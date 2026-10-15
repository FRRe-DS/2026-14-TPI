-- Restricciones de m4.historial_disponibilidad.
begin;

insert into m4.conductor (id, tipo_vehiculo, estado_habilitacion, estado)
values ('1001', 'AUTO', 'APROBADO', 'DISPONIBLE');

select pg_temp.espera_ok('acepta el primer registro sin estado anterior',
  $q$insert into m4.historial_disponibilidad (conductor_id, estado_nuevo, origen)
     values ('1001', 'DISPONIBLE', 'M3')$q$);

select pg_temp.espera_ok('acepta un cambio por reserva de M5 con referencia y correlación',
  $q$insert into m4.historial_disponibilidad
       (conductor_id, estado_anterior, estado_nuevo, origen, referencia_id, correlacion_id)
     values ('1001', 'DISPONIBLE', 'RESERVADO', 'M5', 'sol-1', 'req-abc')$q$);

select pg_temp.espera_error('rechaza un registro donde el estado no cambia',
  $q$insert into m4.historial_disponibilidad (conductor_id, estado_anterior, estado_nuevo, origen)
     values ('1001', 'RESERVADO', 'RESERVADO', 'M5')$q$,
  'historial_disponibilidad_cambio_ck');

select pg_temp.espera_error('rechaza un estado nuevo fuera de la lista',
  $q$insert into m4.historial_disponibilidad (conductor_id, estado_nuevo, origen)
     values ('1001', 'ON_TRIP', 'M6')$q$,
  'historial_disponibilidad_estado_nuevo_ck');

select pg_temp.espera_error('rechaza un origen fuera de la lista',
  $q$insert into m4.historial_disponibilidad (conductor_id, estado_nuevo, origen)
     values ('1001', 'DISPONIBLE', 'DRIVER')$q$,
  'historial_disponibilidad_origen_ck');

select pg_temp.espera_error('no deja elegir el id a mano',
  $q$insert into m4.historial_disponibilidad (id, conductor_id, estado_nuevo, origen)
     values (99, '1001', 'DISPONIBLE', 'M3')$q$,
  null);

select pg_temp.espera_error('no se puede borrar un conductor que tiene historial',
  $q$delete from m4.conductor where id = '1001'$q$,
  'historial_disponibilidad_conductor_fk');

rollback;
