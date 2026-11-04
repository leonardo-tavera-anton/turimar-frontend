import { useEffect, useMemo, useState } from "react";
import "./Dashboard.css";
import ResultadosBusqueda from "./ResultadosBusqueda";
import RouteCreator from "./RouteCreator";
import RealMap from "../components/dashboard/RealMap";
import { supabase } from "../supabaseClient";
import PerfilCuenta from "./PerfilCuenta";
import { getLocalMenu, getPublicLocals } from "../services/localService";
import { getPublicRoutes } from "../services/routeService";
import { getDrivingRoute } from "../services/directionsService";

// Mensaje inicial que aparece en el estado del radar costero.
const DEFAULT_NOTICE = "GPS sincronizado: Caleta & Malecón Miguel Grau";

// Datos de las tarjetas que se muestran en la pantalla principal.
// Cada tarjeta abre la lista de lugares de su propia categoría.
const guides = [
  {
    icon: "🗺️",
    tag: "Pelícano de Bahía",
    color: "blue",
    title: "Plan de Ruta",
    text: "Arma tu recorrido entre Caleta Colorada, Vesique y la bahía costera.",
    details: ["Vesique & Colorada", "Vivero Forestal"],
    action: "Ver Rutas",
  },
  {
    icon: "🦑",
    tag: "Cangrejo & Anchoveta",
    color: "orange",
    title: "Cevicherías",
    text: "El pescado más fresco: cebiche de cabrilla y conchitas a la chalaca.",
    note: "Top recomendado:",
    noteText: "Huachafaría Marina · Bolognesi",
    action: "Explorar",
  },
  {
    icon: "🏛️",
    tag: "Lobo Marino Costero",
    color: "indigo",
    title: "Atractivos Turísticos",
    text: "Cerro de la Paz, Museo Huaca San Pedro, Vivero Forestal y Malecón.",
    details: ["Huaca San Pedro", "Mirador de la Paz"],
    extra: ["Cultura Mochica", "Vista 360°"],
    action: "Explorar",
  },
  {
    icon: "🚌",
    tag: "Gaviota Gris Costera",
    color: "slate",
    title: "Pasajes & Colectivos",
    text: "Combis y colectivos: Línea 50, Línea 31. Al Nuevo Chimbote y Vesique.",
    details: ["Chimbote ⇄ N. Chimbote", "Colectivo Vesique"],
    extra: ["S/ 2.50", "S/ 5.00"],
    action: "Calcular Rutas",
  },
  {
    icon: "🏖️",
    tag: "Delfín Nariz Botella",
    color: "cyan",
    title: "Ruta de Playas",
    text: "Kayak tranquilo en Samanco, paseos en bote y olas en El Dorado.",
    details: ["Botes y kayak disponibles"],
    action: "Tours Costeros",
  },
  {
    icon: "🎪",
    tag: "Piquero Camanay",
    color: "purple",
    title: "Eventos Locales",
    text: "Patronales en San Pedrito en Junio, peñas y bulla veras gastronómicos.",
    note: "Próximo:",
    noteText: "Feria San Pedrito · Festivales y ferias vivas",
    action: "Calendario Local",
  },
  {
    icon: "🏨",
    tag: "Tortuga Marina",
    color: "green",
    title: "Hostales",
    text: "Hospedajes frente al mar y alojamientos en Chimbote y Nuevo Chimbote.",
    details: ["Frente al Malecón", "Habitaciones con WiFi"],
    extra: ["Desde S/ 60", "24 hrs"],
    action: "Hostales",
  },
  {
    icon: "🍲",
    tag: "Nutria Marina",
    color: "red",
    title: "Puntos de Comida",
    text: "Huaríques de comida criolla, caldos de mariscos, chicharronerías y café.",
    details: ["Caldos y Chifas", "Chicharrones Caleta"],
    extra: ["Mañana y noche", "Tradición"],
    action: "Descubrir",
  },
  {
    icon: "⌖",
    tag: "Negocios de la comunidad",
    color: "cyan",
    title: "Locales de la comunidad",
    text: "Explora restaurantes, hospedajes, tours y servicios publicados por sus propietarios.",
    action: "Ver locales",
  },
];

function toPublicLocation(local) {
  return {
    ...local,
    name: local.nombre,
    type: local.categoria ?? local.tipo_local ?? "Local",
    address: local.direccion ?? "Dirección no indicada",
    latitude: Number(local.latitud),
    longitude: Number(local.longitud),
    image_url: local.imagen_url ?? null,
    ownerName: local.propietario_nombre ?? local.nombre_propietario ?? local.usuario?.nombre ?? local.owner?.nombre ?? "",
    price: "Consultar",
    rating: Number(local.promedio_estrellas ?? local.promedio_calificacion ?? 0) > 0
      ? Number(local.promedio_estrellas ?? local.promedio_calificacion).toFixed(1)
      : "Sin reseñas",
    ratingCount: Number(local.cantidad_calificaciones ?? 0),
    icon: "⌂",
    isCommunityLocal: true,
  };
}

