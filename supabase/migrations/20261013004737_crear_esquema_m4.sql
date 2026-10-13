-- Esquema propio del módulo 4 (Ubicación y Disponibilidad).
-- Las tablas van acá y no en "public" para que no queden expuestas por la
-- Data API de Supabase (RF-4.7, privacidad de ubicación).
create schema if not exists m4;

comment on schema m4 is 'M4 Ubicación y Disponibilidad — Grupo 14';
