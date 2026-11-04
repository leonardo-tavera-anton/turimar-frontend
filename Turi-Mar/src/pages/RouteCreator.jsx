import { useEffect, useRef, useState } from "react";
import RealMap from "../components/dashboard/RealMap";
import { supabase } from "../supabaseClient";
import { cacheUserRoute, crearRutaComunidad } from "../services/routeService";
import { identifyMapLocation } from "../services/placeLookup";
import { getDrivingRoute } from "../services/directionsService";

const categories = [
  ["cultural", "Cultura y miradores"],
  ["playa", "Playas y caletas"],
  ["marina", "Paseos en lancha"],
  ["gastronomia", "Gastronomía"],
  ["naturaleza", "Naturaleza y ecoturismo"],
  ["aventura", "Aventura y deportes"],
  ["historia", "Historia y arqueología"],
  ["familiar", "Planes familiares"],
  ["transporte", "Transporte y recorridos"],
  ["compras", "Mercados y compras"],
  ["eventos", "Eventos y festivales"],
  ["vida_nocturna", "Vida nocturna"],
];

export default function RouteCreator({ onBack, routeError }) {
  const [title, setTitle] = useState("");
  const [titleLocked, setTitleLocked] = useState(false);
  const [category, setCategory] = useState("cultural");
  const [showOwnerName, setShowOwnerName] = useState(true);
  const [stopName, setStopName] = useState("");
  const [stopNote, setStopNote] = useState("");
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [detectedPlace, setDetectedPlace] = useState(null);
  const [lookingUpPlace, setLookingUpPlace] = useState(false);
  const [points, setPoints] = useState([]);
  const [roadGeometry, setRoadGeometry] = useState([]);
  const [routeCalculating, setRouteCalculating] = useState(false);
  const [routeCalculationError, setRouteCalculationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const lookupController = useRef(null);
  const routeController = useRef(null);

  useEffect(() => {
    routeController.current?.abort();
    if (points.length < 2) {
      setRoadGeometry([]);
      setRouteCalculationError("");
      setRouteCalculating(false);
      return undefined;
    }

    const controller = new AbortController();
    routeController.current = controller;
    setRoadGeometry([]);
    setRouteCalculationError("");
    setRouteCalculating(true);

    Promise.all(points.slice(0, -1).map((point, index) => getDrivingRoute(
      point,
      points[index + 1],
      controller.signal,
    )))
      .then((segments) => {
        if (controller.signal.aborted) return;
        setRoadGeometry(segments.flatMap((segment, index) => (
          index === 0 ? segment.coordinates : segment.coordinates.slice(1)
        )));
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setRouteCalculationError(error instanceof Error ? error.message : "No se pudo calcular el camino por calles.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteCalculating(false);
      });

    return () => controller.abort();
  }, [points]);

  const mapLocations = [
    ...points.map((point, index) => ({
      name: point.name,
      address: point.comment || `Parada ${index + 1}`,
      latitude: point.latitude,
      longitude: point.longitude,
    })),
    ...(selectedPosition ? [{
      name: stopName.trim() || "Nueva parada",
      address: "Punto seleccionado",
      latitude: selectedPosition.latitude,
      longitude: selectedPosition.longitude,
    }] : []),
  ];
  const routeLine = roadGeometry;

  const selectPosition = async (latitude, longitude) => {
    lookupController.current?.abort();
    const controller = new AbortController();
    lookupController.current = controller;
    setSelectedPosition({ latitude, longitude });
    setStopName("");
    setStopNote("");
    setDetectedPlace(null);
    setNearbyPlaces([]);
    setLookingUpPlace(true);
    setFeedback("");

    try {
      const result = await identifyMapLocation(latitude, longitude, controller.signal);
      if (controller.signal.aborted) return;
      setDetectedPlace(result.place);
      setNearbyPlaces(result.nearby);
      if (result.place) {
        setStopName(result.place.name);
        setStopNote(result.place.address);
      }
      if (result.searchFailed) setFeedback("No se pudo buscar el lugar automáticamente. Puedes completar el nombre manualmente.");
    } finally {
      if (!controller.signal.aborted) setLookingUpPlace(false);
    }
  };

  const chooseNearbyPlace = (place) => {
    setSelectedPosition({ latitude: place.latitude, longitude: place.longitude });
    setStopName(place.name);
    setStopNote(place.address);
    setDetectedPlace(null);
    setFeedback("");
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setFeedback("Este navegador no permite obtener tu ubicación.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => selectPosition(coords.latitude, coords.longitude),
      () => setFeedback("No se pudo obtener tu ubicación. Revisa el permiso de GPS."),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const addPoint = () => {
    if (!selectedPosition) {
      setFeedback("Selecciona primero el punto en el mapa.");
      return;
    }
    if (!stopName.trim()) {
      setFeedback("Escribe el nombre de la parada.");
      return;
    }

    setPoints((current) => [...current, {
      name: stopName.trim(),
      comment: stopNote.trim(),
      ...selectedPosition,
    }]);
    setStopName("");
    setStopNote("");
    setSelectedPosition(null);
    setFeedback("");
  };

  const publishRoute = async () => {
    if (!title.trim() || !titleLocked) {
      setFeedback(title.trim() ? "Fija el nombre antes de publicar." : "Escribe el nombre de la ruta.");
      return;
    }
    if (points.length < 2) {
      setFeedback("Agrega al menos dos paradas para publicar.");
      return;
    }
    if (routeCalculating || routeCalculationError || roadGeometry.length < 2) {
      setFeedback(routeCalculationError || "Espera a que se calcule el recorrido por calles.");
      return;
    }

    setSaving(true);
    setFeedback("");
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error("Inicia sesión para publicar una ruta.");

      const routePayload = {
        usuario_id: user.id,
        titulo: title.trim(),
        descripcion: points.map((point) => point.comment).filter(Boolean).join(" "),
        categoria: category,
        es_publica: true,
        mostrar_propietario: showOwnerName,
        duracion_total_horas: Math.max(1, Number((points.length * 35 / 60).toFixed(2))),
        presupuesto_total_estimado: points.length * 12,
      };
      const savedRoute = await crearRutaComunidad(routePayload, points);
      cacheUserRoute(user.id, { ...routePayload, ...savedRoute, puntos: points });

      setTitle("");
      setTitleLocked(false);
      setCategory("cultural");
      setPoints([]);
      setFeedback("Ruta publicada correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo publicar la ruta.";
      setFeedback(message.includes("prepared statement")
        ? "La base de datos del servidor está fallando. El backend debe corregir la conexión antes de guardar rutas."
        : `No se pudo publicar la ruta: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="route-create-page">
      <header className="route-create-header">
        <button type="button" onClick={onBack}>← Volver</button>
        <span>TURI-MAR / RUTAS</span>
      </header>

      <div className="route-create-heading">
        <div>
          <p>PLANIFICA TU RECORRIDO</p>
          <h1>Crear ruta</h1>
          <span>Selecciona los lugares que quieres visitar y ordénalos en el mapa.</span>
        </div>
        <strong>{points.length} paradas</strong>
      </div>

      <div className="route-create-layout">
        <section className="route-create-map" aria-label="Mapa para seleccionar paradas">
          <div className="route-create-map-label">CHIMBOTE · SELECCIONA UNA UBICACIÓN</div>
          {points.length > 1 && (
            <div className={`route-create-map-status ${routeCalculationError ? "error" : ""}`} role="status">
              {routeCalculating ? "Trazando camino por calles…" : routeCalculationError || "Recorrido por calles listo"}
            </div>
          )}
          <RealMap
            locations={mapLocations}
            routeLine={routeLine}
            fitLocations={points.length > 1}
            showToolbar={false}
            showUserMarker={false}
            requestUserLocation={false}
            onMapClick={selectPosition}
          />
        </section>

        <section className="route-create-form" aria-label="Datos de la ruta">
          <label className="route-title-field">
            Nombre de la ruta
            <div className="route-title-control">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ej. Tarde junto a la bahía"
                maxLength={100}
                disabled={titleLocked}
              />
              {titleLocked ? (
                <button type="button" onClick={() => setTitleLocked(false)}>Modificar</button>
              ) : (
                <button type="button" onClick={() => title.trim() && setTitleLocked(true)} disabled={!title.trim()}>Fijar</button>
              )}
            </div>
          </label>
          <label>
            Categoría
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>

          <label className="route-owner-visibility">
            <input type="checkbox" checked={showOwnerName} onChange={(event) => setShowOwnerName(event.target.checked)} />
            <span>Mostrar mi nombre como dueño de esta ruta</span>
          </label>

          <div className="route-create-stop-editor">
            <div className="route-create-section-title">
              <strong>Nueva parada</strong>
              <button type="button" onClick={useCurrentLocation}>Usar mi ubicación</button>
            </div>
            <p>Haz clic en el mapa para marcarla.</p>
            <label>
              Lugar
              <input value={stopName} onChange={(event) => setStopName(event.target.value)} placeholder="Nombre del lugar" maxLength={100} />
            </label>
            <label>
              Nota <small>(opcional)</small>
              <input value={stopNote} onChange={(event) => setStopNote(event.target.value)} placeholder="Qué hacer o cómo llegar" maxLength={240} />
            </label>
            {selectedPosition && (
              <small className="route-create-coordinates">
                {selectedPosition.latitude.toFixed(6)}, {selectedPosition.longitude.toFixed(6)}
              </small>
            )}
            {lookingUpPlace && <p className="route-place-status" role="status">Buscando el lugar y restaurantes cercanos…</p>}
            {detectedPlace && (
              <p className="route-place-detected">
                Lugar detectado: <strong>{detectedPlace.name}</strong>
              </p>
            )}
            {nearbyPlaces.length > 0 && (
              <div className="route-nearby-list">
                <strong>Restaurantes cercanos</strong>
                {nearbyPlaces.map((place) => (
                  <button type="button" key={place.id} onClick={() => chooseNearbyPlace(place)}>
                    <span><b>{place.name}</b><small>{place.address || place.type}</small></span>
                    <small>{place.distance < 1000 ? `${Math.round(place.distance)} m` : `${(place.distance / 1000).toFixed(1)} km`}</small>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="route-add-stop" onClick={addPoint}>＋ Añadir parada</button>
          </div>

          <div className="route-create-stops">
            <div className="route-create-section-title">
              <strong>Paradas</strong>
              <span>{points.length} / 2 mín.</span>
            </div>
            {points.length ? points.map((point, index) => (
              <div className="route-create-stop" key={`${point.latitude}-${point.longitude}-${index}`}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div><strong>{point.name}</strong><small>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</small></div>
                <button type="button" aria-label={`Quitar ${point.name}`} onClick={() => setPoints((current) => current.filter((_, pointIndex) => pointIndex !== index))}>×</button>
              </div>
            )) : <p className="route-create-empty">Aún no agregaste paradas.</p>}
          </div>

          {(feedback || routeError) && <p className="route-create-feedback" role="status">{feedback || routeError}</p>}
          <button type="button" className="route-publish" onClick={publishRoute} disabled={saving || routeCalculating || Boolean(routeCalculationError) || roadGeometry.length < 2 || points.length < 2 || !titleLocked}>
            {saving ? "Publicando…" : "Publicar ruta"}
          </button>
          {!titleLocked && <small className="route-create-hint">Fija el nombre de la ruta para continuar.</small>}
          {points.length < 2 && <small className="route-create-hint">Agrega dos paradas para habilitar la publicación.</small>}
        </section>
      </div>
    </main>
  );
}
