-- Catálogo de direcciones del proveedor de mapas simulado (RF-4.5, ida y vuelta).
-- Tabla de referencia sin relaciones. Los datos de demo se cargan como seed, no en una migración.
create table m4.direccion_simulada (
  id                    bigint           generated always as identity primary key,
  direccion             text             not null,
  direccion_normalizada text             not null,
  latitud               double precision not null,
  longitud              double precision not null,
  ciudad                text             not null,

  constraint direccion_simulada_normalizada_uk
    unique (direccion_normalizada),
  constraint direccion_simulada_latitud_ck
    check (latitud between -90 and 90),
  constraint direccion_simulada_longitud_ck
    check (longitud between -180 and 180)
);

comment on table m4.direccion_simulada is 'Direcciones con coordenadas fijas para el proveedor de mapas simulado.';
comment on column m4.direccion_simulada.direccion is 'Texto de la dirección tal como se muestra.';
comment on column m4.direccion_simulada.direccion_normalizada is
  'Minúsculas, sin tildes ni abreviaturas. La normaliza el backend; se usa para buscar.';
comment on column m4.direccion_simulada.ciudad is 'Ciudad o zona de la demo.';
