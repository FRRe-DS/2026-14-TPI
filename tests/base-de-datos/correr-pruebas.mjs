// Prueba la base de M4 en un Postgres descartable dentro de Docker:
//   1. aplica supabase/migrations en orden, como lo hace `supabase db push`;
//   2. corre las pruebas de restricciones/*.sql;
//   3. prueba dos reservas simultáneas sobre el mismo conductor (RNF-08).
// El contenedor se borra al terminar. No toca Supabase.
//
// Uso, desde la raíz del repo y con Docker abierto:
//   node tests/base-de-datos/correr-pruebas.mjs

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const dirMigraciones = join(aqui, '..', '..', 'supabase', 'migrations');
const dirRestricciones = join(aqui, 'restricciones');
const utilidades = readFileSync(join(aqui, 'utilidades.sql'), 'utf8');

// Misma versión mayor que el proyecto de Supabase (supabase/config.toml, major_version).
const imagen = process.env.PRUEBAS_DB_IMAGEN ?? 'postgres:17-alpine';
const contenedor = `m4-pruebas-db-${process.pid}`;
const argsPsql = ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1'];

let correctas = 0;
let fallidas = 0;

function informar(ok, texto) {
  if (ok) correctas++;
  else fallidas++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${texto}`);
}

function docker(args, entrada) {
  return spawnSync('docker', args, { input: entrada, encoding: 'utf8' });
}

function psql(sql, extra = []) {
  const r = docker([...argsPsql, ...extra], sql);
  return { ok: r.status === 0, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function psqlEnParalelo(sql) {
  return new Promise((resolver) => {
    const proceso = spawn('docker', argsPsql);
    let salida = '';
    proceso.stdout.on('data', (d) => (salida += d));
    proceso.stderr.on('data', (d) => (salida += d));
    proceso.on('close', (codigo) => resolver({ ok: codigo === 0, salida }));
    proceso.stdin.end(sql);
  });
}

function primerError(salida) {
  return salida.split('\n').find((l) => l.includes('ERROR'))?.trim() ?? salida.trim();
}

function borrarContenedor() {
  docker(['rm', '-f', contenedor]);
}

async function levantarPostgres() {
  console.log(`Levantando ${imagen}...`);
  const r = docker(['run', '-d', '--name', contenedor, '-e', 'POSTGRES_PASSWORD=postgres', imagen]);
  if (r.status !== 0) {
    console.error(r.stderr.trim());
    console.error('\nNo se pudo crear el contenedor. ¿Está abierto Docker Desktop?');
    process.exit(1);
  }
  // Por TCP: durante la inicialización la imagen levanta un servidor temporal solo por socket.
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', contenedor, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) return;
    await esperar(1000);
  }
  throw new Error('Postgres no respondió en 60 segundos');
}

function aplicarMigraciones() {
  console.log('\nMigraciones');
  for (const archivo of readdirSync(dirMigraciones).filter((a) => a.endsWith('.sql')).sort()) {
    // -1: cada migración en una sola transacción, igual que la CLI de Supabase.
    const r = psql(readFileSync(join(dirMigraciones, archivo), 'utf8'), ['-1']);
    informar(r.ok, r.ok ? archivo : `${archivo} -> ${primerError(r.salida)}`);
    if (!r.ok) return false;
  }
  return true;
}

function probarRestricciones() {
  for (const archivo of readdirSync(dirRestricciones).filter((a) => a.endsWith('.sql')).sort()) {
    console.log(`\nRestricciones: ${archivo.replace('.sql', '')}`);
    const r = psql(utilidades + readFileSync(join(dirRestricciones, archivo), 'utf8'));
    for (const linea of r.salida.split('\n')) {
      const ok = linea.match(/NOTICE:\s+OK\s+(.+)/);
      const falla = linea.match(/WARNING:\s+FALLA\s+(.+)/);
      if (ok) informar(true, ok[1].trim());
      if (falla) informar(false, falla[1].trim());
    }
    if (!r.ok) informar(false, `el archivo se cortó: ${primerError(r.salida)}`);
  }
}

async function probarConcurrencia() {
  console.log('\nConcurrencia');
  psql(`insert into m4.conductor (id, tipo_vehiculo, estado_habilitacion, estado)
        values ('conc-1', 'AUTO', 'APROBADO', 'DISPONIBLE')`);

  const reservar = (solicitud, pausa) => `
    begin;
    insert into m4.reserva_temporal (conductor_id, solicitud_id, vence_en)
    values ('conc-1', '${solicitud}', now() + interval '30 seconds');
    select pg_sleep(${pausa});
    commit;`;

  // La primera sesión inserta y tarda en confirmar; la segunda llega mientras tanto.
  const primera = psqlEnParalelo(reservar('sol-A', 1.5));
  await esperar(300);
  const segunda = psqlEnParalelo(reservar('sol-B', 0));
  const resultados = await Promise.all([primera, segunda]);

  const entraron = resultados.filter((r) => r.ok).length;
  const rechazadaPorUk2 = resultados.some((r) => !r.ok && r.salida.includes('reserva_temporal_conductor_activa_uk'));
  const activas = psql(`select count(*) from m4.reserva_temporal where conductor_id = 'conc-1' and estado = 'ACTIVA'`);

  informar(
    entraron === 1 && rechazadaPorUk2 && activas.salida.trim() === '1',
    'dos reservas simultáneas del mismo conductor: entra una y la otra se rechaza por reserva_temporal_conductor_activa_uk',
  );
}

process.on('SIGINT', () => {
  borrarContenedor();
  process.exit(130);
});

try {
  await levantarPostgres();
  if (aplicarMigraciones()) {
    probarRestricciones();
    await probarConcurrencia();
  }
} catch (error) {
  informar(false, error.message);
} finally {
  borrarContenedor();
}

console.log(`\nResultado: ${correctas} correctas, ${fallidas} fallidas`);
process.exit(fallidas === 0 ? 0 : 1);
