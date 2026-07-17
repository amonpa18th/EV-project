<template>
  <div class="app-layout-container">
    <SidebarControl @trigger-route="handleRouteCalculation" />

    <div class="map-view-panel">
      <MapArea :route-payload="currentRoutePayload" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import SidebarControl from './components/SidebarControl.vue';
import MapArea from './components/MapArea.vue';

// ตัวแปรเก็บข้อมูลเส้นทางที่ส่งมาจาก Sidebar
const currentRoutePayload = ref(null);

// ฟังก์ชันรับข้อมูลจาก Sidebar แล้วส่งต่อ
const handleRouteCalculation = (payload) => {
  currentRoutePayload.value = payload;
};
</script>

<style>
/* จัดโครงสร้างหน้าจอใหญ่ให้แบ่งฝั่งซ้าย-ขวา */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.app-layout-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.map-view-panel {
  flex: 1;
  height: 100vh;
}
</style>