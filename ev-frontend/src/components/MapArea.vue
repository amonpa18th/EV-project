<template>
  <div class="map-wrapper">
    <l-map 
      v-if="validStations.length > 0" 
      v-model:zoom="zoom" 
      v-model:center="center" 
      style="height: 100%" 
      @ready="onMapReady"
    >
      <l-tile-layer 
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
        attribution="&copy; OpenStreetMap contributors" 
      />

      <l-polyline 
        v-if="routeGeometry.length > 0" 
        :lat-lngs="routeGeometry" 
        color="#6a1b9a" 
        :weight="6" 
      />

      <l-marker 
        v-for="station in validStations" 
        :key="station.name" 
        :lat-lng="[station.lat, station.lng]"
      >
        <l-icon :icon-url="getStationIcon(station)" :icon-size="[35, 42]" :icon-anchor="[17, 42]" />
        <l-popup>
          <div class="station-popup">
            <h4 class="station-title">{{ station.name }}</h4>
            <div class="station-details">
              <p v-if="station.power">กำลังไฟ: {{ station.power }} kW</p>
              <p v-if="station.province">จังหวัด: {{ station.province }}</p>
              <p v-if="station.address">ที่อยู่: {{ station.address }}</p>
              <p v-if="station.openingHours">เวลาทำการ: {{ station.openingHours }}</p>
              <p v-if="station.chargerType">ประเภทหัวชาร์จ: {{ station.chargerType }}</p>
              <p>
                สถานะสถานี: 
                <span :class="station.is_available ? 'status-online' : 'status-offline'">
                  {{ station.is_available ? 'เปิดให้บริการปกติ' : 'ปิดให้บริการชั่วคราว' }}
                </span>
              </p>
              <p v-if="station.source"><small>แหล่งข้อมูล: {{ station.source }}</small></p>
            </div>
          </div>
        </l-popup>
      </l-marker>
    </l-map>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import "leaflet/dist/leaflet.css";
import { LMap, LTileLayer, LMarker, LPopup, LIcon, LPolyline } from "@vue-leaflet/vue-leaflet";

const zoom = ref(6);
const center = ref([13.736717, 100.523186]);
const stations = ref([]);
const routeGeometry = ref([]);
let mapInstance = null;

const onMapReady = (map) => {
  mapInstance = map;
};

// แปลงพิกัด GeoJSON [Lng, Lat] จากตำแหน่ง location.coordinates ของ stations.json เป็น [Lat, Lng]
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

// ตรรกะการเลือกไอคอนสถานีตามเงื่อนไขที่กำหนด
const getStationIcon = (station) => {
  const name = station.name || "";
  const upperName = name.toUpperCase();
  const power = parseInt(station.power) || 50;

  // 1. ตรวจสอบเงื่อนไขสถานี HUB (มีคำว่า HUB อยู่ในชื่อ)
  if (upperName.includes("HUB")) {
    return "/pea-hub.png";
  }

  // 2. ตรวจสอบเงื่อนไขสถานี CONNEXT (กรณีไม่มีคำว่า PEA VOLTA อยู่ในชื่อ)
  if (!upperName.includes("PEA VOLTA")) {
    return "/pea-connext.png";
  }

  // 3. สถานี PEA VOLTA ทั่วไป คัดแยกตามขนาดวัตต์ (kW) เริ่มเช็กจากกำลังไฟสูงลงไปต่ำ
  if (power >= 300) {
    return "/pea-300.png";
  } else if (power >= 120) {
    return "/pea-120.png";
  } else if (power >= 50) {
    return "/pea-50.png";
  } else if (power <= 25) {
    return "/pea-25.png";
  }

  return "/pea-50.png";
};

// คำนวณเส้นทางร่วมกับข้อมูลพิกัดจากกล่องควบคุม
const calculateRoute = async (event) => {
  const { origin, destination, waypoints } = event.detail;
  
  let coordinateString = `${origin[1]},${origin[0]}`;
  if (waypoints && waypoints.length > 0) {
    waypoints.forEach(wp => {
      coordinateString += `;${wp[1]},${wp[0]}`;
    });
  }
  coordinateString += `;${destination[1]},${destination[0]}`;

  try {
    const res = await fetch("https://router.project-osrm.org/route/v1/driving/" + coordinateString + "?overview=full&geometries=geojson");
    const data = await res.json();
    
    if (data.routes && data.routes.length > 0) {
      routeGeometry.value = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
      if (mapInstance && routeGeometry.value.length > 0) {
        mapInstance.fitBounds(routeGeometry.value);
      }
    }
  } catch (err) {
    console.error("OSRM Routing Error:", err);
  }
};

onMounted(async () => {
  window.addEventListener('trigger-route-calculation', calculateRoute);

  try {
    const res = await fetch("http://localhost:3000/stations");
    const data = await res.json();
    stations.value = data.stations || data;
  } catch (e) {
    console.error("Failed to fetch stations:", e);
  }
});
</script>

<style scoped>
.map-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
}
.station-popup {
  font-family: Arial, sans-serif;
  min-width: 250px;
  max-width: 320px;
  padding: 4px;
}
.station-title {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: bold;
  color: #6a1b9a;
  border-bottom: 1px solid #ddd;
  padding-bottom: 6px;
  line-height: 1.4;
}
.station-details {
  font-size: 12px;
  color: #333;
  line-height: 1.6;
}
.station-details p {
  margin: 5px 0;
}
.status-online {
  color: #2e7d32;
  font-weight: bold;
}
.status-offline {
  color: #c62828;
  font-weight: bold;
}
</style>