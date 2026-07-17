<template>
  <div class="map-wrapper">
    <!-- Loading overlay — shown while initial stations fetch is in flight -->
    <div v-if="isLoadingStations" class="stations-loading-overlay">
      <div class="loading-spinner"></div>
      <p>กำลังโหลดข้อมูลสถานี…</p>
    </div>
    <!-- Error overlay — shown if DB is down and stations is empty -->
    <div v-else-if="!isLoadingStations && stations.length === 0" class="stations-error-overlay">
      <p>ไม่สามารถโหลดข้อมูลสถานีได้ กรุณารีเฟรชหน้าเว็บ</p>
    </div>
    <l-map
      v-model:zoom="zoom"
      v-model:center="center"
      style="height: 100%"
      @ready="onMapReady"
    >
      <l-tile-layer 
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
        attribution="&copy; OpenStreetMap contributors" 
      />

      <!-- Unselected Alternative Routes (clickable) -->
      <l-polyline 
        v-for="(route, index) in allRouteGeometries"
        :key="'alt-' + index"
        v-if="index !== activeRouteIndex"
        :lat-lngs="route" 
        color="#94a3b8" 
        :weight="10" 
        :opacity="0.65"
        :options="{ interactive: true, cursor: 'pointer', pane: 'altRoutesPane' }"
        @click="onAltPolylineClick(index)"
      />

      <!-- Route Polyline (Active & Ghost) -->
      <l-polyline 
        v-if="trimmedRouteGeometry.length > 0" 
        :lat-lngs="trimmedRouteGeometry" 
        :color="isGhostRoute ? '#9CA3AF' : '#8B5CF6'" 
        :weight="isGhostRoute ? 4 : 6" 
        :opacity="isGhostRoute ? 0.5 : 1"
        :dash-array="isGhostRoute ? '10, 10' : ''"
        :options="{ interactive: false, pane: 'activeRoutePane' }"
      />

      <!-- Recommended Charging Stops Markers -->
      <l-marker 
        v-for="(stop, index) in recommendedChargingStops" 
        :key="'rec-' + stop.absoluteDistanceKm"
        :lat-lng="[stop.coords[0], stop.coords[1]]"
      >
        <l-icon :icon-url="getRecommendedIcon(stop)" :icon-size="[42, 50]" :icon-anchor="[21, 50]" />
        <l-popup>
          <div class="station-popup">
            <h4 class="station-title">แนะนำสำหรับชาร์จไฟ: {{ stop.name }}</h4>
            <div class="station-details">
              <p><strong>กำลังไฟ:</strong> {{ stop.power }} kW ({{ stop.chargerType }})</p>
              <p><strong>เวลารอชาร์จ:</strong> {{ stop.chargeTimeMins }} นาที</p>
              <p><strong>ระดับแบตเตอรี่เมื่อมาถึง:</strong> <span style="color:#f59e0b; font-weight:bold;">{{ stop.arrivalSoC }}%</span></p>
              <p><strong>ชาร์จพลังงานเพิ่มขึ้นถึง:</strong> <span style="color:#10b981; font-weight:bold;">{{ stop.departureSoC }}%</span></p>
            </div>
          </div>
        </l-popup>
      </l-marker>

      <!-- Route Start, Waypoint, and Destination Markers -->
      <!-- Start Marker: Green circle with checkered flag feel -->
      <l-marker v-if="routeOrigin" :lat-lng="routeOrigin">
        <l-icon
          :icon-url="startMarkerIcon"
          :icon-size="[32, 44]"
          :icon-anchor="[16, 44]"
        />
        <l-popup>
          <div class="route-pin-popup route-pin-popup--start">
            <span class="pin-popup-label">จุดเริ่มต้น (Start)</span>
          </div>
        </l-popup>
      </l-marker>

      <!-- Waypoint Markers: Gradient mid-tone with number badge -->
      <l-marker v-for="(wp, idx) in routeWaypoints" :key="'wp-' + idx" :lat-lng="wp">
        <l-icon
          :icon-url="getWaypointIcon(idx)"
          :icon-size="[32, 44]"
          :icon-anchor="[16, 44]"
        />
        <l-popup>
          <div class="route-pin-popup route-pin-popup--waypoint">
            <span class="pin-popup-label">จุดแวะพักที่ {{ idx + 1 }}</span>
          </div>
        </l-popup>
      </l-marker>

      <!-- Destination Marker: Bold magenta/red flag -->
      <l-marker v-if="routeDestination" :lat-lng="routeDestination">
        <l-icon
          :icon-url="destMarkerIcon"
          :icon-size="[32, 44]"
          :icon-anchor="[16, 44]"
        />
        <l-popup>
          <div class="route-pin-popup route-pin-popup--dest">
            <span class="pin-popup-label">จุดหมายปลายทาง (Destination)</span>
          </div>
        </l-popup>
      </l-marker>

      <!-- Live Pulse / Nav Arrow Marker -->
      <l-marker v-if="currentLivePos" :lat-lng="currentLivePos">
        <l-icon :icon-size="isNavigationMode ? [44, 44] : [20, 20]" :class-name="isNavigationMode ? 'live-nav-icon' : 'live-pulse-icon'" :icon-anchor="isNavigationMode ? [22, 22] : [10, 10]">
          <div v-if="!isNavigationMode" class="pulse-dot"></div>
          <div v-else class="nav-arrow" :style="{ transform: `rotate(${currentHeadingDeg}deg)` }">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <!-- A sharp, Google Maps style 3D navigation arrow -->
              <path d="M12 3 L4 21 L12 17 L20 21 Z" fill="#3b82f6" stroke="#ffffff" stroke-width="2"/>
            </svg>
          </div>
        </l-icon>
      </l-marker>

      <l-marker 
        v-for="station in visibleStations" 
        :key="station.station_id || station.name" 
        :lat-lng="[station.lat, station.lng]"
      >
        <l-icon :icon-url="getStationIcon(station)" :icon-size="[35, 42]" :icon-anchor="[17, 42]" />
        <l-popup :min-width="240">
          <div class="station-popup">
            <h4 class="station-title">{{ station.name }}</h4>
            <!-- Station Type Badge -->
            <div class="station-type-badge" :class="'badge-' + (station.stationType || 'VOLTA').toLowerCase()">
              {{ station.stationType || 'VOLTA' }}
            </div>
            <div class="station-details">
              <p v-if="station.power_kw"><span class="detail-label">กำลังชาร์จ:</span> {{ station.power_kw }} kW ({{ station.chargerType || 'DC' }})</p>
              <p v-if="station.address"><span class="detail-label">ที่อยู่:</span> {{ station.address }}</p>
              <p v-if="station.province"><span class="detail-label">จังหวัด:</span> {{ station.province }}</p>
              <p v-if="station.openingHours"><span class="detail-label">เวลาทำการ:</span> {{ station.openingHours }}</p>
              <p>
                <span class="detail-label">สถานะ:</span>
                <span :class="station.is_available ? 'status-online' : 'status-offline'">
                  {{ station.is_available ? 'เปิดให้บริการปกติ' : 'ปิดให้บริการชั่วคราว' }}
                </span>
              </p>
            </div>
          </div>
        </l-popup>
      </l-marker>
    </l-map>
    
    <!-- Navigation Controls -->
    <div class="nav-controls" v-if="routeGeometry.length > 0">
      <button class="nav-toggle-btn" :class="{ 'nav-active': isNavigationMode }" @click="toggleNavigation">
        {{ isNavigationMode ? 'Stop Navigation' : 'Start Navigation' }}
      </button>
      <button v-if="!isNavigationMode" class="sim-btn" @click="startSimulation" title="Test drive at 60km/h">
        Demo
      </button>
    </div>

    <!-- Rerouting Overlay -->
    <div v-if="isRerouting" class="rerouting-overlay">
      <div class="rerouting-badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 3L9 15M21 3H15m6 0v6"/><path d="M3 21l6-6m6 6H9m6 0v-6"/></svg>
        กำลังคำนวณเส้นทางใหม่…
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from "vue";
import { io } from "socket.io-client";
import "leaflet/dist/leaflet.css";
import { LMap, LTileLayer, LMarker, LPopup, LIcon, LPolyline } from "@vue-leaflet/vue-leaflet";

