-- Restricciones de m4.conductor.
begin;

select pg_temp.espera_ok('acepta un id numérico',
  $q$insert into m4.conductor (id, tipo_vehiculo, estado_habilitacion, estado)
     values ('1001', 'AUTO', 'APROBADO', 'DISPONIBLE')$q$);

select pg_temp.espera_ok('acepta un id UUID',
  $q$insert into m4.conductor (id, tipo_vehiculo, estado_habilitacion, estado)
     values ('3f2b8c1e-9a4d-4e57-b0c2-1d7e6a5f4b3c', 'MOTO', 'APROBADO', 'DISPONIBLE')$q$);

select pg_temp.espera_ok('acepta un conductor sin datos de M3 y usa los valores por defecto',
  $q$insert into m4.conductor (id) values ('1002');
     do $d$ begin
       if (select estado from m4.conductor where id = '1002') <> 'DESCONECTADO' then
         raise exception 'el estado por defecto no es DESCONECTADO';
       end if;
     end $d$$q$);

select pg_temp.espera_error('rechaza un tipo de vehículo fuera de la lista',
  $q$insert into m4.conductor (id, tipo_vehiculo) values ('x1', 'CAMION')$q$,
  'conductor_tipo_vehiculo_ck');

select pg_temp.espera_error('rechaza una habilitación fuera de la lista (distingue mayúsculas)',
  $q$insert into m4.conductor (id, estado_habilitacion) values ('x2', 'Aprobado')$q$,
  'conductor_estado_habilitacion_ck');

select pg_temp.espera_error('rechaza un estado fuera de la lista',
  $q$insert into m4.conductor (id, estado) values ('x3', 'AVAILABLE')$q$,
  'conductor_estado_ck');

select pg_temp.espera_error('rechaza un id vacío',
  $q$insert into m4.conductor (id) values ('')$q$,
  'conductor_id_ck');

select pg_temp.espera_error('rechaza un id de más de 64 caracteres',
  $q$insert into m4.conductor (id) values (repeat('9', 65))$q$,
  'conductor_id_ck');

select pg_temp.espera_error('rechaza un id repetido',
  $q$insert into m4.conductor (id) values ('1001')$q$,
  'conductor_pkey');

-- La búsqueda de cercanos tiene que poder usar el índice parcial de disponibles.
set local enable_seqscan = off;
select pg_temp.espera_ok('la búsqueda de disponibles usa conductor_disponibles_idx',
  $q$do $d$ declare plan text; begin
       execute 'explain select id from m4.conductor
                where estado = ''DISPONIBLE'' and estado_habilitacion = ''APROBADO'' and tipo_vehiculo = ''AUTO'''
         into plan;
       if plan not like '%conductor_disponibles_idx%' then
         raise exception 'no usa el índice: %', plan;
       end if;
     end $d$$q$);

rollback;
