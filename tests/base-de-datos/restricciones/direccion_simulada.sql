-- Restricciones de m4.direccion_simulada.
begin;

select pg_temp.espera_ok('acepta una dirección válida',
  $q$insert into m4.direccion_simulada (direccion, direccion_normalizada, latitud, longitud, ciudad)
     values ('Av. 9 de Julio 1000', 'avenida 9 de julio 1000', -27.46, -58.98, 'Resistencia')$q$);

select pg_temp.espera_error('rechaza una dirección normalizada repetida',
  $q$insert into m4.direccion_simulada (direccion, direccion_normalizada, latitud, longitud, ciudad)
     values ('Avenida 9 de Julio 1000', 'avenida 9 de julio 1000', -27.46, -58.98, 'Resistencia')$q$,
  'direccion_simulada_normalizada_uk');

select pg_temp.espera_error('rechaza una latitud fuera de rango',
  $q$insert into m4.direccion_simulada (direccion, direccion_normalizada, latitud, longitud, ciudad)
     values ('Calle Falsa 123', 'calle falsa 123', -91, 0, 'Resistencia')$q$,
  'direccion_simulada_latitud_ck');

select pg_temp.espera_error('rechaza una longitud fuera de rango',
  $q$insert into m4.direccion_simulada (direccion, direccion_normalizada, latitud, longitud, ciudad)
     values ('Calle Falsa 123', 'calle falsa 123', 0, 181, 'Resistencia')$q$,
  'direccion_simulada_longitud_ck');

rollback;
