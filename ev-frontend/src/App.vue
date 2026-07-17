<template>
  <div class="app-layout-container">
    
    <SidebarControl />

    <div class="map-view-panel">
      <MapArea />
    </div>

  </div>
</template>

<script setup>
// สั่ง Import ตัว Sidebar และ MapArea เข้ามาใช้งานในหน้านี้
import SidebarControl from './components/SidebarControl.vue';
import MapArea from './components/MapArea.vue';
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap');

/* จัดโครงสร้างหน้าจอใหญ่ให้แบ่งฝั่งซ้าย-ขวา */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: 'Kanit', sans-serif;
}

.app-layout-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* ดันให้ฝั่งขวา (แผนที่) ขยายกินพื้นที่ที่เหลือทั้งหมด */
.map-view-panel {
  flex: 1;
  height: 100vh;
}
</style>