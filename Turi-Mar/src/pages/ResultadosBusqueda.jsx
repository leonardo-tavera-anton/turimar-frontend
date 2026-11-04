import { useEffect, useRef, useState } from "react";
import "./Dashboard.css";
import RealMap from "../components/dashboard/RealMap";
import { getDrivingRoute } from "../services/directionsService";
import { getLocalMenu, getLocalRating, rateLocal } from "../services/localService";
import { supabase } from "../supabaseClient";

// Pantalla de resultados de una guía: lista, filtros, mapa visual y ficha.
export default function ResultadosBusqueda({
  guide,
  locationsByGuide,
  communityLocations = [],
  resultImages,
  resultDescriptions,
  resultFilters,
  onBack,
}) {
  // Busca los lugares de la guía actual; si no existe, usa una lista vacía.
  // Obtiene los lugares asociados con la guía seleccionada.
  const locations = [...(locationsByGuide[guide.title] ?? []), ...communityLocations];

  // Lugar que aparece seleccionado inicialmente en el mapa y en la ficha.
  const [activeLocation, setActiveLocation] = useState(null);
  const [zoomOnSelection, setZoomOnSelection] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const navigationController = useRef(null);
  const [publicMenu, setPublicMenu] = useState([]);
  const [publicMenuOpen, setPublicMenuOpen] = useState(false);
  const [publicMenuLoading, setPublicMenuLoading] = useState(false);
  const [publicMenuError, setPublicMenuError] = useState("");
  const [ratings, setRatings] = useState({});
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingMessage, setRatingMessage] = useState("");

  useEffect(() => {
    let active = true;
    if (!activeLocation?.isCommunityLocal || !activeLocation.id) return undefined;
    getLocalRating(activeLocation.id)
      .then((rating) => { if (active) setRatings((current) => ({ ...current, [activeLocation.id]: rating })); })
      .catch(() => {});
    return () => { active = false; };
  }, [activeLocation?.id, activeLocation?.isCommunityLocal]);

  const submitLocalRating = async (stars) => {
    if (!activeLocation?.isCommunityLocal) return;
    setRatingSaving(true);
    setRatingMessage("");
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error("Inicia sesión para calificar este local.");
      await rateLocal(activeLocation.id, user.id, stars);
      const summary = await getLocalRating(activeLocation.id);
      setRatings((current) => ({ ...current, [activeLocation.id]: summary }));
      setActiveLocation((current) => current ? { ...current, rating: Number(summary.promedio ?? 0).toFixed(1), ratingCount: summary.total ?? 0 } : current);
      setRatingMessage("¡Gracias por tu calificación!");
    } catch (error) {
      setRatingMessage(error instanceof Error ? error.message : "No se pudo guardar tu calificación.");
    } finally {
      setRatingSaving(false);
    }
  };

  const selectLocation = (location) => {
    navigationController.current?.abort();
    setNavigationLoading(false);
    setNavigationRoute(null);
    setNavigationError("");
    setPublicMenu([]);
    setPublicMenuOpen(false);
    setPublicMenuError("");
    setRatingMessage("");
    setActiveLocation(location);
    setZoomOnSelection(true);
  };

  const togglePublicMenu = async () => {
    if (publicMenuOpen) {
      setPublicMenuOpen(false);
      return;
    }
    setPublicMenuOpen(true);
    if (publicMenu.length || !activeLocation?.id) return;

    setPublicMenuLoading(true);
    setPublicMenuError("");
    try {
      setPublicMenu(await getLocalMenu(activeLocation.id));
    } catch (error) {
      setPublicMenuError(`No se pudo cargar la carta: ${error.message}`);
    } finally {
      setPublicMenuLoading(false);
    }
  };

  const startNavigation = async () => {
    if (!Number.isFinite(activeLocation?.latitude) || !Number.isFinite(activeLocation?.longitude)) return;
    if (!navigator.geolocation) {
      setNavigationError("Este navegador no permite obtener tu ubicación.");
      return;
    }

    navigationController.current?.abort();
    const controller = new AbortController();
    navigationController.current = controller;
    setNavigationLoading(true);
    setNavigationError("");
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30000,
        });
      });
      const origin = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const route = await getDrivingRoute(origin, activeLocation, controller.signal);
      if (controller.signal.aborted) return;
      setNavigationRoute({ ...route, origin, destination: activeLocation });
      setZoomOnSelection(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error?.code === 1) setNavigationError("Permite el acceso a tu ubicación para trazar la ruta.");
      else if (error?.code === 2 || error?.code === 3) setNavigationError("No se pudo obtener tu ubicación. Inténtalo nuevamente.");
      else setNavigationError(error instanceof Error ? error.message : "No se pudo trazar la ruta.");
    } finally {
      if (!controller.signal.aborted) setNavigationLoading(false);
    }
  };

  const stopNavigation = () => {
    navigationController.current?.abort();
    setNavigationLoading(false);
    setNavigationRoute(null);
    setNavigationError("");
  };

  // Solo una pestaña de ciudad puede estar activa a la vez.
  const [activeTab, setActiveTab] = useState("Todos");

  // Controla el estado visual de los filtros secundarios.
  const [activeFilter, setActiveFilter] = useState("Más recomendados");
  // Selecciona imágenes y filtros según la categoría actual.
  const images = resultImages[guide.title] ?? resultImages["Plan de Ruta"];
  const extraFilters = resultFilters[guide.title] ?? ["Más recomendados", "Más cercanos"];
  const ratedLocations = locations.map((location) => {
    const summary = ratings[location.id];
    return summary ? { ...location, rating: Number(summary.promedio ?? 0).toFixed(1), ratingCount: summary.total ?? 0 } : location;
  });

  // Filtra la lista según la ciudad seleccionada.
  const visibleLocations = ratedLocations.filter((location) => {
    if (activeTab === "Chimbote") return !location.address.toLowerCase().includes("nuevo");
    if (activeTab === "Nuevo Chimbote") return location.address.toLowerCase().includes("nuevo");
    return true;
  });

  // El mapa muestra solo los resultados visibles y con coordenadas verificadas.
  const hasMappableLocations = visibleLocations.some(
    ({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude),
  );
  const mapLocations = navigationRoute ? [
    {
      ...navigationRoute.origin,
      name: "Tu ubicación",
      address: "Punto de partida",
      kind: "start",
    },
    navigationRoute.destination,
  ] : visibleLocations;
  const routePositions = navigationRoute?.coordinates ?? [];

  const changeTab = (tab) => {
    stopNavigation();
    setActiveTab(tab);
    setZoomOnSelection(false);
    setActiveLocation(null);
  };

  // Renderiza el panel lateral y el mapa de resultados.
  return (
    <div className="locations-screen">
      <aside className="locations-list">
        <div className="locations-top">
          <button className="locations-back" onClick={onBack}>← Volver al lobby turístico</button>
          <span>{visibleLocations.length} disponibles</span>
        </div>
        <div className="results-search">⌕ <span>{guide.title}</span><b>×</b></div>
        <div className="results-heading">
          <div>
            <h2>Resultados de {guide.title}</h2>
            <p>{resultDescriptions[guide.title] ?? "Explora opciones seleccionadas para tu próxima ruta."}</p>
          </div>
          <span className="verified-count">✓ {visibleLocations.length} verificados</span>
        </div>
        <div className="location-tabs">
          {["Todos", "Chimbote", "Nuevo Chimbote"].map((tab) => (
            <button className={activeTab === tab ? "selected" : ""} key={tab} onClick={() => changeTab(tab)}>
              {tab}
            </button>
          ))}
        </div>
        <div className="location-filters">
          {extraFilters.map((filter) => (
            <button className={activeFilter === filter ? "selected" : ""} key={filter} onClick={() => setActiveFilter(filter)}>
              {filter === "Más recomendados" ? "★ " : filter === "Más cercanos" ? "⌖ " : ""}{filter}
            </button>
          ))}
        </div>
        <div className="location-cards">
          {visibleLocations.length === 0 ? (
            <div className="empty-results">
              <strong>No hay resultados en esta zona</strong>
              <span>Prueba con otra ubicación para ver los lugares disponibles.</span>
            </div>
          ) : visibleLocations.map((location) => {
            const locationIndex = locations.indexOf(location);
            return (
              <button
                className={`location-card ${activeLocation?.name === location.name ? "active" : ""}`}
                  key={location.id ?? location.name}
                onClick={() => selectLocation(location)}
              >
                <span className="location-photo">
                  {location.image_url ? (
                    <img src={location.image_url} alt="" />
                  ) : location.isCommunityLocal ? (
                    <span className="community-local-icon">⌂</span>
                  ) : (
                    <img src={images[locationIndex % images.length]} alt="" />
                  )}
                  <em>{location.type}</em>
                </span>
                <span className="location-copy">
                  <strong>{location.name}</strong>
                  <small>★ {location.rating}{location.ratingCount ? ` (${location.ratingCount})` : ""} · {location.type}</small>
                  <small>⌖ {location.address}</small>
                  <span className="location-price">
                    <b>{location.price ?? "Consultar"}</b>
                    <i>{location.isCommunityLocal ? (location.ownerName ? `Por ${location.ownerName}` : "Publicado por la comunidad") : location.distance ?? (locationIndex === 0 ? "650 m" : locationIndex === 1 ? "1.2 km" : "A 3 cuadras")}</i>
                  </span>
                </span>
                <span className="location-direction">⌖</span>
              </button>
            );
          })}
        </div>
      </aside>
      <main className="locations-map">
        <RealMap
          locations={mapLocations}
          activeLocation={navigationRoute ? null : activeLocation}
          onSelectLocation={selectLocation}
          fitLocations={navigationRoute ? true : hasMappableLocations}
          zoomToActiveLocation={navigationRoute ? false : zoomOnSelection}
          routeLine={routePositions}
          showUserMarker={false}
          onToggleLocation={() => {}}
        />
        {navigationRoute ? (
          <section className="location-detail navigation-detail">
            <button className="close-detail" aria-label="Finalizar navegación" title="Finalizar navegación" onClick={stopNavigation}>×</button>
            <span className="detail-photo">⌖</span>
            <div className="navigation-summary">
              <h3>Ruta trazada</h3>
              <p>Desde tu ubicación hasta {navigationRoute.destination.name}</p>
              <div className="navigation-metrics">
                <strong>{(navigationRoute.distanceMeters / 1000).toFixed(1)} km</strong>
                <strong>{Math.max(1, Math.round(navigationRoute.durationSeconds / 60))} min aprox.</strong>
              </div>
              <ol>
                {navigationRoute.steps.slice(0, 4).map((step, index) => (
                  <li key={`${step.instruction}-${index}`}>{step.instruction}</li>
                ))}
              </ol>
            </div>
            <button className="navigate-button navigation-stop" onClick={stopNavigation}>Finalizar ruta</button>
          </section>
        ) : activeLocation && (
          <section className="location-detail">
            <button className="close-detail" aria-label="Volver a todas las secciones" title="Volver a todas las secciones" onClick={onBack}>×</button>
            <span className="detail-photo">{activeLocation.icon}</span>
            <div>
              <h3>{activeLocation.name} <small>★ {activeLocation.rating}</small></h3>
              <p>{activeLocation.address}</p>
              <b>{activeLocation.price ?? "Consultar con el local"}</b>
              {activeLocation.isCommunityLocal ? (
                <p className="detail-meta">{activeLocation.ownerName ? `Publicado por ${activeLocation.ownerName}` : "Publicado por un propietario de Turi-Mar"}</p>
              ) : <p className="detail-meta">A 650 m · 7 min a pie</p>}
              {activeLocation.isCommunityLocal && (
                <div className="local-rating-control">
                  <strong>{ratings[activeLocation.id]?.total ? `${Number(ratings[activeLocation.id].promedio).toFixed(1)} de 5 · ${ratings[activeLocation.id].total} calificaciones` : "Califica este local"}</strong>
                  <div role="group" aria-label={`Calificar ${activeLocation.name}`}>
                    {[1, 2, 3, 4, 5].map((stars) => (
                      <button type="button" key={stars} aria-label={`${stars} estrellas`} disabled={ratingSaving} onClick={() => submitLocalRating(stars)}>★</button>
                    ))}
                  </div>
                  {ratingMessage && <small role="status">{ratingMessage}</small>}
                </div>
              )}
              {activeLocation.isCommunityLocal && (
                <button type="button" className="public-menu-toggle" onClick={togglePublicMenu}>
                  {publicMenuOpen ? "Ocultar carta" : "Ver carta"}
                </button>
              )}
              {publicMenuOpen && activeLocation.isCommunityLocal && (
                <div className="public-menu-panel">
                  <strong>Carta del local</strong>
                  {publicMenuLoading && <small>Cargando platos…</small>}
                  {publicMenuError && <small className="public-menu-error" role="alert">{publicMenuError}</small>}
                  {!publicMenuLoading && !publicMenuError && publicMenu.length === 0 && <small>Aún no hay platos publicados.</small>}
                  {publicMenu.map((dish) => (
                    <div className="public-menu-item" key={dish.id ?? `${dish.nombre}-${dish.precio}`}>
                      <span><b>{dish.nombre ?? dish.name ?? "Plato"}</b>{dish.descripcion && <small>{dish.descripcion}</small>}</span>
                      <strong>S/ {Number(dish.precio ?? 0).toFixed(2)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="navigate-button"
              disabled={!Number.isFinite(activeLocation.latitude) || !Number.isFinite(activeLocation.longitude) || navigationLoading}
              onClick={startNavigation}
            >
              {navigationLoading ? "Trazando ruta…" : "⌖ Trazar ruta desde mi ubicación"}
            </button>
            {navigationError && <p className="navigation-error" role="alert">{navigationError}</p>}
          </section>
        )}
      </main>
    </div>
  );
}
