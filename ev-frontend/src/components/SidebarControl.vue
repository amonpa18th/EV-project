<template>
  <div 
    class="sidebar-control-panel"
    :class="[`sheet-state-${sheetState}`]"
    :style="mobileSheetStyle"
  >
    <!-- Mobile Drag Handle -->
    <div class="drag-handle-zone" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
      <div class="drag-handle-pill"></div>
    </div>
    
    <div class="sidebar-brand-header">
      <h2>
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="header-icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        EV Route Planner
      </h2>
      <p>วางแผนเส้นทางอัจฉริยะร่วมกับ PEA VOLTA</p>
    </div>

    <div class="sidebar-scroll-content">
      <!-- Section 0: Map Marker Filters (collapsible) -->
      <div class="ui-card filter-card">
        <div class="filter-card-header" @click="filtersOpen = !filtersOpen">
          <span class="ui-label filter-label-inline">กรองจุดชาร์จบนแผนที่</span>
          <span class="filter-toggle-icon" :class="{ rotated: filtersOpen }">&#9660;</span>
        </div>

        <div v-show="filtersOpen" class="filter-content">
          <!-- Charger Type -->
          <div class="filter-group">
            <div class="filter-group-label">ประเภทหัวชาร์จ</div>
            <div class="filter-chips">
              <button
                v-for="type in chargerTypeOptions"
                :key="type.value"
                @click="activeFilters.chargerType = type.value"
                :class="['filter-chip', { active: activeFilters.chargerType === type.value }]"
              >{{ type.label }}</button>
            </div>
          </div>

          <!-- Station Type -->
          <div class="filter-group">
            <div class="filter-group-label">ประเภทสถานี</div>
            <div class="filter-chips">
              <button
                v-for="type in stationTypeOptions"
                :key="type.value"
                @click="toggleStationType(type.value)"
                :class="['filter-chip', { active: activeFilters.stationTypes.includes(type.value) }]"
              >{{ type.label }}</button>
            </div>
          </div>

          <!-- Min Power -->
          <div class="filter-group">
            <div class="filter-group-label">กำลังไฟขั้นต่ำ</div>
            <div class="filter-chips">
              <button
                v-for="pw in powerOptions"
                :key="pw.value"
                @click="activeFilters.minPower = pw.value"
                :class="['filter-chip', { active: activeFilters.minPower === pw.value }]"
              >{{ pw.label }}</button>
            </div>
          </div>

          <!-- Availability -->
          <div class="filter-group">
            <div class="filter-group-label">สถานะให้บริการ</div>
            <div class="filter-chips">
              <button
                @click="activeFilters.onlyAvailable = false"
                :class="['filter-chip', { active: !activeFilters.onlyAvailable }]"
              >ทั้งหมด</button>
              <button
                @click="activeFilters.onlyAvailable = true"
                :class="['filter-chip', { active: activeFilters.onlyAvailable }]"
              >เปิดให้บริการ</button>
            </div>
          </div>

          <button @click="resetFilters" class="btn-reset-filters">&#8635; รีเซ็ตตัวกรอง</button>
        </div>
      </div>

      <!-- Section 1: Vehicle Info -->
      <div class="ui-card vehicle-abrp-card">
        <label class="ui-label">รถยนต์ของคุณ (Your EV)</label>

        <div class="vehicle-selector-two-step">
          <select v-model="selectedBrand" class="ui-input-field ui-select-field" @change="selectedCar = null">
            <option :value="null" disabled>เลือกยี่ห้อ (Brand)...</option>
            <option v-for="brand in sortedBrands" :key="brand" :value="brand">
              {{ brand }}
            </option>
          </select>

          <select
            v-if="selectedBrand"
            v-model="selectedCar"
            class="ui-input-field ui-select-field"
          >
            <option :value="null" disabled>เลือกรุ่น (Model)...</option>
            <option
              v-for="car in vehicleList.filter(v => v.brand === selectedBrand)"
              :key="car.id"
              :value="car"
            >
              {{ car.model }} · {{ car.battery_kwh }} kWh
            </option>
          </select>
        </div>

        <!-- Vehicle Spec + SoC row (only visible when a car is selected) -->
        <div v-if="selectedCar" class="vehicle-data-row">
          <div class="data-item">
            <span class="data-label">Battery</span>
            <span class="data-value">{{ selectedCar.battery_kwh }} kWh</span>
          </div>
          <div class="data-item">
            <span class="data-label">Est. Range</span>
            <span class="data-value">{{ selectedCar.range_km || '350' }} km</span>
          </div>
          <div class="data-item">
            <span class="data-label">Consumption</span>
            <span class="data-value">{{ Math.round((selectedCar.battery_kwh / (selectedCar.range_km || 350)) * 1000) }} Wh/km</span>
          </div>
        </div>

        <div v-if="selectedCar" class="abrp-battery-section">
          <div class="abrp-soc-display">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="abrp-battery-icon"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg>
            <span class="abrp-soc-text">{{ batterySOC }}%</span>
            <span class="abrp-soc-sublabel">State of Charge</span>
          </div>
          <div class="abrp-slider-container">
            <input
              type="range"
              min="10"
              max="100"
              step="1"
              v-model.number="batterySOC"
              class="abrp-slider"
              :disabled="isNavigating"
              :class="{ 'slider-disabled': isNavigating }"
              :style="{ background: `linear-gradient(to right, #00C853 ${batterySOC}%, #E5E7EB ${batterySOC}%)` }"
            />
          </div>
        </div>
      </div>

      <!-- Section 2: Route Planning -->
      <div class="ui-card">
        <label class="ui-label">เส้นทางเดินทาง (Route Planning)</label>
        
        <div class="route-timeline">
          <!-- Start Step -->
          <div class="route-step-container">
            <div class="step-connector">
              <span class="step-dot start"></span>
              <span class="step-line"></span>
            </div>
            <div class="step-content">
              <label class="step-label">จุดเริ่มต้น (Start)</label>
              <div class="search-wrapper" @click.stop>
                <div class="input-with-action">
                  <input 
                    type="text" 
                    v-model="routeData.origin.name" 
                    @input="debouncedSearch('origin'); onInputClear('origin')" 
                    @focus="routeData.origin.isOpen = true"
                    placeholder="ค้นหาจุดเริ่มต้น..." 
                    class="ui-input-field" 
                  />
                  <button @click="useCurrentLocation" class="btn-locate" title="ใช้ตำแหน่งปัจจุบัน">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line></svg>
                  </button>
                  <div v-if="routeData.origin.loading" class="spinner"></div>
                </div>
                
                <!-- Suggestions -->
                <ul v-if="routeData.origin.isOpen && routeData.origin.suggestions.length > 0" class="suggestions-list">
                  <li 
                    v-for="s in routeData.origin.suggestions" 
                    :key="s.display_name" 
                    @click="selectSuggestion('origin', null, s)"
                  >
                    <span class="suggestion-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></span>
                    <div class="suggestion-text">
                      <div class="suggestion-main">{{ s.name }}</div>
                      <div class="suggestion-sub">{{ s.display_name }}</div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Waypoints Steps -->
          <div v-for="(wp, index) in routeData.waypoints" :key="wp.id" class="route-step-container">
            <div class="step-connector">
              <span class="step-dot waypoint"></span>
              <span class="step-line" v-if="index < routeData.waypoints.length - 1"></span>
            </div>
            <div class="step-content">
              <div class="step-header-row">
                <label class="step-label">จุดแวะพักที่ {{ index + 1 }} (Stop)</label>
                <button @click="removeWaypoint(index)" class="btn-remove-wp" title="ลบจุดแวะพัก">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <div class="search-wrapper" @click.stop>
                <div class="input-with-action">
                  <input 
                    type="text" 
                    v-model="wp.name" 
                    @input="debouncedSearch('waypoint', index); onInputClear('waypoint', index)" 
                    @focus="wp.isOpen = true"
                    placeholder="ค้นหาจุดแวะพัก..." 
                    class="ui-input-field" 
                  />
                  <div v-if="wp.loading" class="spinner"></div>
                </div>
                
                <!-- Suggestions -->
                <ul v-if="wp.isOpen && wp.suggestions.length > 0" class="suggestions-list">
                  <li 
                    v-for="s in wp.suggestions" 
                    :key="s.display_name" 
                    @click="selectSuggestion('waypoint', index, s)"
                  >
                    <span class="suggestion-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></span>
                    <div class="suggestion-text">
                      <div class="suggestion-main">{{ s.name }}</div>
                      <div class="suggestion-sub">{{ s.display_name }}</div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Destination Step -->
          <div class="route-step-container">
            <div class="step-connector">
              <span class="step-dot destination"></span>
            </div>
            <div class="step-content">
              <label class="step-label">จุดหมายปลายทาง (Destination)</label>
              <div class="search-wrapper" @click.stop>
                <div class="input-with-action">
                  <input 
                    type="text" 
                    v-model="routeData.destination.name" 
                    @input="debouncedSearch('destination'); onInputClear('destination')" 
                    @focus="routeData.destination.isOpen = true"
                    placeholder="ค้นหาจุดหมายปลายทาง..." 
                    class="ui-input-field" 
                  />
                  <div v-if="routeData.destination.loading" class="spinner"></div>
                </div>
                
                <!-- Suggestions -->
                <ul v-if="routeData.destination.isOpen && routeData.destination.suggestions.length > 0" class="suggestions-list">
                  <li 
                    v-for="s in routeData.destination.suggestions" 
                    :key="s.display_name" 
                    @click="selectSuggestion('destination', null, s)"
                  >
                    <span class="suggestion-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></span>
                    <div class="suggestion-text">
                      <div class="suggestion-main">{{ s.name }}</div>
                      <div class="suggestion-sub">{{ s.display_name }}</div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- Add Stop Button -->
        <div class="add-stop-container">
          <button @click="addWaypoint" class="btn-add-stop">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="plus-icon"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>เพิ่มจุดแวะพัก (Add Stop)</span>
          </button>
        </div>
      </div>

      <!-- Section 3: Alternative Routes (Accordion) -->
      <div v-if="routeOptions.length > 0" class="ui-card route-options-card">
      <label class="ui-label">
        {{ routeOptions.length > 1 ? 'เส้นทางที่แนะนำ (Alternative Routes)' : 'เส้นทางที่แนะนำ (Recommended Route)' }}
      </label>

        <!-- ⚠️ Incomplete Route Warning -->
        <div v-if="routeOptions.some(r => r.is_incomplete)" class="banner-warning">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ไม่สามารถไปถึงได้ด้วยสถานี PEA VOLTA — เส้นทางนี้เกินระยะชาร์จที่มี
        </div>

        <!-- Emergency Rerouting Rescue -->
        <div v-if="isEmergencyRerouting" class="banner-warning" style="background-color: #fee2e2; color: #b91c1c; border: 1px solid #f87171;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <strong>ฉุกเฉิน!</strong> แบตเตอรี่ต่ำกว่า 30% กำลังค้นหาสถานีชาร์จที่ใกล้ที่สุดเพื่อความปลอดภัย
        </div>

        <!-- ℹ️ Generic Fallback Notice -->
        <div v-if="routeOptions.some(r => r.usingGenericFallback)" class="banner-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ใช้โปรไฟล์รถยนต์มาตรฐาน (Safe EV) — เพิ่มจุดชาร์จเพื่อความปลอดภัย
        </div>

        <div class="route-options-list">
          <div 
            v-for="(route, index) in routeOptions" 
            :key="route.routeIndex" 
            class="route-option-item"
            :class="{ active: selectedRouteIndex === index }"
            @click="selectRoute(index)"
          >
            <div class="route-option-header">
              <span class="route-option-title">Route {{ index + 1 }}</span>
              <span class="route-stops-badge" :class="{ 'no-charge': route.stopsRequired === 0 }">
                ชาร์จ {{ route.stopsRequired }} ครั้ง
              </span>
            </div>
            <!-- Dynamic Taxonomy Badge -->
            <div v-if="route.badgeLabel" class="taxonomy-badge" :class="route.badgeColorClass">
              {{ route.badgeLabel }}
            </div>
            <div class="route-option-stats">
              <div class="opt-stat">
                <span class="opt-stat-label">ระยะทาง:</span>
                <span class="opt-stat-val">{{ route.distanceKm }} km</span>
              </div>
              <div class="opt-stat">
                <span class="opt-stat-label">เวลารวม:</span>
                <span class="opt-stat-val">{{ formatDuration(route.totalDurationMins) }}</span>
              </div>
            </div>
            
            <!-- Expanded Details (Accordion Content) -->
            <div v-if="selectedRouteIndex === index" class="route-expanded-details">
              <div class="timeline-container">

                <!-- ── Origin Node ── -->
                <div class="timeline-node start-node">
                  <div class="tl-dot tl-dot--start">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                  </div>
                  <div class="tl-content">
                    <span class="tl-place-label">จุดเริ่มต้น</span>
                    <span class="tl-place-name">{{ routeData.origin.name || 'Origin' }}</span>
                  </div>
                </div>

                <!-- ── Stops Loop ── -->
                <template v-for="(stop, sIdx) in route.chargingStops" :key="sIdx">

                  <!-- Drive Leg -->
                  <div class="timeline-leg">
                    <div class="tl-connector"></div>
                    <div class="tl-drive-badge">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                      ขับต่อไป
                      <!-- First stop: distance = absoluteDistanceKm; subsequent: distanceFromPreviousKm -->
                      {{ sIdx === 0
                          ? Math.round(stop.absoluteDistanceKm || stop.distanceFromPreviousKm || 0)
                          : (stop.distanceFromPreviousKm || 0)
                      }} กิโลเมตร
                    </div>
                  </div>

                  <!-- Charging Node -->
                  <div class="timeline-node charge-node" @click.stop="focusStopOnMap(stop)">
                    <div class="tl-dot tl-dot--charge">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    </div>
                    <div class="tl-content">
                      <div class="tl-charge-title">ชาร์จ {{ sIdx + 1 }}: {{ stop.name }}</div>
                      <div class="tl-charge-row">
                        <span class="tl-charge-pill tl-pill--power">{{ stop.power }} kW</span>
                        <span class="tl-charge-label">กำลังชาร์จ: <strong>{{ stop.chargeTimeMins }} นาที</strong></span>
                      </div>
                      <div class="tl-charge-row tl-battery-row">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"/><line x1="22" y1="11" x2="22" y2="13"/></svg>
                        <span class="tl-charge-label">เปอร์เซ็นต์แบตที่คาดว่า:</span>
                        <span class="tl-soc">
                          <span class="tl-soc-arrival" :class="{ 'soc-low': stop.arrivalSoC < 25 }">{{ stop.arrivalSoC }}%</span>
                          <span class="tl-soc-arrow">➔</span>
                          <span class="tl-soc-depart">{{ stop.departureSoC }}%</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- ── Final Drive Leg ── -->
                <div class="timeline-leg">
                  <div class="tl-connector"></div>
                  <div class="tl-drive-badge">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    ขับต่อไป {{ route.distanceToDestinationKm || '---' }} กิโลเมตร
                  </div>
                </div>

                <!-- ── Destination Node ── -->
                <div class="timeline-node dest-node">
                  <div class="tl-dot tl-dot--dest">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  </div>
                  <div class="tl-content">
                    <span class="tl-place-label">จุดหมาย</span>
                    <span class="tl-place-name">{{ routeData.destination.name || 'Destination' }}</span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Sticky Footer Trigger -->
    <div class="sidebar-footer">
      <button v-if="routeOptions.length > 0" @click="clearRoute" class="btn-clear-route">
        &#10005; ล้างเส้นทาง (Clear Route)
      </button>
      <button class="btn-trigger-plan" @click="emitCalculateRoute" :disabled="isCalculating">
        <div v-if="isCalculating" class="spinner button-spinner"></div>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spark-icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>{{ isCalculating ? 'กำลังวางแผนเส้นทาง...' : 'วางแผนการเดินทาง' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

const vehicleList = ref([]);
const selectedBrand = ref(null);
const selectedCar = ref(null);
const batterySOC = ref(100);

// Pins "Other / Generic" to the top of the brand list for quick access,
// while keeping all corporate brands in alphabetical order below it.
const sortedBrands = computed(() => {
  const PRIORITY_BRAND = 'Other / Generic';
  const all = [...new Set(vehicleList.value.map(v => v.brand))];
  const pinned = all.filter(b => b === PRIORITY_BRAND);
  const rest   = all.filter(b => b !== PRIORITY_BRAND).sort();
  return [...pinned, ...rest];
});

const routeData = ref({
  origin: { name: '', coords: null, suggestions: [], loading: false, isOpen: false },
  destination: { name: '', coords: null, suggestions: [], loading: false, isOpen: false },
  waypoints: []
});

const routeOptions = ref([]);
const selectedRouteIndex = ref(0);
const isCalculating = ref(false);
const isEmergencyRerouting = ref(false); // Bound to a red alert banner in the UI
const isNavigating = ref(false);

// Removed baseline variables because we no longer dynamically drain battery

// ==========================================
// Map Marker Filter State
// ==========================================
const filtersOpen = ref(false);

const chargerTypeOptions = [
  { label: 'ทั้งหมด', value: 'all' },
  { label: 'DC Fast Charge', value: 'dc' },
  { label: 'AC Destination', value: 'ac' }
];

const activeFilters = ref({
  chargerType: 'all',
  stationTypes: ['hub', 'volta', 'connext'],
  minPower: 0,
  onlyAvailable: false
});

const stationTypeOptions = [
  { label: 'PEA HUB', value: 'hub' },
  { label: 'PEA VOLTA', value: 'volta' },
  { label: 'PEA Connext', value: 'connext' }
];

const powerOptions = [
  { label: 'ทั้งหมด', value: 0 },
  { label: '≥25 kW', value: 25 },
  { label: '≥50 kW', value: 50 },
  { label: '≥120 kW', value: 120 },
  { label: '≥300 kW', value: 300 }
];

const toggleStationType = (value) => {
  const arr = activeFilters.value.stationTypes;
  const idx = arr.indexOf(value);
  if (idx >= 0) {
    if (arr.length > 1) arr.splice(idx, 1); // ห้ามยกเลิกทั้งหมด
  } else {
    arr.push(value);
  }
};

const resetFilters = () => {
  activeFilters.value.chargerType = 'all';
  activeFilters.value.stationTypes = ['hub', 'volta', 'connext'];
  activeFilters.value.minPower = 0;
  activeFilters.value.onlyAvailable = false;
};

// แจ้ง MapArea.vue ทุกครั้งที่ตัวกรองเปลี่ยน
watch(activeFilters, (newFilters) => {
  window.dispatchEvent(new CustomEvent('update-map-filters', {
    detail: {
      chargerType: newFilters.chargerType,
      stationTypes: [...newFilters.stationTypes],
      minPower: newFilters.minPower,
      onlyAvailable: newFilters.onlyAvailable
    }
  }));
}, { deep: true });

const emit = defineEmits(['trigger-route']);

// Named handler so it can be properly removed in onUnmounted (fixes Risk 4)
const handleNavStateChanged = (e) => {
  isNavigating.value = e.detail.active;
};

onMounted(async () => {
  try {
    const res = await fetch('/vehicles.json');
    vehicleList.value = await res.json();
  } catch (err) {
    console.error("โหลดรายชื่อรถไม่สำเร็จ:", err);
  }
  document.addEventListener('click', closeAllSuggestions);
  // Listen for polyline clicks from the map → switch selected route
  window.addEventListener('map-route-select', handleMapRouteSelect);
  window.addEventListener('off-route-deviation', handleOffRoute);
  window.addEventListener('nav-state-changed', handleNavStateChanged);
  // Bug 1 Fix: removed stray fetchVehicleList() call — loading already done above
});

onUnmounted(() => {
  document.removeEventListener('click', closeAllSuggestions);
  window.removeEventListener('map-route-select', handleMapRouteSelect);
  window.removeEventListener('off-route-deviation', handleOffRoute);
  window.removeEventListener('nav-state-changed', handleNavStateChanged); // Risk 4 Fix: named function
});

// Removed nav-odometer-heartbeat and handleSimCharging logic because battery is now a static input

const handleOffRoute = async (e) => {
  if (isCalculating.value) return; 

  const { currentPos: livePos, odometerKm: currentLiveOdometerKm } = e.detail;
  
  // Overwrite the Payload Dictionary
  routeData.value.origin.coords = livePos;
  routeData.value.origin.name = "Current Live Location";
  
  // EMERGENCY RESCUE GATE
  let isRescueRequired = false;
  if (batterySOC.value < 30) {
    isEmergencyRerouting.value = true;
    isRescueRequired = true;
  } else {
    isEmergencyRerouting.value = false;
  }

  // 3. Trigger Silent Engine Recalculation with Emergency Payload
  await emitCalculateRoute({ isEmergencyRescue: isRescueRequired });
};

// Called when the map emits a polyline-click event
const handleMapRouteSelect = (e) => {
  const idx = e.detail?.index;
  if (idx !== undefined && routeOptions.value[idx]) {
    selectRoute(idx);
  }
};

const closeAllSuggestions = () => {
  routeData.value.origin.isOpen = false;
  routeData.value.destination.isOpen = false;
  routeData.value.waypoints.forEach(wp => wp.isOpen = false);
};



const useCurrentLocation = () => {
  navigator.geolocation.getCurrentPosition((pos) => {
    routeData.value.origin.name = "ตำแหน่งปัจจุบันของคุณ";
    routeData.value.origin.coords = [pos.coords.latitude, pos.coords.longitude];
    routeData.value.origin.isOpen = false;
  }, (err) => {
    console.error("Geolocation failed:", err);
    alert("ไม่สามารถระบุตำแหน่งปัจจุบันได้ กรุณาลองใหม่อีกครั้ง");
  });
};

let searchAbortController = null;

const searchLocation = async (type, index = null) => {
  let target;
  if (type === 'origin') {
    target = routeData.value.origin;
  } else if (type === 'destination') {
    target = routeData.value.destination;
  } else if (type === 'waypoint' && index !== null) {
    target = routeData.value.waypoints[index];
  }

  if (!target) return;

  const query = target.name.trim();
  if (query.length < 2) {
    target.suggestions = [];
    target.isOpen = false;
    return;
  }

  target.loading = true;

  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();
  const signal = searchAbortController.signal;

  try {

    const googleRes = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(query)}`, { signal });
    const googleData = await googleRes.json();

    if (googleData && !googleData.fallback && googleData.predictions && googleData.predictions.length > 0) {
      target.suggestions = googleData.predictions;
      target.isOpen = true;
      return;
    }


    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&bbox=97.5,5.6,105.7,20.5`;

    const res = await fetch(photonUrl, { signal });
    
    if (!res.ok) {
      throw new Error(`Photon API returned ${res.status}`);
    }

    const data = await res.json();

    
    if (data && data.features) {
      target.suggestions = data.features.map(feature => {
        const p = feature.properties || {};
        const mainName = p.name || 'Unknown Location';
        // Construct a clean display string from available properties using optional chaining
        const parts = [];
        if (p?.street) parts.push(p.street);
        if (p?.district) parts.push(p.district);
        if (p?.city) parts.push(p.city);
        if (p?.state) parts.push(p.state);
        const subName = parts.filter(Boolean).join(', ');
        const displayName = subName ? `${mainName}${mainName ? ', ' : ''}${subName}` : mainName;
        
        return {
          display_name: displayName,
          lat: feature.geometry?.coordinates?.[1] || 0,
          lon: feature.geometry?.coordinates?.[0] || 0,
          name: mainName || displayName
        };
      });
    } else {
      target.suggestions = [];
    }
    
    target.isOpen = true;
  } catch (err) {
    if (err.name === 'AbortError') {

      return; // Safely exit without clearing loading state
    } else {
      console.error("Geocoding search failed:", err);
      target.suggestions = [];
    }
  } finally {
    if (searchAbortController && !searchAbortController.signal.aborted) {
      target.loading = false;
    }
  }
};

const debounce = (fn, delay = 400) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

const debouncedSearch = debounce((type, index = null) => {
  searchLocation(type, index);
}, 400);

const onInputClear = (type, index = null) => {
  let target;
  if (type === 'origin') {
    target = routeData.value.origin;
  } else if (type === 'destination') {
    target = routeData.value.destination;
  } else if (type === 'waypoint' && index !== null) {
    target = routeData.value.waypoints[index];
  }

  if (target && target.name.trim() === '') {
    target.coords = null;
    target.suggestions = [];
    target.isOpen = false;
  }
};

const selectSuggestion = async (type, index, suggestion) => {
  let target;
  if (type === 'origin') {
    target = routeData.value.origin;
  } else if (type === 'destination') {
    target = routeData.value.destination;
  } else if (type === 'waypoint' && index !== null) {
    target = routeData.value.waypoints[index];
  }

  if (target) {
    target.name = suggestion.name;
    target.isOpen = false;
    target.suggestions = [];

    if (suggestion.place_id) {
      target.loading = true;
      try {
        const res = await fetch(`/api/places/details?place_id=${suggestion.place_id}`);
        const data = await res.json();
        if (data && data.lat && data.lon) {
          target.coords = [data.lat, data.lon];
        }
      } catch (err) {
        console.error("Failed to fetch Google Place details:", err);
        alert("ไม่สามารถดึงพิกัดจาก Google Places ได้");
      } finally {
        target.loading = false;
      }
    } else {
      target.coords = [suggestion.lat, suggestion.lon];
    }
  }
};

let waypointIdCounter = 0;

// ── Sequential Route-Selection Lock ───────────────────────────────────────
// Ensures only the LATEST selectRoute or emitCalculateRoute invocation commits
// its result to reactive state. Any prior inflight async call that resolves
// after a newer call has started will detect the ID mismatch and silently abort,
// preventing stale geometries from overwriting correct UI state.
let _latestSelectId = 0;
const addWaypoint = () => {
  routeData.value.waypoints.push({
    id: ++waypointIdCounter,
    name: '',
    coords: null,
    suggestions: [],
    loading: false,
    isOpen: false
  });
};

const removeWaypoint = (index) => {
  routeData.value.waypoints.splice(index, 1);
};

const formatDuration = (mins) => {
  if (mins < 60) return `${mins} นาที`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hrs} ชม. ${remainingMins} นาที` : `${hrs} ชม.`;
};

const focusStopOnMap = (stop) => {
  const event = new CustomEvent('focus-map-marker', {
    detail: {
      name: stop.name,
      coords: stop.coords
    }
  });
  window.dispatchEvent(event);
};

const selectRoute = async (index) => {
  const myId = ++_latestSelectId; // Claim a unique monotonic ID for this invocation
  selectedRouteIndex.value = index;
  const route = routeOptions.value[index];
  if (!route) return;

  const validWaypoints = routeData.value.waypoints
    .filter(wp => wp.coords !== null)
    .map(wp => wp.coords);

  // geometry is already fully stitched by emitCalculateRoute
  const finalGeometry = route.geometry;

  // Guard: if a newer selectRoute or Plan Route call has started since we began,
  // our result is stale. Abort silently to prevent wrong geometry rendering.
  if (myId !== _latestSelectId) return;

  // Dispatch custom window event for MapArea.vue to draw route and charging stops
  const event = new CustomEvent('trigger-route-calculation', {
    detail: {
      origin: routeData.value.origin.coords,
      destination: routeData.value.destination.coords,
      waypoints: validWaypoints,
      geometry: finalGeometry, // Use the new perfectly detoured geometry
      chargingStops: route.chargingStops,
      optionalStops: route.optionalStops || [],
      vehicle: selectedCar.value,
      allRoutes: routeOptions.value,
      selectedIndex: index
    }
  });
  window.dispatchEvent(event);
};

const emitCalculateRoute = async (options = {}) => {
  if (!selectedCar.value) {
    alert("กรุณาเลือกรุ่นรถก่อนวางแผนครับ");
    return;
  }

  const originCoords = routeData.value.origin.coords;
  const destCoords = routeData.value.destination.coords;

  if (!originCoords) {
    alert("กรุณาระบุจุดเริ่มต้นที่ถูกต้อง (เลือกจากรายการค้นหา)");
    return;
  }
  if (!destCoords) {
    alert("กรุณาระบุจุดหมายปลายทางที่ถูกต้อง (เลือกจากรายการค้นหา)");
    return;
  }

  const validWaypoints = routeData.value.waypoints
    .filter(wp => wp.coords !== null)
    .map(wp => wp.coords);

  isCalculating.value = true;
  routeOptions.value = [];
  selectedRouteIndex.value = 0;
  window.dispatchEvent(new CustomEvent('route-calculation-started'));

  try {
    const res = await fetch('/api/route-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: originCoords,
        destination: destCoords,
        waypoints: validWaypoints,
        vehicle: selectedCar.value,
        batterySOC: batterySOC.value,
        isEmergencyRescue: options.isEmergencyRescue || false
      })
    });

    if (!res.ok) {
      throw new Error("Failed to calculate routes");
    }

    const data = await res.json();
    // Claim a fetch ID AFTER the main API responds.
    // If a new 'Plan Route' request was fired while this was inflight,
    // _latestSelectId will have advanced and we will discard this stale result.
    const fetchId = ++_latestSelectId;
    
    // FETCH FULL DETOUR GEOMETRIES FOR ALL ALTERNATIVE ROUTES
    // This ensures gray lines perfectly reflect the charging detours on the map.
    await Promise.all(data.map(async (route) => {
      if (route.chargingStops && route.chargingStops.length > 0) {
        try {
          let coordStr = `${originCoords[1]},${originCoords[0]}`;
          if (route.orderedWaypoints && route.orderedWaypoints.length > 0) {
            route.orderedWaypoints.forEach(wp => {
              coordStr += `;${wp.coords[1]},${wp.coords[0]}`;
            });
          } else {
            validWaypoints.forEach(wp => {
              coordStr += `;${wp[1]},${wp[0]}`;
            });
            route.chargingStops.forEach(stop => {
              coordStr += `;${stop.coords[1]},${stop.coords[0]}`;
            });
          }
          coordStr += `;${destCoords[1]},${destCoords[0]}`;
          
          const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=true`;
          const osrmRes = await fetch(osrmUrl);
          const osrmData = await osrmRes.json();
          
          if (osrmData.routes && osrmData.routes.length > 0) {
            route.geometry = osrmData.routes[0].geometry;
          }
        } catch (e) {
          console.error("Failed to fetch detailed polyline with stops for alt route:", e);
        }
      }
    }));

    // Final guard: only commit to reactive state if no newer request has superseded us.
    // This handles the case where the user clicks Plan Route twice quickly.
    if (fetchId !== _latestSelectId) {
      console.warn('[SidebarControl] Discarding stale route fetch result (superseded by newer request).');
      return;
    }

    // 1. Primary Sort: Fastest Total Duration Wins
    data.sort((a, b) => a.totalDurationMins - b.totalDurationMins);

    // 2. Dynamic Taxonomy / Alternative Differentiation
    data.forEach((route, idx) => {
      if (idx === 0) {
        route.badgeLabel = "เส้นทางที่เร็วที่สุด (Fastest)";
        route.badgeColorClass = "badge--fastest";
      } else {
        const winner = data[0];
        if (route.stopsRequired < winner.stopsRequired) {
          route.badgeLabel = "แวะชาร์จน้อยกว่า (Eco/Fewer Stops)";
          route.badgeColorClass = "badge--eco";
        } else if (route.distanceKm < winner.distanceKm - 5) {
          route.badgeLabel = "ระยะทางสั้นกว่า (Shortest Distance)";
          route.badgeColorClass = "badge--short";
        } else {
          route.badgeLabel = "เส้นทางสำรอง (Alternative)";
          route.badgeColorClass = "badge--alt";
        }
      }
    });

    routeOptions.value = data;
    
    if (data.length > 0) {
      await selectRoute(0);
      
      // Emit compatibility event
      emit('trigger-route', { 
        origin: originCoords, 
        destination: destCoords,
        vehicle: selectedCar.value 
      });
    } else {
      alert("ไม่พบเส้นทางในการเดินทาง");
    }
  } catch (err) {
    console.error("Routing calculation failed:", err);
    alert("การคำนวณเส้นทางล้มเหลว กรุณาลองใหม่อีกครั้ง");
  } finally {
    isCalculating.value = false;
  }
};