const zoom = ref(6);
const center = ref([13.736717, 100.523186]);
const stations = ref([]);
const isLoadingStations = ref(true); // Risk 6 Fix: track loading state
const routeGeometry = ref([]);
const recommendedChargingStops = ref([]);

const routeOrigin = ref(null);
const routeDestination = ref(null);
const routeWaypoints = ref([]);
const optionalStops = ref([]);  // Ranking-based recommendations for short trips (no mandatory stops)

const allRouteGeometries = ref([]);
const activeRouteIndex = ref(0);

// ── Map State ───────────────────────────────────────────────────────────────
const activeFilters = ref({
  chargerType: 'all',
  stationTypes: ['hub', 'volta', 'connext'],
  minPower: 0,
  onlyAvailable: false
});

// --- Navigation State ---
const isNavigationMode = ref(false);
const isRerouting = ref(false);   // Shows the "Rerouting…" overlay badge
const isGhostRoute = ref(false);  // Makes the polyline grey during calculation
const currentLivePos = ref(null);
const offRouteTicks = ref(0);
let watchPositionId = null;
const OFF_ROUTE_THRESHOLD_METERS = 40;
let routeOdometerTable = [];
const activeSegmentIndex = ref(0); // For Dynamic Route Trimming

// Computed property for Route Trimming (slices the array based on user progress)
const trimmedRouteGeometry = computed(() => {
  if (routeGeometry.value.length === 0) return [];
  return routeGeometry.value.slice(activeSegmentIndex.value);
});