function localMatchesGuide(local, guideTitle) {
  const category = `${local.categoria ?? ""} ${local.tipo_local ?? ""}`.toLowerCase();
  if (guideTitle === "Locales de la comunidad") return true;
  if (guideTitle === "Cevicherías" || guideTitle === "Puntos de Comida") {
    return /restaurante|gastronom|comida|cevich|bar|cafe/.test(category);
  }
  if (guideTitle === "Hostales") return /hotel|hostal|hospedaje|alojamiento/.test(category);
  if (guideTitle === "Ruta de Playas") return /tour|playa|marina|servicio/.test(category);
  if (guideTitle === "Atractivos Turísticos") return /mirador|atractivo|cultural|museo|tour/.test(category);
  return false;
}

// Lugares mostrados en cada guía. 
const locationsByGuide = {
  "Plan de Ruta": [
    {
      name: "Caleta Colorada",
      type: "Punto de partida",
      address: "Costa de Chimbote",
      price: "Acceso libre",
      rating: "4.8",
      icon: "🏖️",
    },
    {
      name: "Vesique",
      type: "Ruta costera",
      address: "Bahía El Ferrol",
      price: "A 15 min",
      rating: "4.7",
      icon: "🛶",
    },
    {
      name: "Vivero Forestal",
      type: "Atractivo natural",
      address: "Nuevo Chimbote",
      price: "Acceso libre",
      rating: "4.6",
      icon: "🌿",
    },
  ],
  Cevicherías: [
    {
      name: "Cevicheria Mil Sabores",
      // Coordenadas obtenidas del Plus Code WCGJ+HFX compartido por el usuario.
      latitude: -9.0731375,
      longitude: -78.568859375,
      type: "Cevichería",
      address: "Av. Precursores, Chimbote",
      price: "Desde S/ 30",
      rating: "4.8",
      icon: "🦑",
    },
    {
      name: "Cevicheria Rico Chimbote",
      type: "Mariscos",
      // Coordenadas decodificadas del Plus Code WCH4+MQ compartido por el usuario.
      latitude: -9.070875,
      longitude: -78.593125,
      address: "Jr. Enrique Palacios 701",
      price: "Desde S/ 25",
      rating: "4.2",
      icon: "🐟",
    },
    {
      name: "Cevichería Taypa",
      type: "Cocina marina",
      // Coordenadas decodificadas del Plus Code WCFH+RP compartido por el usuario.
      latitude: -9.0755,
      longitude: -78.57075,
      address: "Caleta Chimbote",
      price: "Desde S/ 22",
      rating: "4.5",
      icon: "⚓",
    },
    {
      name: "Cevicheria El Picantito",
      // Centro aproximado del Plus Code VFJG+4W en Nuevo Chimbote.
      latitude: -9.1196875,
      longitude: -78.5226875,
      type: "Cevichería",
      address: "Av. Brasil, Mz C prima, Lote 7, Nuevo Chimbote",
      price: "Consultar precio",
      rating: "3.9",
      icon: "🌶️",
    },
    {
      name: "Cevichela",
      // Coordenadas decodificadas del Plus Code VFH9+C9V en Nuevo Chimbote.
      latitude: -9.1210625,
      longitude: -78.531609375,
      type: "Cebichería",
      address: "Frente a la Plaza Mayor, Urb. Mariscal Luzuriaga Mz C Lt. 12, Nuevo Chimbote",
      price: "Consultar precio",
      rating: "4.1",
      icon: "🐟",
    },
    {
      name: "Cevicheria El Pescadito",
      // Centro aproximado del Plus Code VFJG+3X en Chimbote.
      latitude: -9.1198125,
      longitude: -78.5225625,
      type: "Cebichería",
      address: "Nuevo Chimbote 02711",
      price: "Consultar precio",
      rating: "4.4",
      icon: "🐠",
    },
  ],
  "Atractivos Turísticos": [
    {
      name: "Plaza Almirante Miguel Grau",
      latitude: -9.078296669990191,
      longitude: -78.59004909091561,
      type: "Plaza hist�rica",
      address: "Chimbote",
      price: "Acceso libre",
      rating: "4.7",
      icon: "🏛️",
    },
    {
      name: "Plaza de Armas de Chimbote",
      latitude: -9.074461920264289,
      longitude: -78.59360195987978,
      type: "Plaza principal",
      address: "Chimbote",
      price: "Acceso libre",
      rating: "4.6",
      icon: "🏛️",
    },
    {
      name: "Vivero Forestal Chimbote",
      latitude: -9.057117661594846,
      longitude: -78.59228740382939,
      type: "�rea recreativa",
      address: "Chimbote",
      price: "Acceso libre",
      rating: "4.6",
      icon: "🌿",
    },
  ],
  "Pasajes & Colectivos": [
    {
      name: "Paradero Línea 50",
      type: "Combi",
      address: "Av. Pardo, Chimbote",
      price: "S/ 2.50",
      rating: "4.4",
      icon: "🚌",
    },
    {
      name: "Colectivo Vesique",
      type: "Transporte local",
      address: "Malecón Grau",
      price: "S/ 5.00",
      rating: "4.6",
      icon: "🚐",
    },
    {
      name: "Terminal Nuevo Chimbote",
      type: "Paradero",
      address: "Panamericana Norte",
      price: "S/ 3.00",
      rating: "4.3",
      icon: "🚏",
    },
  ],
  "Ruta de Playas": [
    {
      name: "Playa Caleta Colorada",
      type: "Playa",
      address: "Litoral de Chimbote",
      price: "Acceso libre",
      rating: "4.8",
      icon: "🏖️",
    },
    {
      name: "Playa Vesique",
      type: "Balneario",
      address: "Bahía El Ferrol",
      price: "Acceso libre",
      rating: "4.7",
      icon: "🌊",
    },
    {
      name: "El Dorado",
      type: "Playa",
      address: "Costa de Áncash",
      price: "Acceso libre",
      rating: "4.5",
      icon: "🏄",
    },
  ],
  "Eventos Locales": [
    {
      name: "Plaza de Armas",
      type: "Evento cultural",
      address: "Centro de Chimbote",
      price: "Entrada libre",
      rating: "4.6",
      icon: "🎪",
    },
    {
      name: "Malecón Grau",
      type: "Festival costero",
      address: "Frente a la bahía",
      price: "Próximamente",
      rating: "4.5",
      icon: "🎶",
    },
    {
      name: "Parroquia San Pedrito",
      type: "Festividad",
      address: "Chimbote",
      price: "Entrada libre",
      rating: "4.7",
      icon: "⛪",
    },
  ],
  Hostales: [
    {
      name: "Hostal Dos Flamingos",
      type: "Hostal",
      address: "Jr. Jorge Martin Guisse 475",
      price: "S/ 65 / noche",
      rating: "4.8",
      icon: "🏨",
    },
    {
      name: "Hostal Victoria",
      type: "Albergue",
      address: "Av. Víctor Raúl Haya de la Torre",
      price: "S/ 55 / noche",
      rating: "4.5",
      icon: "🛏️",
    },
    {
      name: "Hostal Okinawa",
      type: "Hotel centro",
      address: "Jr. Leoncio Prado, Chimbote",
      price: "S/ 75 / noche",
      rating: "4.6",
      icon: "🏩",
    },
    {
      name: "Bahía Grand Pacific",
      type: "Hotel bahía",
      address: "Malecón Miguel Grau 112",
      price: "S/ 110 / noche",
      rating: "4.7",
      icon: "🌊",
    },
  ],
  "Puntos de Comida": [
    {
      name: "Caldos Don Lucho",
      type: "Caldo de mariscos",
      address: "Caleta Chimbote",
      price: "Desde S/ 15",
      rating: "4.7",
      icon: "🍲",
    },
    {
      name: "Chifas del Puerto",
      type: "Chifa",
      address: "Av. Bolognesi",
      price: "Desde S/ 18",
      rating: "4.5",
      icon: "🥡",
    },
    {
      name: "Chicharrones La Caleta",
      type: "Comida criolla",
      address: "Malecón Grau",
      price: "Desde S/ 20",
      rating: "4.6",
      icon: "🐟",
    },
  ],
};

