-- Restricciones de m4.ubicacion_actual.
begin;

insert into m4.conductor (id, tipo_vehiculo, estado_habilitacion, estado)
values ('1001', 'AUTO', 'APROBADO', 'DISPONIBLE'), ('1002', 'MOTO', 'APROBADO', 'DISPONIBLE');

select pg_temp.espera_ok('acepta una ubicación válida',
  $q$insert into m4.ubicacion_actual (conductor_id, latitud, longitud, precision_km, registrada_en)
     values ('1001', -27.4512, -58.9867, 0.008, now())$q$);

select pg_temp.espera_ok('acepta una ubicación sin precisión',
  $q$insert into m4.ubicacion_actual (conductor_id, latitud, longitud, registrada_en)
     values ('1002', -27.46, -58.98, now())$q$);

select pg_temp.espera_error('rechaza una segunda fila para el mismo conductor',
  $q$insert into m4.ubicacion_actual (conductor_id, latitud, longitud, registrada_en)
     values ('1001', 0, 0, now())$q$,
  'ubicacion_actual_pkey');

select pg_temp.espera_error('rechaza una latitud fuera de rango',
  $q$update m4.ubicacion_actual set latitud = 91 where conductor_id = '1001'$q$,
  'ubicacion_actual_latitud_ck');

select pg_temp.espera_error('rechaza una longitud fuera de rango',
  $q$update m4.ubicacion_actual set longitud = -181 where conductor_id = '1001'$q$,
  'ubicacion_actual_longitud_ck');

select pg_temp.espera_error('rechaza una precisión negativa',
  $q$update m4.ubicacion_actual set precision_km = -1 where conductor_id = '1001'$q$,
  'ubicacion_actual_precision_ck');

select pg_temp.espera_error('rechaza la ubicación de un conductor que M3 no informó',
  $q$insert into m4.ubicacion_actual (conductor_id, latitud, longitud, registrada_en)
     values ('no-existe', 0, 0, now())$q$,
  'ubicacion_actual_conductor_fk');

select pg_temp.espera_ok('al borrar el conductor se borra su ubicación',
  $q$delete from m4.conductor where id = '1002';
     do $d$ begin
       if exists (select 1 from m4.ubicacion_actual where conductor_id = '1002') then
         raise exception 'la ubicación quedó huérfana';
       end if;
     end $d$$q$);

rollback;
