// Automated Stress Test for Leg-by-Leg architecture

const API_URL = 'http://localhost:3000/api/route-plan';

const cases = [
  {
    name: "1. The Shared Pivot Boundary Test",
    payload: {
      origin: [13.7563, 100.5018], // Bangkok
      waypoints: [[15.6991, 100.1206]], // Nakhon Sawan
      destination: [18.7883, 98.9853], // Chiang Mai
      vehicle: { battery_kwh: 60, range_km: 400 },
      batterySOC: 80
    },
    assert: (route) => {
      const waypoints = route.orderedWaypoints || [];
      // Check for zero duplicate charging sequences near Nakhon Sawan (approx 230-260km)
      const chargeStops = waypoints.filter(wp => wp.type === 'charge');
      const uniqueNames = new Set(chargeStops.map(s => s.name || s.coords.toString()));
      return uniqueNames.size === chargeStops.length && chargeStops.length > 0;
    }
  },
  {
    name: "2. The Desert Gap / Starvation Test",
    payload: {
      origin: [10.4930, 99.1800], // Chumphon
      waypoints: [[9.9652, 98.6348]], // Ranong
      destination: [7.8804, 98.3923], // Phuket
      vehicle: { battery_kwh: 40, range_km: 250 },
      batterySOC: 40
    },
    assert: (route) => {
      return route.is_incomplete === true;
    }
  },
  {
    name: "3. The Dense Urban Grid Test",
    payload: {
      origin: [13.7268, 100.5112], // ICONSIAM
      waypoints: [[13.7462, 100.5398]], // CentralWorld
      destination: [13.6467, 100.6792], // Mega Bangna
      vehicle: { battery_kwh: 70, range_km: 500 },
      batterySOC: 60
    },
    assert: (route) => {
      const chargeStops = (route.orderedWaypoints || []).filter(wp => wp.type === 'charge');
      return chargeStops.length === 0 && !route.is_incomplete;
    }
  },
  {
    name: "4. The Multi-Leg Hyper-Long Haul (3-Leg Matrix)",
    payload: {
      origin: [7.0097, 100.4705], // Hatyai
      waypoints: [[9.1401, 99.3331], [13.7563, 100.5018]], // Surat Thani -> Bangkok
      destination: [18.7883, 98.9853], // Chiang Mai
      vehicle: { battery_kwh: 75, range_km: 500 },
      batterySOC: 80
    },
    assert: (route) => {
      // Check absolute chronological sorting
      const wps = route.orderedWaypoints || [];
      for (let i = 1; i < wps.length; i++) {
        if (wps[i].absoluteDistanceKm < wps[i-1].absoluteDistanceKm) {
          return false; // Out of order!
        }
      }
      return wps.length > 5; // Should be a long trip with many stops + waypoints
    }
  }
];

async function runTest() {
  console.log("=========================================");
  console.log("🚀 EV ROUTE PLANNER - STRESS TEST SUITE");
  console.log("=========================================\n");

  const results = [];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    console.log(`[TEST ${i+1}] ${testCase.name}`);
    
    const startMem = process.memoryUsage().heapUsed;
    const startTime = performance.now();
    
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testCase.payload)
      });
      
      const endTime = performance.now();
      const endMem = process.memoryUsage().heapUsed;
      
      const timeMs = (endTime - startTime).toFixed(2);
      const memDiffMb = ((endMem - startMem) / 1024 / 1024).toFixed(2);
      
      if (!res.ok) {
        console.error(`  ❌ HTTP ERROR: ${res.status} ${res.statusText}`);
        results.push({ name: testCase.name, status: "FAIL", time: timeMs, mem: memDiffMb });
        continue;
      }
      
      const routes = await res.json();
      const primaryRoute = routes[0]; // Assert against the fastest returned route
      
      if (!primaryRoute) {
        console.error(`  ❌ ERROR: No routes returned`);
        results.push({ name: testCase.name, status: "FAIL", time: timeMs, mem: memDiffMb });
        continue;
      }

      const passed = testCase.assert(primaryRoute);
      
      if (passed) {
        console.log(`  ✅ PASS | Time: ${timeMs}ms | Mem Spike: ${memDiffMb}MB`);
        results.push({ name: testCase.name, status: "PASS", time: timeMs, mem: memDiffMb });
      } else {
        console.log(`  ❌ ASSERTION FAILED | Time: ${timeMs}ms`);
        console.log(`     Data: stopsRequired=${primaryRoute.stopsRequired}, is_incomplete=${primaryRoute.is_incomplete}`);
        console.log(`     Waypoints: ${JSON.stringify(primaryRoute.orderedWaypoints.map(w => w.type + " " + Math.round(w.absoluteDistanceKm) + "km"))}`);
        results.push({ name: testCase.name, status: "FAIL", time: timeMs, mem: memDiffMb });
      }
      
    } catch (err) {
      console.error(`  ❌ FATAL ERROR: ${err.message}`);
      results.push({ name: testCase.name, status: "FAIL", error: err.message });
    }
    console.log("");
  }
  
  console.log("=========================================");
  console.log("📊 FINAL MATRIX");
  console.log("=========================================");
  console.table(results);
}

runTest();