// Imágenes de ejemplo para las tarjetas de resultados.
const resultImages = {
  "Plan de Ruta": [
    "/images/mil_sabores.jpeg",
    "/images/rico_chimbote.jpeg",
    "/images/taypa_chimbote.jpeg",
  ],
  "Cevicherías": [
    "/images/mil_sabores.jpeg",
    "/images/rico_chimbote.jpeg",
    "/images/taypa_chimbote.jpeg",
  ],
  "Atractivos Turísticos": [
    "/images/Plaza-Grau-Chimbote.jpg",
    "/images/plaza_de_armas.jpg",
    "/images/vivero_forestal.jpeg",
  ],
  "Pasajes & Colectivos": [
    "/images/rico_chimbote.jpeg",
    "/images/taypa_chimbote.jpeg",
    "/images/mil_sabores.jpeg",
  ],
  "Ruta de Playas": [
    "/images/taypa_chimbote.jpeg",
    "/images/rico_chimbote.jpeg",
    "/images/mil_sabores.jpeg",
  ],
  "Eventos Locales": [
    "/images/rico_chimbote.jpeg",
    "/images/mil_sabores.jpeg",
    "/images/taypa_chimbote.jpeg",
  ],
  Hostales: [
    "/images/mil_sabores.jpeg",
    "/images/rico_chimbote.jpeg",
    "/images/taypa_chimbote.jpeg",
    "/images/mil_sabores.jpeg",
  ],
  "Puntos de Comida": [
    "/images/mil_sabores.jpeg",
    "/images/rico_chimbote.jpeg",
    "/images/taypa_chimbote.jpeg",
  ],
};