// ล้างผลลัพธ์เส้นทางและกลับไปแสดงหมุดทั้งหมดบนแผนที่
const clearRoute = () => {
  routeOptions.value = [];
  selectedRouteIndex.value = 0;
  window.dispatchEvent(new CustomEvent('clear-route'));
};
// ==========================================
// Mobile Bottom Sheet Logic
// ==========================================
const sheetState = ref('HALF'); // 'PEEK', 'HALF', 'FULL'
const sheetY = ref(0);
let startY = 0;
let currentY = 0;
const isDragging = ref(false);

const onTouchStart = (e) => {
  // Only trigger on mobile devices
  if (window.innerWidth > 768) return;
  startY = e.touches[0].clientY;
  currentY = startY;
  isDragging.value = true;
};

const onTouchMove = (e) => {
  if (!isDragging.value || window.innerWidth > 768) return;
  currentY = e.touches[0].clientY;
  const deltaY = currentY - startY;
  
  let baseOffset = 0;
  const h = window.innerHeight;
  if (sheetState.value === 'PEEK') baseOffset = h * 0.8;
  else if (sheetState.value === 'HALF') baseOffset = h * 0.5;
  else if (sheetState.value === 'FULL') baseOffset = 0;
  
  // Allow dragging up and down with constraint
  sheetY.value = Math.max(0, baseOffset + deltaY);
};

