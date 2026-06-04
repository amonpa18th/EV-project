<template>
  <div class="sidebar-control-panel">
    <div class="sidebar-brand-header">
      <h2>EV Route Planner</h2>
      <p>ระบบวางแผนเส้นทางและจุดแวะชาร์จ PEA VOLTA</p>
    </div>

    <div class="sidebar-scroll-content">
      <div class="ui-card">
        <label class="ui-label">🚗 รถยนต์ไฟฟ้าของคุณ</label>
        <select v-model="selectedCar" class="ui-input-field" @change="updateCarSpec">
          <option value="byd-atto3">BYD Atto 3 (Extended Range)</option>
          <option value="tesla-m3">Tesla Model 3 Long Range</option>
          <option value="neta-v">Neta V (38.5 kWh)</option>
        </select>

        <div class="battery-control-box">
          <div class="battery-text-info">
            <span>🔋 แบตเตอรี่เมื่อออกเดินทาง (SoC):</span>
            <strong>{{ batterySOC }}%</strong>
          </div>
          <input type="range" min="20" max="100" v-model="batterySOC" class="battery-range-slider" />
        </div>
      </div>

      <div class="ui-card">
        <label class="ui-label">📍 ค้นหาพิกัดเดินทาง (ไทย - English)</label>
        
        <div class="input-row">
          <span class="route-badge badge-start">เริ่ม</span>
          <div class="search-wrapper">
            <input 
              type="text" 
              v-model="routeData.originName" 
              @input="searchLocation('origin', routeData.originName)"
              placeholder="ค้นหาจุดเริ่มต้น (ภาษาไทย หรือ English)..." 
              class="ui-input-field padding-right-btn" 
            />
            <button class="btn-inside-my-position" @click="useCurrentLocation">🎯</button>
            <div v-if="activeSearchField === 'origin' && suggestions.length > 0" class="search-suggestions-box">
              <div v-for="(item, idx) in suggestions" :key="idx" @click="selectLocation('origin', item)" class="suggestion-item">
                📌 {{ item.display_name }}
              </div>
            </div>
          </div>
        </div>

        <div class="input-row">
          <span class="route-badge badge-end">ปลาย</span>
          <div class="search-wrapper">
            <input 
              type="text" 
              v-model="routeData.destinationName" 
              @input="searchLocation('destination', routeData.destinationName)"
              placeholder="ค้นหาจุดหมายปลายทาง..." 
              class="ui-input-field" 
            />
            <div v-if="activeSearchField === 'destination' && suggestions.length > 0" class="search-suggestions-box">
              <div v-for="(item, dIdx) in suggestions" :key="dIdx" @click="selectLocation('destination', item)" class="suggestion-item">
                📌 {{ item.display_name }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="tripSummary" class="ui-card summary-card animation-fade">
        <h4 class="summary-title">📋 แผนการเดินทาง (Trip Summary)</h4>
        <div class="summary-item">🏁 ระยะทางรวม: <b>{{ tripSummary.totalDistance }} กม.</b></div>
        <div class="summary-item">⏱️ เวลาเดินทาง: <b>{{ tripSummary.totalDuration }} นาที</b></div>
        <div class="summary-item" :class="{'text-danger': tripSummary.chargeStationsRequired > 0}">
          🔌 ต้องแวะชาร์จไฟ: <b>{{ tripSummary.chargeStationsRequired }} ครั้ง</b>
        </div>
        <div v-if="tripSummary.stopOverDetails.length > 0" class="stopover-list">
          <div v-for="(stop, sIdx) in tripSummary.stopOverDetails" :key="sIdx" class="stop-node">
            ⚡ แวะชาร์จที่: <b>{{ stop.name }}</b> (กำลังไฟ {{ stop.power }} kW)
          </div>
        </div>
      </div>

      <div style="margin-top: auto; padding-top: 10px;">
        <button class="btn-trigger-plan" @click="emitCalculateRoute">
          ⚡ วางแผนการเดินทาง (Plan Trip)
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const selectedCar = ref('byd-atto3');
const batterySOC = ref(100);
const activeSearchField = ref(null);
const suggestions = ref([]);
const tripSummary = ref(null);

const carSpecs = {
  'byd-atto3': { battery: 60.48, range: 420 },
  'tesla-m3': { battery: 75.0, range: 560 },
  'neta-v': { battery: 38.5, range: 384 }
};

const currentSpec = ref(carSpecs['byd-atto3']);
const routeData = ref({ originName: '', originCoords: null, destinationName: '', destinationCoords: null });

const useCurrentLocation = () => {
  if (!navigator.geolocation) return;
  routeData.value.originName = "กำลังระบุตำแหน่ง...";
  navigator.geolocation.getCurrentPosition((pos) => {
    routeData.value.originName = "📍 ตำแหน่งปัจจุบันของคุณ (My Position)";
    routeData.value.originCoords = [pos.coords.latitude, pos.coords.longitude];
  });
};

// 🔍 ระบบค้นหาอัจฉริยะ Nominatim ดึงฐานข้อมูลตรงไทย/อังกฤษ เจาะลึกระดับอำเภอ ตำบล ซอย
const searchLocation = async (field, query) => {
  if (!query || query.length < 3) return;
  activeSearchField.value = field;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=th&addressdetails=1&accept-language=th,en&limit=8`);
    const data = await res.json();
    suggestions.value = data;
  } catch (err) { console.error(err); }
};

const selectLocation = (field, item) => {
  suggestions.value = [];
  activeSearchField.value = null;
  if (field === 'origin') {
    routeData.value.originName = item.display_name;
    routeData.value.originCoords = [parseFloat(item.lat), parseFloat(item.lon)];
  } else {
    routeData.value.destinationName = item.display_name;
    routeData.value.destinationCoords = [parseFloat(item.lat), parseFloat(item.lon)];
  }
};

const emitCalculateRoute = () => {
  if (!routeData.value.originCoords || !routeData.value.destinationCoords) return;
  window.dispatchEvent(new CustomEvent('trigger-route-calculation', {
    detail: {
      origin: routeData.value.originCoords,
      destination: routeData.value.destinationCoords,
      carCapacity: currentSpec.value.battery,
      carRange: currentSpec.value.range,
      startSoc: batterySOC.value
    }
  }));
};

onMounted(() => {
  window.addEventListener('update-trip-summary', (e) => {
    tripSummary.value = e.detail;
  });
});
</script>

<style scoped>
.sidebar-control-panel { width: 390px; min-width: 350px; background-color: #f8f9fa; display: flex; flex-direction: column; height: 100vh; font-family: sans-serif; box-shadow: 4px 0 15px rgba(0,0,0,0.1); }
.sidebar-brand-header { padding: 20px; background-color: #4a148c; color: white; text-align: center; }
.sidebar-brand-header h2 { margin: 0; font-size: 20px; }
.sidebar-brand-header p { margin: 5px 0 0 0; font-size: 11px; opacity: 0.8; }
.sidebar-scroll-content { padding: 16px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.ui-card { background: white; border-radius: 12px; padding: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
.ui-label { font-weight: bold; font-size: 12px; color: #4a148c; margin-bottom: 8px; display: block; }
.ui-input-field { width: 100%; padding: 10px; border: 1px solid #ced4da; border-radius: 8px; font-size: 13px; outline: none; }
.padding-right-btn { padding-right: 35px; }
.btn-inside-my-position { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; }
.input-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; position: relative; }
.route-badge { font-size: 11px; font-weight: bold; color: white; padding: 4px 6px; border-radius: 4px; width: 35px; text-align: center; }
.badge-start { background-color: #0d6efd; }
.badge-end { background-color: #198754; }
.search-wrapper { flex: 1; position: relative; }
.search-suggestions-box { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; border-radius: 8px; max-height: 180px; overflow-y: auto; z-index: 9999; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
.suggestion-item { padding: 8px; font-size: 11px; cursor: pointer; border-bottom: 1px solid #f8f9fa; text-align: left; }
.suggestion-item:hover { background: #f3e5f5; }
.battery-control-box { margin-top: 10px; }
.battery-text-info { display: flex; justify-content: space-between; font-size: 12px; }
.battery-range-slider { width: 100%; accent-color: #198754; }
.btn-trigger-plan { width: 100%; padding: 12px; background: #111; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; }
.summary-card { background: #eef2f7; border-left: 5px solid #4a148c; text-align: left; }
.summary-title { margin: 0 0 8px 0; font-size: 13px; color: #333; }
.summary-item { font-size: 12px; margin-bottom: 4px; }
.stopover-list { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ccc; }
.stop-node { font-size: 11px; color: #c62828; margin-bottom: 2px; }
</style>