// Descripciones que aparecen debajo del título de algunas categorías.
const resultDescriptions = {
  Cevicherías: "Sabores del mar, restaurantes verificados y cocina marina local.",
  Hostales: "Hospedajes verificados para descansar cerca de la bahía.",
  "Atractivos Turísticos": "Lugares imperdibles para conocer la historia y paisaje local.",
};

// Filtros secundarios disponibles para cada guía.
// Las pestañas de ciudad se manejan por separado dentro de ResultadosBusqueda.
const resultFilters = {
  Hostales: ["Más recomendados", "Más cercanos", "Wi-Fi", "Cochera"],
  Cevicherías: ["Más recomendados", "Más cercanos", "Vista al mar"],
  "Atractivos Turísticos": ["Más recomendados", "Más cercanos", "Acceso libre"],
};

// Renderiza una tarjeta de la pantalla principal y notifica al componente
// Dashboard qué guía seleccionó el usuario.
function GuideCard({ guide, onSelect }) {
  return (
    <article className="guide-card">
      <div className="guide-head">
        <span className="guide-icon">{guide.icon}</span>
        <span className={`guide-tag ${guide.color}`}>{guide.tag}</span>
      </div>
      <h3>{guide.title}</h3>
      <p>{guide.text}</p>
      {guide.note && (
        <div className="guide-note">
          <strong>{guide.note}</strong>
          <span>{guide.noteText}</span>
        </div>
      )}
      {guide.details && (
        <div className="guide-details">
          {guide.details.map((detail, index) => (
            <div key={detail}>
              <span>•</span>
              {detail}
              {guide.extra?.[index] && <b>{guide.extra[index]}</b>}
            </div>
          ))}
        </div>
      )}
      <button className="card-action" onClick={() => onSelect(guide)}>
        {guide.action}
      </button>
    </article>
  );
}