const onTouchEnd = () => {
  if (!isDragging.value || window.innerWidth > 768) return;
  isDragging.value = false;
  
  const h = window.innerHeight;
  if (sheetY.value < h * 0.3) {
    sheetState.value = 'FULL';
  } else if (sheetY.value < h * 0.65) {
    sheetState.value = 'HALF';
  } else {
    sheetState.value = 'PEEK';
  }
  
  // Reset for CSS class transition
  sheetY.value = 0;
};

const mobileSheetStyle = computed(() => {
  if (window.innerWidth > 768) return {};
  if (isDragging.value) {
    return { transform: `translateY(${sheetY.value}px)`, transition: 'none' };
  }
  return {};
});

</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap');

/*
 * PEA VOLTA Sidebar Theme — Vibrant Gradient + Floating White Cards
 * Matches: peavoltaev.pea.co.th hero section
 * Gradient: #b02a8f (magenta-purple) → #3E1C96 (deep brand purple)
 * Cards:    #FFFFFF floating with soft shadow
 */

/* ============================================================
   1. OUTER SHELL — Vibrant PEA gradient
   ============================================================ */
.sidebar-control-panel {
  width: 380px;
  background: #F9FAFB;
  color: #333333;
  height: 100vh;
  box-shadow: 4px 0 24px rgba(62, 28, 150, 0.15);
  display: flex;
  flex-direction: column;
  font-family: 'Kanit', sans-serif;
  overflow: hidden;
}