// --- Simulation State ---
const simState = ref('IDLE');
let simInterval = null;
let simDistanceTravelledMeters = 0;
let nextSimStopIndex = 0;

// Bug 2 Fix: hoisted socket variable so it can be disconnected in onUnmounted
let socket = null;

// ── Branded Marker SVGs ────────────────────────────────────────────────────
// Each marker is an inline SVG data URI — no network round-trip needed.
const startMarkerIcon = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44" width="32" height="44">
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <filter id="sf" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.35)"/>
    </filter>
  </defs>
  <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 28 16 28s16-16 16-28C32 7.163 24.837 0 16 0z" fill="url(#sg)" filter="url(#sf)"/>
  <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
  <path d="M13 16l2.5 2.5L20 13" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
`)}`;

const destMarkerIcon = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44" width="32" height="44">
  <defs>
    <linearGradient id="dg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#b02a8f"/>
      <stop offset="100%" stop-color="#3E1C96"/>
    </linearGradient>
    <filter id="df" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.35)"/>
    </filter>
  </defs>
  <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 28 16 28s16-16 16-28C32 7.163 24.837 0 16 0z" fill="url(#dg)" filter="url(#df)"/>
  <rect x="11" y="9" width="10" height="7" rx="1" fill="white" opacity="0.9"/>
  <line x1="11" y1="9" x2="11" y2="23" stroke="white" stroke-width="2" stroke-linecap="round"/>
</svg>
`)}`;

const getWaypointIcon = (idx) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44" width="32" height="44">
  <defs>
    <linearGradient id="wg${idx}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#b02a8f"/>
    </linearGradient>
    <filter id="wf${idx}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.35)"/>
    </filter>
  </defs>
  <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 28 16 28s16-16 16-28C32 7.163 24.837 0 16 0z" fill="url(#wg${idx})" filter="url(#wf${idx})"/>
  <circle cx="16" cy="16" r="8" fill="white" opacity="0.15"/>
  <text x="16" y="21" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="white" text-anchor="middle">${idx + 1}</text>
</svg>
`)}`;

function buildOdometerTable(geom) {
  routeOdometerTable = [0];
  if (!geom || geom.length === 0) return;
  for (let i = 1; i < geom.length; i++) {
    const distKm = haversineDistMap(geom[i-1], geom[i]);
    routeOdometerTable.push(routeOdometerTable[i-1] + distKm);
  }
}

function haversineDistMap(coords1, coords2) {
  const [lat1, lon1] = coords1;
  const [lat2, lon2] = coords2;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getSnappedCoordinate(pLat, pLng, aLat, aLng, bLat, bLng) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  
  const x = (pLng - aLng) * Math.cos((aLat + pLat) / 2 * rad) * R * rad;
  const y = (pLat - aLat) * R * rad;
  const dx = (bLng - aLng) * Math.cos((aLat + bLat) / 2 * rad) * R * rad;
  const dy = (bLat - aLat) * R * rad;
  const len2 = dx * dx + dy * dy;
  
  if (len2 === 0) return [aLat, aLng];
  
  let t = Math.max(0, Math.min(1, (x * dx + y * dy) / len2));
  const snapLat = aLat + t * (bLat - aLat);
  const snapLng = aLng + t * (bLng - aLng);
  
  return [snapLat, snapLng];
}

function pointToSegmentDistanceMeters(pLat, pLng, aLat, aLng, bLat, bLng) {
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  
  // Local projection relative to point A
  const x = (pLng - aLng) * Math.cos((aLat + pLat) / 2 * rad) * R * rad;
  const y = (pLat - aLat) * R * rad;
  const dx = (bLng - aLng) * Math.cos((aLat + bLat) / 2 * rad) * R * rad;
  const dy = (bLat - aLat) * R * rad;
  const len2 = dx * dx + dy * dy;
  
  if (len2 === 0) return Math.sqrt(x * x + y * y); // A and B are identical
  
  let t = Math.max(0, Math.min(1, (x * dx + y * dy) / len2));
  const projX = t * dx;
  const projY = t * dy;
  
  return Math.sqrt((x - projX)**2 + (y - projY)**2);
}

const checkOffRouteDeviation = (livePos) => {
  if (!routeGeometry.value || routeGeometry.value.length < 2) return null;
  
  let minPerpDist = Infinity;
  let closestSegmentIndex = 0;
  let bestSnappedPos = livePos;
  
  for (let i = 0; i < routeGeometry.value.length - 1; i++) {
    const A = routeGeometry.value[i];
    const B = routeGeometry.value[i+1];
    const distMeters = pointToSegmentDistanceMeters(
      livePos[0], livePos[1], A[0], A[1], B[0], B[1]
    );
    if (distMeters < minPerpDist) {
      minPerpDist = distMeters;
      closestSegmentIndex = i;
      bestSnappedPos = getSnappedCoordinate(livePos[0], livePos[1], A[0], A[1], B[0], B[1]);
    }
  }

  const currentLiveOdometerKm = routeOdometerTable[closestSegmentIndex];

  window.dispatchEvent(new CustomEvent('nav-odometer-heartbeat', {
    detail: { odometerKm: currentLiveOdometerKm }
  }));

  if (minPerpDist > OFF_ROUTE_THRESHOLD_METERS) {
    offRouteTicks.value++;
    if (offRouteTicks.value > 3) {
      window.dispatchEvent(new CustomEvent('off-route-deviation', {
        detail: { currentPos: livePos, odometerKm: currentLiveOdometerKm }
      }));
      offRouteTicks.value = 0; 
    }
  } else {
    offRouteTicks.value = 0; 
  }
  
  return { closestSegmentIndex, bestSnappedPos };
};

// --- Bearing Calculation Math ---
function calculateBearing(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
            Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ── Navigation Engine (Faux-3D) ──────────────────────────────────────────────
// Fix: Instead of rotating the map wrapper (which breaks tiles), we keep the map
// North-Up. We rotate the navigation arrow marker itself, and use Leaflet's
// standard panTo, combined with a pixel offset, to keep the user in the lower
// third of the screen, creating a pseudo-3D "look ahead" navigation feel.
const currentHeadingDeg = ref(0);
let mapInstance = null;

const handlePositionUpdate = (pos) => {
  const rawLivePos = [pos.coords.latitude, pos.coords.longitude];

  // 1. Snap-to-Route and Deviation Check
  const routeCheck = checkOffRouteDeviation(rawLivePos);
  const closestSegmentIndex = routeCheck ? routeCheck.closestSegmentIndex : 0;
  const snappedPos = routeCheck ? routeCheck.bestSnappedPos : rawLivePos;
  
  // Snap the visual marker precisely to the road spline
  currentLivePos.value = snappedPos;
  
  // 2. Dynamic Route Trimming
  // Update the reactive segment index so the polyline gets sliced correctly
  activeSegmentIndex.value = closestSegmentIndex;

  // Determine heading: prefer GPS hardware heading; fall back to route-vector bearing
  const heading = pos.coords.heading;
  let bearing = currentHeadingDeg.value; // retain last known bearing if stationary

  if (heading !== null && !isNaN(heading)) {
    bearing = heading;
  } else if (routeGeometry.value && routeGeometry.value.length > closestSegmentIndex + 1) {
    const nextNode = routeGeometry.value[closestSegmentIndex + 1];
    bearing = calculateBearing(snappedPos[0], snappedPos[1], nextNode[0], nextNode[1]);
  }
  
  currentHeadingDeg.value = bearing;

  if (isNavigationMode.value && mapInstance) {
    // Off-center panning: Place the user marker in the bottom 30% of the screen.
    const zoomLvl = 16;
    const projectedPoint = mapInstance.project(snappedPos, zoomLvl);
    const mapHeight = mapInstance.getSize().y;
    const targetPoint = projectedPoint.subtract([0, mapHeight * 0.25]);
    const targetLatLng = mapInstance.unproject(targetPoint, zoomLvl);
    
    mapInstance.panTo(targetLatLng, { animate: true, duration: 0.8 });
  }
};

const startTracking = () => {
  if (!navigator.geolocation) {
    console.warn('[Nav Engine] Geolocation API not available.');
    return;
  }
  activeSegmentIndex.value = 0;
  watchPositionId = navigator.geolocation.watchPosition(
    handlePositionUpdate,
    (err) => console.error('[Nav Engine] GPS Lock Failed:', err),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
};

const stopTracking = () => {
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  simState.value = 'IDLE';
  offRouteTicks.value = 0;
  currentLivePos.value = null;
  currentHeadingDeg.value = 0;
  activeSegmentIndex.value = 0;
  
  // Re-expand map viewport after exiting navigation zoom
  if (mapInstance && routeGeometry.value.length > 0) {
    setTimeout(() => {
      mapInstance.invalidateSize();
      mapInstance.fitBounds(routeGeometry.value, { padding: [50, 50] });
    }, 500);
  }
};

watch(isNavigationMode, (newVal) => {
  window.dispatchEvent(new CustomEvent('nav-state-changed', { detail: { active: newVal } }));
});

const toggleNavigation = () => {
  if (simInterval) {
    isNavigationMode.value = false;
    stopTracking();
    return;
  }
  isNavigationMode.value = !isNavigationMode.value;
  if (isNavigationMode.value) startTracking();
  else stopTracking();
};

let simChargingTicks = 0;

const startSimulation = () => {
  if (routeGeometry.value.length === 0) return;
  isNavigationMode.value = true;
  activeSegmentIndex.value = 0;
  simDistanceTravelledMeters = 0;
  nextSimStopIndex = 0;
  simState.value = 'DRIVING';
  
  const totalRouteMeters = routeOdometerTable[routeOdometerTable.length - 1] * 1000;
  const SIM_SPEED_KMH = 3000; // Warp speed for 10-second demo rule
  const TICK_MS = 250; // Update 4 times per second for smooth panning
  const metersPerTick = (SIM_SPEED_KMH * 1000 / 3600) * (TICK_MS / 1000);
  
  simInterval = setInterval(() => {
    if (simState.value === 'CHARGING') {
      simChargingTicks++;
      if (simChargingTicks >= 4) { // 1 second total (4 * 250ms)
        simState.value = 'DRIVING';
        nextSimStopIndex++;
      }
      return;
    }

    if (simState.value === 'DRIVING') {
      simDistanceTravelledMeters += metersPerTick;
      
      // Check if we hit a charging stop
      if (nextSimStopIndex < recommendedChargingStops.value.length) {
        const nextStopDistMeters = recommendedChargingStops.value[nextSimStopIndex].absoluteDistanceKm * 1000;
        if (simDistanceTravelledMeters >= nextStopDistMeters) {
          simDistanceTravelledMeters = nextStopDistMeters; // Snap to station
          simState.value = 'CHARGING';
          simChargingTicks = 0;
        }
      }

      if (simDistanceTravelledMeters >= totalRouteMeters) {
        simState.value = 'ARRIVED';
        clearInterval(simInterval);
        simInterval = null;
        toggleNavigation();
        return;
      }
      
      // Find where the simulated car is linearly along the odometer table
      let simIdx = 0;
      while (simIdx < routeOdometerTable.length - 1 && (routeOdometerTable[simIdx+1]*1000) < simDistanceTravelledMeters) {
        simIdx++;
      }
      
      const segmentStartDist = routeOdometerTable[simIdx] * 1000;
      const segmentEndDist = routeOdometerTable[simIdx+1] * 1000;
      const segmentLength = segmentEndDist - segmentStartDist;
      const t = segmentLength > 0 ? (simDistanceTravelledMeters - segmentStartDist) / segmentLength : 0;
      
      const A = routeGeometry.value[simIdx];
      const B = routeGeometry.value[simIdx+1];
      const lat = A[0] + t * (B[0] - A[0]);
      const lng = A[1] + t * (B[1] - A[1]);
      
      // Feed the interpolated position into the exact same handler used by real GPS
      handlePositionUpdate({
        coords: {
          latitude: lat,
          longitude: lng,
          heading: null
        }
      });
    }
  }, TICK_MS);
};

// สร้างฟังก์ชันแยกสำหรับการดึงข้อมูล เพื่อให้เรียกซ้ำได้เวลาที่มีการอัปเดต
const loadStations = async () => {
  try {
    const res = await fetch("https://ev-project-5fm2.onrender.com/stations");
    const data = await res.json();
    stations.value = data.stations || data;
  } catch (e) {
    console.error("Failed to fetch stations:", e);
  } finally {
    isLoadingStations.value = false; // Risk 6 Fix: always clear loading flag
  }
};

// ── Map Polyline Click ──────────────────────────────────────────────────────────────────
// When the user clicks a gray unselected polyline on the map, dispatch a
// window event that SidebarControl.vue listens for and calls selectRoute(index).
const onAltPolylineClick = (index) => {
  window.dispatchEvent(new CustomEvent('map-route-select', { detail: { index } }));
};

onMounted(async () => {
  window.addEventListener('trigger-route-calculation', calculateRoute);
  window.addEventListener('route-calculation-started', handleRouteCalculationStarted);
  window.addEventListener('focus-map-marker', focusMapMarker);
  window.addEventListener('update-map-filters', handleFilterUpdate);
  window.addEventListener('clear-route', handleClearRoute);

  // 1. โหลดข้อมูลสถานีตอนเปิดเว็บครั้งแรก
  await loadStations();

  // Bug 2 Fix: store socket reference so it can be disconnected in onUnmounted
  socket = io("https://ev-project-5fm2.onrender.com");
  socket.on("stations-updated", async () => {
    await loadStations();
  });
});

onUnmounted(() => {
  window.removeEventListener('trigger-route-calculation', calculateRoute);
  window.removeEventListener('route-calculation-started', handleRouteCalculationStarted);
  window.removeEventListener('focus-map-marker', focusMapMarker);
  window.removeEventListener('update-map-filters', handleFilterUpdate);
  window.removeEventListener('clear-route', handleClearRoute);
  // Bug 2 Fix: properly disconnect the socket to prevent memory leak
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  // Risk 5 Fix: clear simulation interval if component unmounts mid-simulation
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  // Bug 3 Fix: removed orphaned handleSimChargeComplete removeEventListener
  // (that handler was deleted in a prior refactor and no longer exists)
});

const onMapReady = (map) => {
  mapInstance = map;
  // Create isolated SVG panes so gray alternatives and purple active route
  // never share the same Leaflet rendering layer, eliminating stray connector lines
  // on routes that share coordinate nodes (e.g. common origin/destination).
  const altPane = map.createPane('altRoutesPane');
  altPane.style.zIndex = 350;
  altPane.style.pointerEvents = 'auto';
  const activePane = map.createPane('activeRoutePane');
  activePane.style.zIndex = 400;
  activePane.style.pointerEvents = 'none'; // clicks pass through to gray pane below

  // Defensive ResizeObserver to fix Leaflet gray tiles on layout shift or
  // parent container resize events (e.g. sidebar collapse, window resize).
  const observer = new ResizeObserver(() => {
    if (mapInstance) mapInstance.invalidateSize(true);
  });
  observer.observe(map._container);

  // Also invalidate once on ready in case the map container was already sized
  // before Leaflet finished its own init cycle.
  setTimeout(() => map.invalidateSize(), 50);
};

// แปลงพิกัด GeoJSON [Lng, Lat] เป็น [Lat, Lng]
const validStations = computed(() => {
  return stations.value
    .map(s => {
      let lat = null;
      let lng = null;
      if (s.location && s.location.coordinates) {
        lng = parseFloat(s.location.coordinates[0]);
        lat = parseFloat(s.location.coordinates[1]);
      }
      return { ...s, lat, lng };
    })
    .filter(s => s.lat !== null && s.lng !== null && !isNaN(s.lat) && !isNaN(s.lng));
});

function dedupeLatLngs(latLngs, thresholdDeg = 0.00005) {
  if (!latLngs || latLngs.length === 0) return latLngs;
  const result = [latLngs[0]];
  for (let i = 1; i < latLngs.length; i++) {
    const prev = result[result.length - 1];
    const curr = latLngs[i];
    if (Math.abs(curr[0] - prev[0]) > thresholdDeg ||
        Math.abs(curr[1] - prev[1]) > thresholdDeg) {
      result.push(curr);
    }
  }
  return result;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isStationNearAnyStop(stationLat, stationLng, stops, radiusKm = 15.0) {
  for (const stop of stops) {
    if (stop.coords && stop.coords.length === 2) {
      const dist = haversineDistance(stationLat, stationLng, stop.coords[0], stop.coords[1]);
      if (dist <= radiusKm) return true;
    }
  }
  return false;
}

const visibleStations = computed(() => {
  const isRouteActive = routeOrigin.value !== null;
  const stops = recommendedChargingStops.value;
  const optional = optionalStops.value;
  const { chargerType, stationTypes, minPower, onlyAvailable } = activeFilters.value;

  // Build Sets for O(1) name lookups
  const recommendedStopNames = new Set(stops.map(s => s.name));
  const optionalStopNames = new Set(optional.map(s => s.name));

  return validStations.value.filter(station => {
    // ─── Explore Mode Filters (always applied) ────────────────────────────────
    if (onlyAvailable && !station.is_available) return false;

    // ใช้ power_kw จาก DB โดยตรง (แทน power เดิมที่ไม่ถูกต้อง)
    const power = parseInt(station.power_kw) || 0;
    
    // Charger Type logic (Strictly based on explicit strings, no power heuristics)
    const chargerTypeStr = (station.chargerType || '').toUpperCase();
    if (chargerType === 'dc') {
      const isDC = chargerTypeStr.includes('DC') || chargerTypeStr.includes('CCS') || chargerTypeStr.includes('CHADEMO');
      if (!isDC) return false;
    }
    if (chargerType === 'ac') {
      const isAC = chargerTypeStr.includes('AC') || chargerTypeStr.includes('TYPE 2') || chargerTypeStr.includes('TYPE2');
      if (!isAC) return false;
    }

    if (power < minPower) return false;

    // ใช้ stationType จาก DB โดยตรง — ไม่ต้อง infer จากชื่ออีกต่อไป
    const stationType = (station.stationType || 'VOLTA').toLowerCase();
    if (!stationTypes.includes(stationType)) return false;

    // ─── Route Mode (extra filtering when a route is active) ──────────────────
    if (isRouteActive) {
      // Deduplication: never render a station that is already drawn as a primary stop
      if (recommendedStopNames.has(station.name)) return false;

      if (stops.length > 0) {
        // LONG TRIP: Show alternatives within 15km of any recommended charging stop
        if (!isStationNearAnyStop(station.lat, station.lng, stops)) return false;
      } else {
        // SHORT TRIP: No mandatory stops — show only the backend-ranked optional stations
        if (!optionalStopNames.has(station.name)) return false;
      }
    }

    return true;
  });
});

// ── Map Marker Icons (uses authoritative stationType + power_kw from DB) ───────
const getStationIcon = (station) => {
  const type = (station.stationType || 'VOLTA').toUpperCase();
  const power = parseInt(station.power_kw) || 50;

  if (type === 'HUB')     return '/pea-hub.png';
  if (type === 'CONNEXT') return '/pea-connext.png';

  // VOLTA — differentiate by charging speed
  if (power >= 300) return '/pea-300.png';
  if (power >= 120) return '/pea-120.png';
  if (power >= 50)  return '/pea-50.png';
  return '/pea-25.png';
};

// ── Popup Banner Images (full-width image inside the glassmorphism popup) ──────

const getRecommendedIcon = (stop) => {
  const type = (stop.stationType || '').toUpperCase();
  const power = parseInt(stop.power_kw || stop.power) || 50;
  if (type === 'HUB')     return '/pea-hub.png';
  if (type === 'CONNEXT') return '/pea-connext.png';
  if (power >= 300) return '/pea-300.png';
  if (power >= 120) return '/pea-120.png';
  return '/pea-50.png';
};

// ย้ายจุดโฟกัสไปที่พิกัดที่ระบุและซูมเข้าไปใกล้
const focusMapMarker = (event) => {
  const { coords } = event.detail;
  if (mapInstance && coords) {
    center.value = coords;
    zoom.value = 14;
  }
};

// คำนวณเส้นทางร่วมกับข้อมูลพิกัดจากกล่องควบคุม
const handleRouteCalculationStarted = () => {
  if (routeGeometry.value && routeGeometry.value.length > 0) {
    isGhostRoute.value = true;
  }
};

const calculateRoute = async (event) => {
  const { origin, destination, waypoints, geometry, chargingStops } = event.detail;

  // FIX (Phase 1 — routeOrigin guard):
  // routeOrigin, routeDestination, and routeWaypoints are ONLY set when geometry
  // is confirmed present from the backend. Previously these were assigned
  // unconditionally, meaning a backend failure would set routeOrigin to a non-null
  // value, causing visibleStations to return [] and hiding all 451 markers even
  // though no route was ever drawn.
  if (geometry) {
    // จัดเก็บจุดต้นทาง ปลายทาง และจุดแวะพักเฉพาะเมื่อได้รับ geometry ที่ถูกต้องจาก backend
    routeOrigin.value = origin;
    routeDestination.value = destination;
    routeWaypoints.value = waypoints || [];

    routeGeometry.value = dedupeLatLngs(geometry.coordinates.map(coord => [coord[1], coord[0]]));
    isGhostRoute.value = false;
    recommendedChargingStops.value = chargingStops || [];
    optionalStops.value = event.detail.optionalStops || [];
    
    // Create the odometer lookup table for this new route geometry
    buildOdometerTable(routeGeometry.value);
    
    // Store all geometries for alternative routes — deduplicated to remove OSRM artifacts
    if (event.detail.allRoutes) {
      allRouteGeometries.value = event.detail.allRoutes.map(r => 
        dedupeLatLngs(r.geometry.coordinates.map(coord => [coord[1], coord[0]]))
      );
      activeRouteIndex.value = event.detail.selectedIndex !== undefined ? event.detail.selectedIndex : 0;
    } else {
      allRouteGeometries.value = [];
      activeRouteIndex.value = 0;
    }

    // Fit Bounds เพื่อเล็งกล้องให้คลุมทั้งเส้นทาง
    if (mapInstance && routeGeometry.value.length > 0) {
      setTimeout(() => {
        mapInstance.invalidateSize();
        mapInstance.fitBounds(routeGeometry.value, { padding: [50, 50] });
      }, 100);
    }
    return;
  }

  // FIX (Phase 1): Removed rogue frontend OSRM fallback.
  // Previously, if the backend did not return geometry, this block would silently call
  // router.project-osrm.org directly — bypassing all EV battery logic and charging stop
  // planning. The user would see a route drawn on the map with zero charging stations,
  // with no indication that EV logic had been bypassed.
  //
  // The backend (/api/route-plan) is now the SINGLE SOURCE OF TRUTH for routing.
  // If it fails to return a geometry, it is a backend error that should be surfaced to the user.
  // Map state is intentionally left unchanged — all markers remain visible.
  console.warn('[MapArea] calculateRoute received no geometry from backend. Route was not drawn. Check /api/route-plan response.');
};
// รับสัญญาณจาก SidebarControl เพื่ออัปเดตตัวกรองหมุด
const handleFilterUpdate = (event) => {
  activeFilters.value = { ...event.detail };
};

// รีเซ็ตเส้นทางทั้งหมดและกลับไปแสดงหมุดบนแผนที่ตามปกติ
const handleClearRoute = () => {
  routeGeometry.value = [];
  allRouteGeometries.value = [];
  activeRouteIndex.value = 0;
  recommendedChargingStops.value = [];
  optionalStops.value = [];
  routeOrigin.value = null;
  routeDestination.value = null;
  routeWaypoints.value = [];
};
</script>

<style scoped>
:deep(.leaflet-tile-pane) {
  filter: grayscale(15%) contrast(1.05);
}

/* ── Stations Loading & Error Overlays ─────────────────────────────────── */
.stations-loading-overlay,
.stations-error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(4px);
  z-index: 9000;
  gap: 16px;
  font-family: 'Kanit', sans-serif;
  font-size: 15px;
  color: #4b5563;
}
.stations-error-overlay p {
  color: #991b1b;
  font-weight: 600;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e5e7eb;
  border-top-color: #3E1C96;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.map-wrapper {
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* ── Route Pin Popups ──────────────────────────────────────────────────── */
.route-pin-popup {
  font-family: 'Kanit', sans-serif;
  padding: 8px 14px;
  border-radius: 8px;
  text-align: center;
  white-space: nowrap;
}
.route-pin-popup--start  { background: linear-gradient(135deg, #d1fae5, #a7f3d0); border: 1.5px solid #34d399; }
.route-pin-popup--dest   { background: linear-gradient(135deg, #ede9fe, #ddd6fe); border: 1.5px solid #7c3aed; }
.route-pin-popup--waypoint { background: linear-gradient(135deg, #f3e8ff, #e9d5ff); border: 1.5px solid #a855f7; }
.pin-popup-label {
  font-size: 13px;
  font-weight: 700;
  color: #1f2937;
}

/* ── Station Popups ────────────────────────────────────────────────────── */
.station-popup {
  font-family: 'Kanit', sans-serif;
  min-width: 240px;
  max-width: 300px;
  padding: 8px;
  text-align: center;
}
.station-title {
  margin: 0 0 10px 0;
  font-size: 15px;
  font-weight: 700;
  color: #3E1C96;
  border-bottom: 1px solid #eaeaea;
  padding-bottom: 8px;
  line-height: 1.4;
}
.station-type-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 4px 12px;
  border-radius: 999px;
  margin-bottom: 12px;
  text-transform: uppercase;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.badge-hub     { background: #7b1fa2; color: #fff; }
.badge-connext { background: #1565c0; color: #fff; }
.badge-volta   { background: #2e7d32; color: #fff; }
.station-details {
  font-size: 13px;
  color: #444;
  line-height: 1.8;
  text-align: left;
  padding: 0 4px;
}
.station-details p { margin: 5px 0; }
.detail-label  { font-weight: 600; color: #555; margin-right: 4px; }
.status-online  { color: #2e7d32; font-weight: bold; }
.status-offline { color: #c62828; font-weight: bold; }

/* ── Navigation Button ─────────────────────────────────────────────────── */
.nav-controls {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  gap: 12px;
}
.nav-toggle-btn {
  background: linear-gradient(135deg, #3E1C96, #6938EF);
  color: white;
  border: none;
  border-radius: 99px;
  padding: 12px 28px;
  font-size: 15px;
  font-weight: 700;
  box-shadow: 0 4px 18px rgba(62,28,150,0.4);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
  letter-spacing: 0.3px;
}
.nav-toggle-btn:hover {
  background: linear-gradient(135deg, #4c24b5, #7b46ff);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(62,28,150,0.5);
}
.nav-toggle-btn.nav-active {
  background: linear-gradient(135deg, #991b1b, #dc2626);
  box-shadow: 0 4px 18px rgba(220,38,38,0.4);
}
.nav-toggle-btn.nav-active:hover {
  background: linear-gradient(135deg, #b91c1c, #ef4444);
  box-shadow: 0 8px 24px rgba(220,38,38,0.5);
}
.sim-btn {
  background: #111827;
  color: white;
  border: none;
  border-radius: 99px;
  padding: 12px 20px;
  font-size: 15px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: all 0.25s ease;
}
.sim-btn:hover {
  background: #1f2937;
  transform: translateY(-2px);
}

/* ── Rerouting Overlay Badge ───────────────────────────────────────────── */
.rerouting-overlay {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1001;
  pointer-events: none;
}
.rerouting-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(30, 10, 80, 0.92);
  backdrop-filter: blur(8px);
  color: white;
  font-family: 'Kanit', sans-serif;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: 99px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  animation: rerouteFlash 1s ease-in-out infinite alternate;
}
@keyframes rerouteFlash {
  from { opacity: 0.8; }
  to   { opacity: 1; }
}

/* ── Live GPS Pulse Dot & Nav Arrow ────────────────────────────────────────── */
:deep(.live-pulse-icon) { background: none; border: none; }
:deep(.live-nav-icon) { background: none; border: none; overflow: visible; }

:deep(.pulse-dot) {
  width: 20px;
  height: 20px;
  background-color: #3b82f6;
  border-radius: 50%;
  border: 3px solid white;
  box-shadow: 0 0 0 rgba(59, 130, 246, 0.4);
  animation: pulse 1.5s infinite;
}
:deep(.nav-arrow) {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1);
  filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.3));
}
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
  70%  { box-shadow: 0 0 0 15px rgba(59, 130, 246, 0); }
  100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
}
</style>