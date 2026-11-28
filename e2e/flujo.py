"""Prueba de punta a punta de M4 (G14) contra el ambiente recien levantado (API, base, Redis y datos de prueba).

Uso: python e2e/flujo.py
Recorre lo que hoy funciona. Usa los datos de prueba: antes de repetirla hay que recargarlos con
  docker compose -f deploy/compose.ambiente.yml run --rm seed
Solo usa la biblioteca estandar de Python. Termina con codigo 1 si algo falla.
"""
import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from urllib import error, request

fallas = []


def llamar(metodo, url, cuerpo=None):
    datos = None
    cabeceras = {}
    if cuerpo is not None:
        datos = json.dumps(cuerpo).encode()
        cabeceras["Content-Type"] = "application/json"
    pedido = request.Request(url, data=datos, headers=cabeceras, method=metodo)
    try:
        with request.urlopen(pedido, timeout=20) as respuesta:
            return respuesta.status, respuesta.read().decode()
    except error.HTTPError as exc:
        return exc.code, exc.read().decode()
    except OSError as exc:
        return 0, str(exc)


def comprobar(nombre, condicion, codigo, texto=""):
    print(f"[{'OK' if condicion else 'FALLA'}] {nombre} ({codigo})")
    if not condicion:
        fallas.append(nombre)
        print("        " + texto[:400])


def conductores(texto):
    try:
        return [c["conductor_id"] for c in json.loads(texto)["conductores"]]
    except (ValueError, KeyError, TypeError):
        return None


def main():
    argumentos = argparse.ArgumentParser()
    argumentos.add_argument("--api", default="http://localhost:3000")
    a = argumentos.parse_args()

    codigo, texto = llamar("GET", f"{a.api}/health/live")
    comprobar("salud: viva", codigo == 200, codigo, texto)
    codigo, texto = llamar("GET", f"{a.api}/health/ready")
    comprobar("salud: lista", codigo == 200, codigo, texto)

    cercanos = f"{a.api}/api/v1/conductores/cercanos?origen_latitud=-27.451&origen_longitud=-58.986&tipo_vehiculo=AUTO&radio_km=5"
    codigo, texto = llamar("GET", cercanos)
    comprobar("el conductor de prueba aparece en cercanos", codigo == 200 and "1" in (conductores(texto) or []), codigo, texto)

    nuevo = str(uuid.uuid4())
    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    codigo, texto = llamar("PUT", f"{a.api}/api/v1/conductores/{nuevo}/ubicacion",
                           {"latitud": -27.451, "longitud": -58.986, "timestamp_ubicacion": ahora})
    comprobar("guardar ubicacion", codigo == 200 and nuevo in texto, codigo, texto)

    def cambiar_disponibilidad(disponible):
        return llamar("PUT", f"{a.api}/api/v1/conductores/{nuevo}/estado-operativo",
                      {"event_id": str(uuid.uuid4()), "connected": True, "available": disponible})

    codigo, texto = cambiar_disponibilidad(True)
    comprobar("ponerse disponible", codigo == 200, codigo, texto)
    codigo, texto = llamar("GET", cercanos)
    comprobar("el conductor nuevo aparece en cercanos", codigo == 200 and nuevo in (conductores(texto) or []), codigo, texto)
    codigo, texto = cambiar_disponibilidad(False)
    comprobar("dejar de estar disponible", codigo == 200, codigo, texto)
    codigo, texto = llamar("GET", cercanos)
    lista = conductores(texto)
    comprobar("el no disponible no aparece", codigo == 200 and lista is not None and nuevo not in lista, codigo, texto)

    solicitud = str(uuid.uuid4())

    def reservar(id_solicitud, estado):
        return llamar("POST", f"{a.api}/api/v1/conductores/1/reserva",
                      {"solicitud_id": id_solicitud, "estado_temporal": estado})

    codigo, texto = reservar(solicitud, "RESERVADO")
    comprobar("reservar", codigo == 200, codigo, texto)
    codigo, texto = llamar("GET", cercanos)
    lista = conductores(texto)
    comprobar("reservado no aparece", codigo == 200 and lista is not None and "1" not in lista, codigo, texto)
    codigo, texto = reservar(str(uuid.uuid4()), "RESERVADO")
    comprobar("otra solicitud recibe conflicto", codigo == 409, codigo, texto)
    codigo, texto = reservar(str(uuid.uuid4()), "LIBERADO")
    comprobar("otra solicitud no puede liberar", codigo == 409, codigo, texto)
    codigo, texto = reservar(solicitud, "LIBERADO")
    comprobar("liberar", codigo == 200, codigo, texto)

    codigo, texto = llamar("GET", f"{a.api}/api/v1/rutas/estimacion?origen_latitud=-27.451&origen_longitud=-58.986&destino_latitud=-27.46&destino_longitud=-58.99")
    comprobar("estimacion de ruta", codigo == 200 and "distancia_estimada_km" in texto, codigo, texto)
    codigo, texto = llamar("POST", f"{a.api}/api/v1/geocodificaciones",
                           {"direccion": "plaza 25 de mayo", "localidad": "Resistencia", "pais": "ar"})
    comprobar("geocodificacion", codigo == 200 and "coincidencias" in texto, codigo, texto)

    if fallas:
        sys.exit(f"Fallaron {len(fallas)} comprobaciones: {', '.join(fallas)}")
    print("La prueba de punta a punta paso completa.")


if __name__ == "__main__":
    main()