/* ── Header: App title on gradient (white text) ── */
.sidebar-brand-header {
  background: linear-gradient(135deg, #b02a8f 0%, #3E1C96 100%);
  padding: 22px 20px 18px;
  flex-shrink: 0;
}
.sidebar-brand-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.3px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ffffff;
  font-family: 'Kanit', sans-serif;
  text-shadow: 0 2px 8px rgba(0,0,0,0.18);
}
.header-icon {
  fill: #FFE135;
  color: #FFE135;
  filter: drop-shadow(0 2px 8px rgba(255,225,53,0.55));
}
.sidebar-brand-header p {
  margin: 5px 0 0 0;
  font-size: 12px;
  color: rgba(255,255,255,0.90);

  font-weight: 400;
}

/* ── Scrollable body — transparent so gradient shows through ── */
.sidebar-scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: transparent;
}
.sidebar-scroll-content::-webkit-scrollbar { width: 5px; }
.sidebar-scroll-content::-webkit-scrollbar-track { background: rgba(255,255,255,0.08); border-radius: 4px; }
.sidebar-scroll-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.30); border-radius: 4px; }
.sidebar-scroll-content::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.50); }

/* ============================================================
   2. FLOATING WHITE CARDS (the hero-section info card look)
   ============================================================ */
.ui-card {
  background: #FFFFFF;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
  color: #333333;
}