// Muestra el radar costero, sus puntos de referencia y acciones rápidas.
function Radar({ onAction, locations, localsLoadError }) {
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [selectedLocal, setSelectedLocal] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState("");

  const toggleLocation = () => {
    const nextValue = !locationEnabled;
    setLocationEnabled(nextValue);
    onAction(nextValue ? "Ubicación activada" : "Ubicación desactivada");
  };

  const openLocal = async (local) => {
    setSelectedLocal(local);
    setMenuItems([]);
    setMenuError("");
    setMenuLoading(true);
    try {
      setMenuItems(await getLocalMenu(local.id));
    } catch (error) {
      setMenuError(`No se pudo cargar la carta: ${error.message}`);
    } finally {
      setMenuLoading(false);
    }
  };

  return (
    <section className="radar-card">
      <div className="radar-header">
        <div className="radar-title">
          <span className="radar-icon">◌</span>
          <div>
            <h2>
              Mapa en Vivo de Turi-Mar
            </h2>
          </div>
        </div>
        <div className="radar-controls">
          <span className="radar-local-count">{localsLoadError ? "Locales no disponibles" : `${locations.length} locales publicados`}</span>
          <button
            className={`gps ${locationEnabled ? "location-on" : "location-off"}`}
            onClick={toggleLocation}
          >
            {locationEnabled ? "Ubicación activa" : "Ubicación apagada"}
          </button>
        </div>
      </div>
      <div className={`radar-map ${selectedLocal ? "radar-map-with-sidebar" : ""}`}>
        <div className="radar-map-canvas">
          <RealMap
            locations={locations}
            activeLocation={selectedLocal}
            onSelectLocation={(location) => location.isCommunityLocal && openLocal(location)}
            showToolbar={false}
            locationEnabled={locationEnabled}
            onToggleLocation={toggleLocation}
          />
        </div>
        {selectedLocal && (
          <aside className="radar-local-sidebar">
            <div className="radar-local-sidebar-heading">
              <span>LOCAL DEL PROPIETARIO</span>
              <button type="button" aria-label="Cerrar ficha del local" onClick={() => setSelectedLocal(null)}>×</button>
            </div>
            <h3>{selectedLocal.name}</h3>
            <p className={`radar-local-owner ${selectedLocal.ownerName ? "" : "unavailable"}`}>
              {selectedLocal.ownerName ? `Propietario: ${selectedLocal.ownerName}` : "Nombre del propietario no disponible"}
            </p>
            <span className="radar-local-category">{selectedLocal.type}</span>
            <p>{selectedLocal.address}</p>
            {selectedLocal.descripcion && <p>{selectedLocal.descripcion}</p>}
            {selectedLocal.telefono && <p><b>Teléfono:</b> {selectedLocal.telefono}</p>}
            {selectedLocal.horario && <p><b>Horario:</b> {selectedLocal.horario}</p>}
            <div className="radar-local-menu">
              <strong>Carta</strong>
              {menuLoading && <small>Cargando platos…</small>}
              {menuError && <small className="radar-local-error" role="alert">{menuError}</small>}
              {!menuLoading && !menuError && menuItems.length === 0 && <small>Aún no hay platos publicados.</small>}
              {menuItems.map((dish) => (
                <div key={dish.id ?? `${dish.nombre}-${dish.precio}`}>
                  <span><b>{dish.nombre ?? dish.name ?? "Plato"}</b>{dish.descripcion && <small>{dish.descripcion}</small>}</span>
                  <strong>S/ {Number(dish.precio ?? 0).toFixed(2)}</strong>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

// Pie de página informativo del dashboard.
function Footer() {
  return (
    <footer>
      <div className="footer-grid">
        <div>
          <div className="footer-brand">
            <span className="brand-mark">◒</span>
            <strong>
              Turi<span>-Mar</span>
            </strong>
          </div>
          <p>
            Tu compás inteligente para redescubrir la Bahía de Ferrol, las
            playas vírgenes de Nuevo Chimbote y la gastronomía marina de mayor
            tradición en la costa de Áncash.
          </p>
        </div>
        <div>
          <h4>ENLACES ÚTILES</h4>
          <a>Malecón Grau y Bahía El Ferrol</a>
          <a>Plaza Mayor de Nuevo Chimbote</a>
        </div>
        <div>
          <h4>CLIMA Y SEGURIDAD</h4>
          <p>
            🌊 <b>Mar y Viento Costero</b>
            <br />
            22°C · Vientos SSO 14 km/h
          </p>
        </div>
        <div>
          <h4>COMUNIDAD COSTERA</h4>
          <p>
            Comparte tus postales con <b>#TuriMar</b>.
          </p>
        </div>
      </div>
      <div className="copyright">
        © 2026 Turi-Mar. Turismo Costero y Rutas de la Provincia del Santa.
      </div>
    </footer>
  );
}

function AiRoutePreview({ rutaData, routeError, onOpen }) {
  if (routeError && !rutaData) {
    return (
      <section className="ai-route-preview ai-route-error">
        <div>
          <span className="ai-route-kicker">ASISTENTE DE RUTAS</span>
          <h2>No pudimos preparar tu ruta personalizada</h2>
          <p>{routeError}</p>
        </div>
        <button onClick={onOpen}>Ver rutas disponibles</button>
      </section>
    );
  }

  if (!rutaData) return null;

  return (
    <section className="ai-route-preview">
      <div className="ai-route-main">
        <div className="ai-route-heading">
          <span className="ai-route-icon">✦</span>
          <div>
            <span className="ai-route-kicker">TU RUTA PERSONALIZADA</span>
            <h2>{rutaData.titulo_ruta}</h2>
          </div>
          <span className="ai-route-badge">Generada por IA</span>
        </div>
        <p className="ai-route-description">{rutaData.descripcion}</p>
        <div className="ai-route-stats">
          <span><b>{rutaData.duracion_total_horas} h</b> duración</span>
          <span><b>S/ {Number(rutaData.presupuesto_total_estimado).toFixed(2)}</b> presupuesto estimado</span>
          <span><b>{rutaData.paradas?.length ?? 0}</b> paradas</span>
        </div>
      </div>
      <div className="ai-route-stops">
        <span className="ai-route-stops-label">PRIMERAS PARADAS</span>
        {(rutaData.paradas ?? []).slice(0, 3).map((parada) => (
          <div className="ai-route-stop" key={`${parada.orden}-${parada.nombre}`}>
            <span>{parada.orden}</span>
            <strong>{parada.nombre}</strong>
          </div>
        ))}
        <button className="ai-route-open" onClick={onOpen}>Abrir ruta completa <span>→</span></button>
      </div>
    </section>
  );
}

// Dashboard principal. Decide si muestra las guías o los resultados
// y mantiene los avisos temporales de los botones superiores.
const communityRouteImages = {
  gastronomia: "/images/mil_sabores.jpeg",
  naturaleza: "/images/mil_sabores.jpeg",
  playa: "/images/mil_sabores.jpeg",
  cultural: "/images/mil_sabores.jpeg",
  default: "/images/mil_sabores.jpeg",
};
const EMPTY_ROUTE_POINTS = [];

function getRouteImage(category = "") {
  const normalized = (category ?? "").toLowerCase();
  if (/gastro|comida|restaurante/.test(normalized)) return communityRouteImages.gastronomia;
  if (/natur|forest|ecotur/.test(normalized)) return communityRouteImages.naturaleza;
  if (/playa|marina|caleta|costa/.test(normalized)) return communityRouteImages.playa;
  if (/cultur|historia|mirador/.test(normalized)) return communityRouteImages.cultural;
  return communityRouteImages.default;
}

function CommunityRouteDetail({ route, onBack }) {
  const rawPoints = route.puntos ?? route.ruta_puntos ?? route.points ?? EMPTY_ROUTE_POINTS;
  const points = useMemo(() => [...rawPoints]
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map((point, index) => ({
      name: point.nombre ?? point.name ?? `Parada ${index + 1}`,
      address: point.comentario_tramo ?? point.address ?? `Parada ${index + 1}`,
      latitude: Number(point.latitud ?? point.latitude),
      longitude: Number(point.longitud ?? point.longitude),
      kind: index === 0 ? "start" : "stop",
    })), [rawPoints]);
  const owner = route.propietario_nombre ?? route.nombre_propietario ?? route.usuario?.nombre ?? route.owner?.nombre;
  const mapPoints = useMemo(() => points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)), [points]);
  const [routeLine, setRouteLine] = useState([]);
  const [routeLineError, setRouteLineError] = useState(false);

  useEffect(() => {
    if (mapPoints.length < 2) {
      setRouteLine([]);
      return undefined;
    }
    const controller = new AbortController();
    Promise.all(mapPoints.slice(0, -1).map((point, index) => getDrivingRoute(point, mapPoints[index + 1], controller.signal)))
      .then((segments) => {
        if (!controller.signal.aborted) {
          setRouteLine(segments.flatMap((segment, index) => index === 0 ? segment.coordinates : segment.coordinates.slice(1)));
          setRouteLineError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setRouteLineError(true);
      });
    return () => controller.abort();
  }, [mapPoints]);

  return (
    <main className="public-route-detail-page">
      <header className="public-route-detail-header">
        <button type="button" onClick={onBack}>← Volver a explorar</button>
        <span>RUTA DE LA COMUNIDAD</span>
      </header>
      <div className="public-route-detail-heading">
        <div>
          <span>{route.categoria || "Ruta general"}</span>
          <h1>{route.titulo ?? route.titulo_ruta ?? route.title ?? "Ruta de la comunidad"}</h1>
          {route.mostrar_propietario !== false && owner && <p>Compartida por {owner}</p>}
          {route.descripcion && <p>{route.descripcion}</p>}
        </div>
        <strong>{points.length} paradas</strong>
      </div>
      <div className="public-route-detail-layout">
        <section className="public-route-detail-map" aria-label="Mapa de la ruta">
          {mapPoints.length ? <><RealMap locations={mapPoints} routeLine={routeLine} fitLocations showUserMarker={false} requestUserLocation={false} showToolbar={false} />{routeLineError && <small className="public-route-map-status">Se muestran las paradas; no se pudo trazar el camino.</small>}</> : <p>Esta ruta no tiene coordenadas disponibles para mostrar el mapa.</p>}
        </section>
        <section className="public-route-stops-panel">
          <h2>Recorrido</h2>
          {points.length ? <ol>{points.map((point, index) => (
            <li key={`${point.name}-${index}`}><span>{index + 1}</span><div><strong>{point.name}</strong>{point.address && <small>{point.address}</small>}</div></li>
          ))}</ol> : <p>Esta ruta aún no tiene paradas publicadas.</p>}
        </section>
      </div>
    </main>
  );
}

function CommunityRouteList({ routes, onBack, onSelect }) {
  return (
    <main className="community-route-list-page">
      <header className="public-route-detail-header">
        <button type="button" onClick={onBack}>← Volver al inicio</button>
        <span>EXPLORA TURI-MAR</span>
      </header>
      <div className="community-route-list-heading">
        <div><span>RECORRIDOS COMPARTIDOS</span><h1>Rutas de la comunidad</h1><p>Elige un recorrido para ver sus paradas y el mapa.</p></div>
        <strong>{routes.length} rutas</strong>
      </div>
      {routes.length ? <div className="community-route-list-grid">
        {routes.map((route) => {
          const stops = route.puntos ?? route.ruta_puntos ?? route.points ?? [];
          const owner = route.propietario_nombre ?? route.nombre_propietario ?? route.usuario?.nombre ?? route.owner?.nombre;
          return <button className="community-route-list-card" key={route.id ?? route.ruta_id} onClick={() => onSelect(route)}>
            <span className="community-route-list-image" style={{ backgroundImage: `url("${getRouteImage(route.categoria)}")` }} />
            <span className="community-route-list-copy"><small>{route.categoria || "Ruta general"}</small><strong>{route.titulo ?? route.titulo_ruta ?? route.title ?? "Ruta de la comunidad"}</strong>{route.mostrar_propietario !== false && owner && <span>Por {owner}</span>}<span>{stops.length} {stops.length === 1 ? "parada" : "paradas"}</span></span>
            <span className="community-route-list-open">Ver recorrido →</span>
          </button>;
        })}
      </div> : <p className="community-section-status">Todavía no hay rutas públicas para mostrar.</p>}
    </main>
  );
}

export default function Dashboard({ onLogout, rutaData, routeError }) {
  const [notice, setNotice] = useState(DEFAULT_NOTICE);
  const [selectedGuide, setSelectedGuide] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [communityLocals, setCommunityLocals] = useState([]);
  const [localsLoadError, setLocalsLoadError] = useState("");
  const [publicRoutes, setPublicRoutes] = useState([]);
  const [routesLoadError, setRoutesLoadError] = useState("");
  const [selectedPublicRoute, setSelectedPublicRoute] = useState(null);
  const [showCommunityRouteList, setShowCommunityRouteList] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (active) setProfile(user);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getPublicRoutes()
      .then((routes) => { if (active) setPublicRoutes(routes); })
      .catch((error) => { if (active) setRoutesLoadError(error.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getPublicLocals()
      .then((locals) => {
        if (active) setCommunityLocals(locals);
      })
      .catch((error) => {
        if (active) setLocalsLoadError(error.message);
      });
    return () => { active = false; };
  }, []);

  // Muestra un aviso y lo devuelve al texto inicial después de 2.8 segundos.
  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(DEFAULT_NOTICE), 2800);
  };
  if (profileOpen) {
    return <PerfilCuenta profile={profile} onBack={() => setProfileOpen(false)} />;
  }
  if (selectedPublicRoute) {
    return <CommunityRouteDetail route={selectedPublicRoute} onBack={() => setSelectedPublicRoute(null)} />;
  }
  if (showCommunityRouteList) {
    return <CommunityRouteList routes={publicRoutes} onBack={() => setShowCommunityRouteList(false)} onSelect={setSelectedPublicRoute} />;
  }
  if (selectedGuide)
    if (selectedGuide.title === "Plan de Ruta") {
      return (
        <RouteCreator
          onBack={() => setSelectedGuide(null)}
          rutaData={rutaData}
          routeError={routeError}
        />
      );
    }

  if (selectedGuide)
    return (
      <ResultadosBusqueda
        guide={selectedGuide}
        locationsByGuide={locationsByGuide}
        communityLocations={communityLocals
          .filter((local) => localMatchesGuide(local, selectedGuide.title))
          .map(toPublicLocation)}
        resultImages={resultImages}
        resultDescriptions={resultDescriptions}
        resultFilters={resultFilters}
        onBack={() => setSelectedGuide(null)}
      />
    );
  return (
    <div className="turimar-page">
      <header className="topbar">
        <button className="brand">
          <span className="brand-mark">◒</span>
          <strong>
            Turi<span>-Mar</span>
          </strong>
        </button>
        <nav>
          <button
            className="routes"
            onClick={() => setSelectedGuide({ title: "Plan de Ruta" })}
          >
            ⌯ Mis Rutas
          </button>
          <button
            className="avatar profile-trigger"
            aria-label="Abrir perfil"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
          >
            {(profile?.user_metadata?.full_name || profile?.email || "JR").slice(0, 2).toUpperCase()}
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <strong>{profile?.user_metadata?.full_name || "Tu perfil"}</strong>
              <span>{profile?.email || "Sesión de Turi-Mar"}</span>
              <button onClick={onLogout}>Cerrar sesión</button>
            </div>
          )}
          <button className="logout" onClick={onLogout}>
            Salir
          </button>
        </nav>
      </header>
      <main className="content">
        <section className="community-locals-section">
          <div className="section-title">
            <div><h2>Locales de la comunidad</h2><p>Descubre lugares publicados por sus dueños.</p></div>
            <button type="button" onClick={() => setSelectedGuide({ title: "Locales de la comunidad" })}>Ver todos</button>
          </div>
          {localsLoadError && <p className="community-section-status">No se pudieron cargar los locales publicados.</p>}
          {!localsLoadError && communityLocals.length === 0 && <p className="community-section-status">Aún no hay locales publicados.</p>}
          <div className="community-locals-grid">
            {communityLocals.slice(0, 4).map((local) => {
              const publicLocal = toPublicLocation(local);
              return <button className="community-local-card" type="button" key={local.id} onClick={() => setSelectedGuide({ title: "Locales de la comunidad" })}>
                {publicLocal.image_url ? <img src={publicLocal.image_url} alt="" /> : <span className="community-local-card-placeholder">⌂</span>}
                <span className="community-local-card-copy"><small>{publicLocal.type}</small><strong>{publicLocal.name}</strong><span>{publicLocal.ownerName ? `Por ${publicLocal.ownerName}` : publicLocal.address}</span><span>★ {publicLocal.rating}{publicLocal.ratingCount ? ` · ${publicLocal.ratingCount}` : ""}</span></span>
                <span className="community-local-card-arrow">→</span>
              </button>;
            })}
          </div>
        </section>
        <section className="public-routes-section">
          <div className="section-title"><div><h2>Rutas de la comunidad</h2><p>Recorridos compartidos por quienes conocen la bahía.</p></div></div>
          {routesLoadError && <p className="public-routes-status">No se pudieron cargar las rutas públicas.</p>}
          {!routesLoadError && publicRoutes.length === 0 && <p className="public-routes-status">Aún no hay rutas públicas para mostrar.</p>}
          <button type="button" className="community-route-entry" onClick={() => setShowCommunityRouteList(true)}>
            <span className="community-route-entry-image" style={{ backgroundImage: `url("${communityRouteImages.playa}")` }} />
            <span><small>RECORRIDOS DE LA COMUNIDAD</small><strong>Explora todas las rutas</strong><em>{publicRoutes.length} rutas con mapa y paradas</em></span>
            <b>Ver rutas <i>→</i></b>
          </button>
          <div className="public-routes-grid">
            {publicRoutes.map((route) => {
              const stops = route.puntos ?? route.ruta_puntos ?? route.points ?? [];
              const owner = route.usuario?.nombre ?? route.usuario?.full_name ?? route.owner?.nombre ?? route.propietario_nombre ?? route.nombre_propietario ?? route.author_name;
              return <article className="public-route-card" role="button" tabIndex={0} key={route.id ?? route.ruta_id} onClick={() => setSelectedPublicRoute(route)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedPublicRoute(route); } }}>
                <span className="public-route-card-image" style={{ backgroundImage: `url("${getRouteImage(route.categoria)}")` }} />
                <span className="public-route-category">{route.categoria || "Ruta general"}</span>
                <h3>{route.titulo ?? route.titulo_ruta ?? route.title ?? "Ruta de la comunidad"}</h3>
                {route.mostrar_propietario !== false && owner && <p className="public-route-owner">Dueño: {owner}</p>}
                {route.descripcion && <p>{route.descripcion}</p>}
                {stops.length > 0 && <ol>{stops.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map((stop, index) => <li key={stop.id ?? `${stop.nombre ?? stop.name}-${index}`}>{stop.nombre ?? stop.name}</li>)}</ol>}
                <span className="public-route-card-action">Ver ruta <b>→</b></span>
              </article>;
            })}
          </div>
        </section>
        <Radar
          onAction={showNotice}
          locations={communityLocals.map(toPublicLocation)}
          localsLoadError={localsLoadError}
        />
        <AiRoutePreview
          rutaData={rutaData}
          routeError={routeError}
          onOpen={() => setSelectedGuide({ title: "Plan de Ruta" })}
        />
        <section className="guides-section">
          <div className="section-title">
            <div>
              <h1>Guías Temáticas Turi-Mar</h1>
            </div>
          </div>
          <div className="guides-grid">
            {guides.map((guide) => (
              <GuideCard
                key={guide.title}
                guide={guide}
                onSelect={setSelectedGuide}
              />
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
