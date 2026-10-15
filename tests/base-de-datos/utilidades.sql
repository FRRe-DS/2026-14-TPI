-- Funciones de apoyo para las pruebas de la base. Se cargan antes de cada archivo de prueba.
-- Son temporales (pg_temp): desaparecen al cerrar la sesión y no quedan en la base.
--
-- Cada prueba informa su resultado con un mensaje que lee correr-pruebas.mjs:
--   NOTICE  "OK    <prueba>"
--   WARNING "FALLA <prueba> -> <motivo>"

-- La sentencia tiene que ejecutarse sin error.
create function pg_temp.espera_ok(prueba text, sql text) returns void as $$
begin
  execute sql;
  raise notice 'OK    %', prueba;
exception when others then
  raise warning 'FALLA % -> %', prueba, sqlerrm;
end $$ language plpgsql;

-- La sentencia tiene que fallar por la restricción indicada (null si el error no tiene una,
-- por ejemplo al escribir una columna generated always).
create function pg_temp.espera_error(prueba text, sql text, restriccion text) returns void as $$
declare
  obtenida text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics obtenida = constraint_name;
    if coalesce(obtenida, '') = coalesce(restriccion, '') then
      raise notice 'OK    %', prueba;
    else
      raise warning 'FALLA % -> falló por "%" (%), se esperaba "%"', prueba, obtenida, sqlerrm, restriccion;
    end if;
    return;
  end;
  raise warning 'FALLA % -> se aceptó y tenía que rechazarse por "%"', prueba, restriccion;
end $$ language plpgsql;