/* ============================================================
   3. LABELS & TEXT (dark on white cards)
   ============================================================ */
.ui-label {
  font-size: 11px;
  font-weight: 700;
  color: #3E1C96;
  display: block;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

/* ============================================================
   4. INPUTS
   ============================================================ */
.ui-input-field {
  width: 100%;
  padding: 10px 14px;
  background: #F8F9FA;
  border: 1.5px solid #E5E7EB;
  color: #333333;
  border-radius: 9999px;
  font-size: 14px;
  font-family: 'Kanit', sans-serif;
  transition: all 0.2s ease;
  box-sizing: border-box;
}
.ui-input-field::placeholder { color: #9CA3AF; }
.ui-input-field:focus {
  border-color: #6938EF;
  outline: none;
  box-shadow: 0 0 0 3px rgba(105, 56, 239, 0.15), inset 0 1px 2px rgba(0, 0, 0, 0.05);
  background: #FEFEFE;
}
.ui-select-field {
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
  background-position: right 12px center;
  background-repeat: no-repeat;
  background-size: 18px;
  padding-right: 38px;
  appearance: none;
  cursor: pointer;
}

/* ============================================================
   5. VEHICLE & BATTERY (ABRP STYLE)
   ============================================================ */
/* Vehicle Card — clean padding, overflow:visible so dropdowns never get clipped */
.vehicle-abrp-card { padding: 16px; overflow: visible; border-radius: 14px; }

/* Two-step selector: always stacked column, full-width, gap between items */
.vehicle-selector-two-step {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 14px;
}

/* Each <select> inside the selector must fill width and respect padding */
.vehicle-selector-two-step .ui-input-field,
.vehicle-selector-two-step .ui-select-field {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.vehicle-data-row {
  display: flex;
  justify-content: space-between;
  background: #F8F9FA;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
  border: 1px solid #E5E7EB;
}
.data-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.data-label {
  font-size: 11px;
  color: #6B7280;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.data-value {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.abrp-battery-section { display: flex; flex-direction: column; gap: 10px; position: relative; }
.abrp-soc-display { display: flex; align-items: center; gap: 8px; color: #111827; }
.abrp-battery-icon { color: #111827; flex-shrink: 0; }
.abrp-soc-text { font-size: 24px; font-weight: 700; font-family: 'Kanit', sans-serif; letter-spacing: -0.5px; line-height: 1; }
.abrp-soc-sublabel { font-size: 11px; color: #9CA3AF; font-weight: 500; margin-left: 2px; }
.abrp-slider-container { width: 100%; }
.abrp-slider { width: 100%; height: 6px; border-radius: 4px; outline: none; appearance: none; cursor: pointer; position: relative; z-index: 5; }
.abrp-slider::-webkit-slider-thumb { appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #FFFFFF; cursor: pointer; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: transform 0.1s; }
.abrp-slider::-webkit-slider-thumb:hover { transform: scale(1.1); box-shadow: 0 2px 5px rgba(0,0,0,0.4); }

/* ============================================================
   7. ROUTE TIMELINE
   ============================================================ */
.route-timeline { display: flex; flex-direction: column; position: relative; }
.route-step-container { display: flex; gap: 14px; position: relative; margin-bottom: 16px; }
.step-connector { display: flex; flex-direction: column; align-items: center; width: 16px; padding-top: 14px; flex-shrink: 0; }
.step-dot { width: 12px; height: 12px; border-radius: 50%; display: block; position: relative; z-index: 2; }
.step-dot.start { background: #10b981; border: 2.5px solid #A7F3D0; box-shadow: 0 0 8px rgba(16,185,129,0.4); }
.step-dot.waypoint { width: 8px; height: 8px; background: #9CA3AF; border: 2px solid #D1D5DB; margin-top: 2px; }
.step-dot.destination { background: #EF4444; border: 2.5px solid #FCA5A5; box-shadow: 0 0 8px rgba(239,68,68,0.4); }
.step-line { width: 2px; flex-grow: 1; background: linear-gradient(to bottom, rgba(105, 56, 239, 0.4), #E5E7EB); margin-top: 6px; }
.step-content { flex: 1; min-width: 0; }
.step-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.step-label { font-size: 10px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.5px; }
.btn-remove-wp { background: transparent; border: none; color: #EF4444; cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s; position: relative; z-index: 2; }
.btn-remove-wp:hover { background: rgba(239,68,68,0.08); }

/* ============================================================
   8. SEARCH & AUTOCOMPLETE
   ============================================================ */
.search-wrapper { position: relative; }
.input-with-action { position: relative; display: flex; align-items: center; }
.btn-locate { position: absolute; right: 12px; background: none; border: none; color: #9CA3AF; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s; z-index: 5; }
.btn-locate:hover { color: #6938EF; background: rgba(105,56,239,0.08); }
.spinner { position: absolute; right: 40px; width: 14px; height: 14px; border: 2px solid rgba(62,28,150,0.15); border-top-color: #6938EF; border-radius: 50%; animation: spin 0.8s linear infinite; z-index: 5; }
@keyframes spin { to { transform: rotate(360deg); } }
.suggestions-list { position: absolute; z-index: 9999 !important; left: 0; right: 0; margin-top: 6px; background-color: #FFFFFF !important; border: 1px solid #E5E7EB; border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.15); max-height: 220px; overflow-y: auto; padding: 6px; list-style: none; }
.suggestions-list li { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.15s ease; position: relative; }
.suggestions-list li:hover { background: #F3F4F6; }
.suggestion-icon { font-size: 16px; margin-top: 1px; }
.suggestion-text { display: flex; flex-direction: column; overflow: hidden; }
.suggestion-main { font-size: 13px; font-weight: 600; color: #1F2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.suggestion-sub { font-size: 10px; color: #9CA3AF; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.add-stop-container { margin-top: 6px; }
.btn-add-stop { width: 100%; padding: 10px 20px; background: rgba(105, 56, 239, 0.12); border: 1.5px solid rgba(105, 56, 239, 0.35); color: #6938EF; border-radius: 999px; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: all 0.2s ease; font-family: 'Kanit', sans-serif; letter-spacing: 0.3px; }
.btn-add-stop:hover { background: rgba(105, 56, 239, 0.28); border-color: rgba(105, 56, 239, 0.70); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(105,56,239,0.30); color: #3E1C96; }

/* ============================================================
   9. STICKY FOOTER — white base, purple CTA
   ============================================================ */
.sidebar-footer {
  position: sticky;
  bottom: 0;
  background: rgba(62, 28, 150, 0.85);
  backdrop-filter: blur(12px);
  padding: 14px 16px 20px;
  border-top: 1px solid rgba(255,255,255,0.12);
  z-index: 10;
}
.btn-trigger-plan {
  width: 100%;
  padding: 13px 18px;
  background: linear-gradient(135deg, #b02a8f 0%, #3E1C96 100%);
  color: #FFFFFF;
  border: none;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
  box-shadow: 0 6px 20px rgba(0,0,0,0.20);
  font-family: 'Kanit', sans-serif;
  letter-spacing: 0.3px;
}
.btn-trigger-plan:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(105, 56, 239, 0.4);
  background: linear-gradient(135deg, #be339d 0%, #4a21b3 100%);
}
.btn-trigger-plan:active { transform: translateY(1px); }
.btn-trigger-plan:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.spark-icon { fill: #FFFFFF; color: #FFFFFF; }
.button-spinner { position: static; margin-right: 8px; flex-shrink: 0; border-top-color: #FFFFFF; }
.btn-clear-route { width: 100%; padding: 9px; margin-bottom: 8px; background: transparent; border: 1.5px solid rgba(255,255,255,0.30); color: rgba(255,255,255,0.80); border-radius: 9999px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: 'Kanit', sans-serif; display: flex; align-items: center; justify-content: center; gap: 6px; }
.btn-clear-route:hover { border-color: rgba(255,100,100,0.70); color: #ff9999; background: rgba(239,68,68,0.10); }

/* ============================================================
   10. ROUTE OPTIONS (white floating)
   ============================================================ */
.route-options-card { padding: 14px 12px; }
.route-options-list { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.route-option-item { background: #FFFFFF; border: 1.5px solid #E5E7EB; border-radius: 16px; padding: 12px 14px; cursor: pointer; transition: all 0.2s cubic-bezier(0.4,0,0.2,1); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
.route-option-item:hover { border-color: #6938EF; box-shadow: 0 10px 15px -3px rgba(105,56,239,0.1), 0 4px 6px -2px rgba(105,56,239,0.05); }
.route-option-item.active { border-color: #6938EF; background: rgba(105,56,239,0.04); box-shadow: 0 0 0 3px rgba(105,56,239,0.14); }
.route-option-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.route-option-title { font-size: 13px; font-weight: 700; color: #1F2937; }
.route-stops-badge { font-size: 10px; font-weight: 700; background: rgba(245,158,11,0.10); color: #D97706; padding: 2px 8px; border-radius: 20px; border: 1px solid rgba(245,158,11,0.25); }
.route-stops-badge.no-charge { background: rgba(16,185,129,0.10); color: #059669; border-color: rgba(16,185,129,0.25); }
.route-option-stats { display: flex; gap: 16px; margin-bottom: 8px; border-bottom: 1px solid #F3F4F6; padding-bottom: 8px; }
.opt-stat { display: flex; gap: 4px; font-size: 12px; }
.opt-stat-label { color: #9CA3AF; }
.opt-stat-val { color: #1F2937; font-weight: 700; }
.route-breakdown-path { font-size: 11px; }
.path-scroll { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 4px; white-space: nowrap; }
.path-scroll::-webkit-scrollbar { height: 3px; }
.path-scroll::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 2px; }
.path-step { color: #9CA3AF; font-weight: 500; }
.route-option-item.active .path-step { color: #6938EF; }
.path-arrow { color: #D1D5DB; font-weight: bold; margin: 0 2px; }
.route-expanded-details { margin-top: 14px; padding-top: 14px; border-top: 1px dashed #E5E7EB; animation: slideDown 0.3s ease; }

/* Taxonomy badges: real CSS classes replacing broken Tailwind strings */
.taxonomy-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 3px 10px;
  border-radius: 99px;
  margin-bottom: 8px;
  color: #FFFFFF;
}
.badge--fastest { background: linear-gradient(135deg, #7c3aed, #b02a8f); }
.badge--eco     { background: linear-gradient(135deg, #059669, #10b981); }
.badge--short   { background: linear-gradient(135deg, #1d4ed8, #3b82f6); }
.badge--alt     { background: #6B7280; }


/* ============================================================
   11. TIMELINE
   ============================================================ */
/* ============================================================
   11. ROUTE TIMELINE
   ============================================================ */
.timeline-container {
  display: flex;
  flex-direction: column;
  background: #FFFFFF;
  border-radius: 16px;
  padding: 14px 12px;
  border: 1px solid #E5E7EB;
  gap: 0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

/* Dot column */
.tl-dot {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.tl-dot--start  { background: #10B981; color: #fff; }
.tl-dot--charge { background: #6938EF; color: #fff; box-shadow: 0 0 0 3px rgba(105,56,239,0.18); }
.tl-dot--dest   { background: #EF4444; color: #EF4444; border: 2px solid #EF4444; }

/* Nodes */
.timeline-node {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.tl-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
}

.tl-place-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #9CA3AF;
}
.tl-place-name {
  font-size: 13px;
  font-weight: 600;
  color: #1F2937;
  line-height: 1.3;
}

/* Drive legs */
.timeline-leg {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  padding-left: 0;
}
.tl-connector {
  width: 22px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.tl-connector::before {
  content: '';
  display: block;
  width: 2px;
  height: 32px;
  background: linear-gradient(to bottom, #D1D5DB 0%, #D1D5DB 100%);
  border-radius: 2px;
}
.tl-drive-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #6B7280;
  white-space: nowrap;
}
.tl-drive-badge svg { color: #9CA3AF; }

/* Charge node */
.charge-node {
  background: rgba(105,56,239,0.05);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(105,56,239,0.18);
  cursor: pointer;
  transition: all 0.2s ease;
  margin: 2px 0;
  align-items: flex-start;
}
.charge-node:hover {
  background: rgba(105,56,239,0.10);
  border-color: rgba(105,56,239,0.35);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(105,56,239,0.12);
}
.tl-charge-title {
  font-size: 13px;
  font-weight: 700;
  color: #1F2937;
  margin-bottom: 6px;
  line-height: 1.3;
}
.tl-charge-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.tl-charge-row:last-child { margin-bottom: 0; }
.tl-battery-row { color: #6938EF; }
.tl-charge-label {
  font-size: 11px;
  color: #6B7280;
}
.tl-charge-label strong { color: #1F2937; }
.tl-charge-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
}
.tl-pill--power {
  background: rgba(105,56,239,0.12);
  color: #6938EF;
}
.tl-soc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
}
.tl-soc-arrival { color: #F59E0B; }
.tl-soc-arrival.soc-low { color: #EF4444; }
.tl-soc-arrow { color: #9CA3AF; font-size: 10px; }
.tl-soc-depart { color: #10B981; }

/* ============================================================
   12. CHARGING STOP CARDS
   ============================================================ */
.charging-stops-details-card { padding: 14px 12px; }
.charging-stops-list { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.charging-stop-card { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 16px; padding: 12px 14px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
.charging-stop-card:hover { border-color: #6938EF; transform: translateY(-1px); box-shadow: 0 10px 15px -3px rgba(105,56,239,0.1), 0 4px 6px -2px rgba(105,56,239,0.05); }
.stop-card-badge { font-size: 9px; font-weight: 800; text-transform: uppercase; color: #6938EF; letter-spacing: 0.8px; margin-bottom: 4px; }
.stop-station-name { font-size: 13px; font-weight: 700; color: #1F2937; margin: 0 0 10px 0; line-height: 1.4; }
.stop-station-details-grid { display: grid; grid-template-columns: 1fr; gap: 6px; }
.stop-detail-item { display: flex; align-items: center; gap: 8px; background: #F8F9FA; padding: 6px 10px; border-radius: 6px; border: 1px solid #F3F4F6; }
.stop-detail-icon { font-size: 14px; display: flex; align-items: center; }
.stop-detail-text { display: flex; flex-direction: column; }
.stop-detail-label { font-size: 9px; color: #9CA3AF; font-weight: 600; text-transform: uppercase; }
.stop-detail-value { font-size: 12px; font-weight: 700; color: #1F2937; margin-top: 1px; }

/* ============================================================
   13. FILTER PANEL (inside a white card)
   ============================================================ */
.filter-card { padding: 12px 14px; }
.filter-card-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; }
.filter-label-inline { margin-bottom: 0 !important; cursor: pointer; }
.filter-toggle-icon { font-size: 10px; color: #9CA3AF; transition: transform 0.25s ease; display: inline-block; line-height: 1; }
.filter-toggle-icon.rotated { transform: rotate(180deg); }
.filter-content { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; animation: slideDown 0.2s ease; }
@keyframes slideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.filter-group { display: flex; flex-direction: column; gap: 6px; }
.filter-group-label { font-size: 10px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.6px; }
.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.filter-chip { padding: 5px 14px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #FFFFFF; border: 1.5px solid #D1D5DB; color: #6B7280; cursor: pointer; transition: all 0.18s ease; font-family: 'Kanit', sans-serif; line-height: 1.4; }
.filter-chip:hover { border-color: #6938EF; color: #6938EF; background: rgba(105,56,239,0.05); }
.filter-chip.active { background: #6938EF; border-color: #6938EF; color: #ffffff; box-shadow: 0 2px 8px rgba(105,56,239,0.30); }
.btn-reset-filters { padding: 6px 14px; background: transparent; border: 1.5px solid #E5E7EB; color: #9CA3AF; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer; align-self: flex-start; transition: all 0.2s; font-family: 'Kanit', sans-serif; }
.btn-reset-filters:hover { border-color: #D1D5DB; color: #6B7280; background: #F3F4F6; }

/* ============================================================
   10. MOBILE BOTTOM SHEET
   ============================================================ */
.drag-handle-zone {
  display: none;
}

@media (max-width: 768px) {
  .sidebar-control-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100vw;
    height: 100vh; /* We translate it down, so it needs to be tall */
    z-index: 9999;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -4px 24px rgba(62, 28, 150, 0.2);
    /* The transition is handled via Vue's :style inline for dragging, but we can add a fallback transition */
    transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
  }
  
  .sheet-state-PEEK {
    transform: translateY(80vh);
  }
  
  .sheet-state-HALF {
    transform: translateY(50vh);
  }
  
  .sheet-state-FULL {
    transform: translateY(0);
  }

  .drag-handle-zone {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 24px;
    background: #ffffff;
    border-radius: 20px 20px 0 0;
    cursor: grab;
    touch-action: none;
  }
  
  .drag-handle-pill {
    width: 40px;
    height: 5px;
    background: #e2e8f0;
    border-radius: 10px;
  }
  
  /* Adjust header border radius since drag handle is above it now */
  .sidebar-brand-header {
    padding-top: 10px;
  }
}

/* ============================================================
   14. ROUTE STATUS BANNERS
   ============================================================ */
.banner-warning,
.banner-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Kanit', sans-serif;
  line-height: 1.5;
  margin-bottom: 10px;
}

/* Red — route cannot reach destination */
.banner-warning {
  background: rgba(239, 68, 68, 0.12);
  border: 1.5px solid rgba(239, 68, 68, 0.35);
  color: #B91C1C;
}
.banner-warning svg { color: #EF4444; flex-shrink: 0; }

/* Amber — using generic safe EV profile */
.banner-info {
  background: rgba(245, 158, 11, 0.10);
  border: 1.5px solid rgba(245, 158, 11, 0.35);
  color: #92400E;
}
.banner-info svg { color: #F59E0B; flex-shrink: 0; }
/* ── Simulation Charging Overlay ────────────────────────────────────────── */
.sim-charging-overlay {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.2));
  border: 1px solid #10b981;
  border-radius: 12px;
  padding: 12px 20px;
  margin: 0 20px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15);
  animation: pulse-border 2s infinite;
}
@keyframes pulse-border {
  0% { border-color: rgba(16, 185, 129, 0.4); }
  50% { border-color: rgba(16, 185, 129, 1); box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3); }
  100% { border-color: rgba(16, 185, 129, 0.4); }
}
.charging-pulse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: #10b981;
  border-radius: 50%;
  color: white;
  animation: pulse-bg 1.5s infinite;
}
@keyframes pulse-bg {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}
.charging-text {
  display: flex;
  flex-direction: column;
}
.charging-text strong {
  font-size: 14px;
  color: #065f46;
}
.charging-text span {
  font-size: 24px;
  font-weight: 800;
  color: #059669;
  font-family: monospace;
}
</style>