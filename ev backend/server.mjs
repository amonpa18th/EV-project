import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import { exec } from "child_process";

// โหลดค่าจากไฟล์ .env (เช่น MONGODB_URI)
dotenv.config();

const app = express();
const httpServer = createServer(app);

// ตั้งค่า Socket.io ให้รองรับการเชื่อมต่อจากหน้าเว็บ
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ==========================================
// 1. เชื่อมต่อ MongoDB
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log(" MongoDB Connected"))
  .catch(err => console.error(" MongoDB Connection Error:", err));

// ==========================================
// 2. สร้าง Schema สำหรับสถานี PEA VOLTA
// ==========================================
const stationSchema = new mongoose.Schema({
  // Core Identification
  station_id: { type: String, unique: true, sparse: true }, // ใช้สำหรับ sync updates ในอนาคต
  name: { type: String, required: true },
  stationType: { 
    type: String, 
    required: true, 
    enum: ['HUB', 'CONNEXT', 'VOLTA'], 
    default: 'VOLTA' 
  },
  source: { type: String, required: true, enum: ['PEA_VOLTA'] },

  // Technical Specifications
  power_kw: { type: Number, required: true }, // กำลังชาร์จ (kW) - แทนที่ power เดิม
  chargerType: { type: String },              // 'DC' | 'AC'
  is_available: { type: Boolean, default: true },

  // GeoJSON Location (required for 2dsphere geospatial queries)
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },

  // Metadata จาก KML descriptions
  province: { type: String },
  address: { type: String },
  openingHours: { type: String },

}, { timestamps: true, strict: "throw" }); // strict:'throw' บล็อก field แปลกปลอม เช่น efficiency_rate

// สร้าง 2dsphere index เพื่อให้ระบบทำ Geospatial Query (หาระยะทาง) ได้เร็วมากๆ
stationSchema.index({ location: "2dsphere" });
stationSchema.index({ stationType: 1 }); // index สำหรับ filter ตามประเภทสถานี
const Station = mongoose.model("Station", stationSchema);

// ==========================================
// 3. API Routes
// ==========================================
app.get("/", (req, res) => {
  res.send("EV Backend & Socket.io Running");
});

// Endpoint เดิม แต่เปลี่ยนไปดึงข้อมูลจาก MongoDB แทนไฟล์ JSON
app.get("/stations", async (req, res) => {
  try {
    const stations = await Station.find({});
    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stations from Database" });
  }
});

// ==========================================
// Google Places Autocomplete & Details Proxies
// ==========================================
app.get("/api/places/autocomplete", async (req, res) => {
  try {
    const { input } = req.query;
    if (!input) {
      return res.status(400).json({ error: "Missing input query parameter" });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      // Gracefully signal to frontend to fall back to Nominatim
      return res.json({ fallback: true });
    }

    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=geocode|establishment&key=${apiKey}&language=th`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK") {
      const predictions = data.predictions.map(p => ({
        name: p.structured_formatting?.main_text || p.description,
        display_name: p.description,
        place_id: p.place_id
      }));
      res.json({ fallback: false, predictions });
    } else {
      console.warn("Google Places Autocomplete Status not OK:", data.status, data.error_message);
      res.json({ fallback: true });
    }
  } catch (err) {
    console.error("Google Places proxy error:", err);
    res.json({ fallback: true });
  }
});

app.get("/api/places/details", async (req, res) => {
  try {
    const { place_id } = req.query;
    if (!place_id) {
      return res.status(400).json({ error: "Missing place_id parameter" });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "Google API Key not configured" });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=geometry&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK" && data.result?.geometry?.location) {
      const loc = data.result.geometry.location;
      res.json({ lat: loc.lat, lon: loc.lng });
    } else {
      res.status(400).json({ error: `Details API returned status: ${data.status}` });
    }
  } catch (err) {
    console.error("Google Place Details proxy error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==========================================
// SoC-Aware Route Planning Service
// ==========================================
app.post("/api/route-plan", async (req, res) => {
  try {
    const { origin, destination, waypoints, vehicle, batterySOC } = req.body;
    
    if (!origin || !destination || !vehicle) {
      return res.status(400).json({ error: "Missing required fields (origin, destination, vehicle)" });
    }

    // ─── SEGMENTED MACRO-ROUTING (CHUNKING ENGINE) ────────────────────────────
    // OSRM disables alternatives=true when 3+ coordinates are in a single call.
    // Strategy: Split the journey into discrete Legs (Origin->WP1, WP1->WP2, ...
    // WPN->Destination). Fetch each Leg concurrently with alternatives=true.
    // Then perform a Cartesian Product splice to build synthetic Master Routes,
    // sort by driving duration, and cap at the Top 3 to prevent SoC overload.

    // 1. Build the ordered list of all pivot points
    const allPoints = [origin];
    if (waypoints && waypoints.length > 0) {
      waypoints.forEach(wp => allPoints.push(wp));
    }
    allPoints.push(destination);

    // 2. Build one OSRM fetch Promise per Leg
    const legFetches = [];
    for (let i = 0; i < allPoints.length - 1; i++) {
      const from = allPoints[i];
      const to   = allPoints[i + 1];
      const legUrl = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&alternatives=true`;
      legFetches.push(
        fetch(legUrl)
          .then(r => r.json())
          .then(data => {
            if (!data.routes || data.routes.length === 0) {
              throw new Error(`No OSRM routes found for leg ${i}: ${from} -> ${to}`);
            }
            return data.routes; // Array of route options for this leg
          })
      );
    }

    // 3. Fetch all legs concurrently
    const legResults = await Promise.all(legFetches);

    // 4. Cartesian Product — generate all possible Master Route combinations
    //    e.g. Leg A has [R1, R2], Leg B has [R1, R2]
    //    → 4 combinations: [A-R1+B-R1], [A-R1+B-R2], [A-R2+B-R1], [A-R2+B-R2]
    let masterCombinations = [[]]; // Start with one empty combo
    for (const legRoutes of legResults) {
      const expanded = [];
      for (const combo of masterCombinations) {
        for (const legRoute of legRoutes) {
          expanded.push([...combo, legRoute]);
        }
      }
      masterCombinations = expanded;
    }

    // 5. Splice each combination into a single synthetic OSRM-schema route object
    const syntheticRoutes = masterCombinations.map(combo => {
      let totalDistance = 0;
      let totalDuration = 0;
      let mergedCoords  = [];
      let distanceOffset = 0;

      // ── PER-LEG METADATA ────────────────────────────────────────────────────
      // Store each leg's raw coords + distance offset so the downstream
      // charging planner can run leg-by-leg without re-splitting the merged array.
      const legs = combo.map((legRoute, idx) => {
        const coords = legRoute.geometry.coordinates;
        const legDistanceKm = legRoute.distance / 1000;

        const legMeta = {
          coords,                    // [lon, lat][] — full OSRM geometry for this leg
          distanceKm: legDistanceKm,
          durationSecs: legRoute.duration,
          distanceOffsetKm: distanceOffset,  // cumulative km at start of this leg
          // The pivot point is the DESTINATION of this leg (= user waypoint or final dest)
          // allPoints[idx+1] is captured in closure from the outer scope
          pivotPoint: allPoints[idx + 1]     // [lat, lng] — used to insert waypoint node
        };

        distanceOffset += legDistanceKm;
        totalDistance  += legRoute.distance;
        totalDuration  += legRoute.duration;
        mergedCoords    = mergedCoords.concat(idx === 0 ? coords : coords.slice(1));

        return legMeta;
      });

      return {
        distance: totalDistance,
        duration: totalDuration,
        geometry: { type: "LineString", coordinates: mergedCoords },
        legs   // ← NEW: per-leg metadata for isolated charging planning
      };
    });

    // 6. Sort by total driving duration (fastest first)
    syntheticRoutes.sort((a, b) => a.duration - b.duration);

    // ─── GEOMETRIC DEDUPLICATION ─────────────────────────────────────────────
    // Filter out alternative routes that are physically too similar to a better route.
    // This prevents offering "Route 2" when it's just a 1km side-street detour.
    const finalRoutes = [];
    for (const candidate of syntheticRoutes) {
      if (finalRoutes.length >= 3) break;
      
      let isTooSimilar = false;
      const cCoords = candidate.geometry.coordinates;
      
      for (const accepted of finalRoutes) {
        const aCoords = accepted.geometry.coordinates;
        // Sample 4 checkpoints across the candidate route (20%, 40%, 60%, 80%)
        const fractions = [0.2, 0.4, 0.6, 0.8];
        let totalMinDist = 0;
        
        for (const frac of fractions) {
          const sampleIdx = Math.floor(cCoords.length * frac);
          const samplePt = cCoords[sampleIdx]; // [lng, lat]
          
          let closestDist = Infinity;
          // Step by 10 through accepted route for performance (OSRM points are very dense)
          for (let i = 0; i < aCoords.length; i += 10) {
            const dist = haversineDistance(
              [samplePt[1], samplePt[0]], 
              [aCoords[i][1], aCoords[i][0]]
            );
            if (dist < closestDist) closestDist = dist;
          }
          totalMinDist += closestDist;
        }
        
        const avgDeviation = totalMinDist / fractions.length;
        const durationDiffMins = Math.abs(candidate.duration - accepted.duration) / 60;
        
        // If they overlap spatially (avgDeviation < 1.5 km) AND take about the same time (< 3 mins diff),
        // it's a useless micro-detour (e.g., parallel local street). Drop it.
        // If duration difference is high (e.g., Tollway vs Ground road), KEEP IT!
        if (avgDeviation < 1.5 && durationDiffMins < 3.0) {
          isTooSimilar = true;
          break;
        }
      }
      
      if (!isTooSimilar) {
        finalRoutes.push(candidate);
      }
    }

    if (finalRoutes.length === 0) {
      return res.status(404).json({ error: "No routes found" });
    }

    // ─── BOUNDING BOX CALCULATION ─────────────────────────────────────────────
    // Downstream logic is completely unaware of the chunking above.
    // It simply receives finalRoutes, which perfectly mirrors OSRM schema.
    let allCoordinates = [];
    finalRoutes.forEach(r => {
      allCoordinates.push(...r.geometry.coordinates);
    });

    const lats = allCoordinates.map(c => c[1]);
    const lngs = allCoordinates.map(c => c[0]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // Fetch stations within bounding box expanded by a buffer (approx 5km = 0.05 degrees)
    const stations = await Station.find({
      "location.coordinates.1": { $gte: minLat - 0.05, $lte: maxLat + 0.05 },
      "location.coordinates.0": { $gte: minLng - 0.05, $lte: maxLng + 0.05 },
      "is_available": true
    }).lean();

    const stationCandidates = stations.map(s => ({
      id: s._id,
      name: s.name,
      stationType: s.stationType,
      power: s.power_kw || 50,
      chargerType: s.chargerType || "DC",
      address: s.address,
      province: s.province,
      coords: [s.location.coordinates[1], s.location.coordinates[0]] // [lat, lng]
    }));

    const routeOptions = [];

    // Process each synthetic Master Route — identical to how we processed native OSRM routes
    for (let index = 0; index < finalRoutes.length; index++) {
      const osrmRoute = finalRoutes[index];

      const routeCoords = osrmRoute.geometry.coordinates; // [ [lon, lat], ... ]
      const resolvedVehicle = resolveVehicleProfile(vehicle);

      // ── LEG-BY-LEG CHARGING ISOLATION ─────────────────────────────────────────
      // Process each leg independently so that:
      //   (a) stations on Leg B cannot be selected before the user waypoint is reached
      //   (b) the SoC state carries over naturally from leg to leg
      //
      // For single-leg routes (no waypoints), osrmRoute.legs has exactly 1 entry,
      // so this loop is a clean no-op replacement of the old single call.
      const hasLegs = osrmRoute.legs && osrmRoute.legs.length > 1;

      let carryOverSoC = parseFloat(batterySOC);
      const allIntermediatePoints = [];
      const allChargingStops      = [];
      let   totalChargeTimeMins   = 0;
      let   routeIsIncomplete     = false;
      let   masterCumulativeDistance = null; // built once for the full merged route

      if (hasLegs) {
        let runningHaversineOffset = 0; // Rolling offset using internal 2D math
        // ── MULTI-LEG (waypoints present) ───────────────────────────────────────
        for (let legIdx = 0; legIdx < osrmRoute.legs.length; legIdx++) {
          const leg = osrmRoute.legs[legIdx];
          const isLastLeg = legIdx === osrmRoute.legs.length - 1;

          // Only consider stations that fall within THIS leg's geography
          const legStationsOnRoute = findStationsNearRoute(
            leg.coords,
            stationCandidates,
            15.0
          );

          const legPlan = planChargingStops({
            routeCoords:    leg.coords,
            stationsOnRoute: legStationsOnRoute,
            vehicle:        resolvedVehicle,
            startingSoC:    carryOverSoC,
            trueLegDistanceKm: leg.distanceKm,
            legDurationSecs: leg.durationSecs
          });

          // Offset this leg's stop distances by how far we've driven on prior legs
          legPlan.chargingStops.forEach(stop => {
            const absoluteKm = runningHaversineOffset + stop.absoluteDistanceKm;
            allChargingStops.push({ ...stop, absoluteDistanceKm: absoluteKm });
            allIntermediatePoints.push({
              type: 'charge',
              name: stop.name,
              chargeTimeMins: stop.chargeTimeMins,
              coords: stop.coords,
              absoluteDistanceKm: absoluteKm
            });
          });

          totalChargeTimeMins += legPlan.totalChargeTimeMins;
          if (legPlan.is_incomplete) routeIsIncomplete = true;

          // SoC carry-over: the vehicle departs the leg at the finalSoC returned
          // by planChargingStops (which accounts for the charge + drive to end of leg)
          carryOverSoC = Math.max(0, legPlan.finalSoC); // Prevent negative propagation

          const haversineLegKm = legPlan.cumulativeDistance[legPlan.cumulativeDistance.length - 1];

          // Insert the user waypoint node at the END of this leg (before the next begins)
          // The pivot point is the physical endpoint of this leg (= user's waypoint location)
          if (!isLastLeg) {
            allIntermediatePoints.push({
              type: 'waypoint',
              coords: leg.pivotPoint,       // [lat, lng] — the user waypoint
              absoluteDistanceKm: runningHaversineOffset + haversineLegKm
            });
          }

          runningHaversineOffset += haversineLegKm;

          // SHORT-CIRCUIT: Do not waste CPU on Leg B if vehicle starved on Leg A
          if (routeIsIncomplete) break;
        }

        // Build master cumulativeDistance for the full merged route (needed for distanceToDestinationKm)
        masterCumulativeDistance = [0];
        for (let i = 1; i < routeCoords.length; i++) {
          const d = haversineDistance(routeCoords[i-1], routeCoords[i]);
          masterCumulativeDistance.push(masterCumulativeDistance[i-1] + d);
        }

      } else {
        // ── SINGLE-LEG (no waypoints) — original behaviour, unchanged ───────────
        const stationsOnRoute = findStationsNearRoute(routeCoords, stationCandidates, 15.0);
        const plan = planChargingStops({
          routeCoords,
          stationsOnRoute,
          vehicle:    resolvedVehicle,
          startingSoC: batterySOC,
          trueLegDistanceKm: osrmRoute.distance / 1000
        });

        plan.chargingStops.forEach(stop => {
          allChargingStops.push(stop);
          allIntermediatePoints.push({
            type: 'charge',
            name: stop.name,
            chargeTimeMins: stop.chargeTimeMins,
            coords: stop.coords,
            absoluteDistanceKm: stop.absoluteDistanceKm
          });
        });

        totalChargeTimeMins   = plan.totalChargeTimeMins;
        routeIsIncomplete     = plan.is_incomplete || false;
        carryOverSoC          = plan.finalSoC;
        masterCumulativeDistance = plan.cumulativeDistance;
      }

      // Optional stops (only for zero-stop short trips — uses full merged route)
      let optionalStops = [];
      if (allChargingStops.length === 0) {
        const allStationsOnRoute = findStationsNearRoute(routeCoords, stationCandidates, 15.0);
        if (allStationsOnRoute.length > 0) {
          optionalStops = rankOptionalStops(allStationsOnRoute, routeCoords);
        }
      }

      // allIntermediatePoints is already in insertion order (legs processed sequentially,
      // waypoints inserted at leg boundaries) — sort is a safety net for floating-point ties
      allIntermediatePoints.sort((a, b) => a.absoluteDistanceKm - b.absoluteDistanceKm);

      const totalRouteKm = masterCumulativeDistance[masterCumulativeDistance.length - 1];
      const lastStopKm   = allChargingStops.length > 0
        ? allChargingStops[allChargingStops.length - 1].absoluteDistanceKm
        : 0;

      routeOptions.push({
        routeIndex:              index,
        distanceKm:              parseFloat((osrmRoute.distance / 1000).toFixed(1)),
        drivingDurationMins:     Math.round(osrmRoute.duration / 60),
        totalDurationMins:       Math.round(osrmRoute.duration / 60) + totalChargeTimeMins,
        stopsRequired:           allChargingStops.length,
        chargingStops:           allChargingStops,
        orderedWaypoints:        allIntermediatePoints,
        optionalStops,
        breakdown:               buildBreakdown(allIntermediatePoints, routeIsIncomplete),
        distanceToDestinationKm: Math.round(totalRouteKm - lastStopKm),
        is_incomplete:           routeIsIncomplete,
        usingGenericFallback:    resolvedVehicle._isGenericFallback || false,
        geometry:                osrmRoute.geometry
      });
    }

    res.json(routeOptions);
  } catch (err) {
    console.error("Route planning error:", err);
    res.status(500).json({ error: "Internal server error during route planning" });
  }
});

// ==========================================
// Helper Algorithms
// ==========================================

function buildBreakdown(orderedWaypoints, isIncomplete) {
  const result = ["จุดเริ่มต้น"];
  orderedWaypoints.forEach(wp => {
    if (wp.type === 'charge') {
      result.push(`${wp.name} (ชาร์จ ${wp.chargeTimeMins} น.)`);
    } else {
      result.push(`จุดแวะพัก`);
    }
  });
  result.push(isIncomplete ? "ไม่สามารถไปถึงจุดหมายได้ (Unreachable)" : "จุดหมายปลายทาง");
  return result;
}

// ─── Generic Safe EV Profile ───────────────────────────────────────────────
// Used when a vehicle is not in the database or has corrupted specs.
// 50 kWh / 350 km → 142 Wh/km baseline. Conservative but not over-penalising.
const GENERIC_SAFE_EV = {
  id: "__generic_safe__",
  brand: "Unknown EV",
  model: "Generic Safe Profile",
  battery_kwh: 50,
  range_km: 350,
  max_charge_power_kw: 50,
  _isGenericFallback: true
};

/**
 * Resolves the vehicle to use for routing.
 * Falls back to GENERIC_SAFE_EV if data is missing or invalid.
 */
function resolveVehicleProfile(vehicle) {
  if (!vehicle) {
    console.warn("[RouteEngine] No vehicle supplied — using GENERIC_SAFE_EV");
    return GENERIC_SAFE_EV;
  }
  const kwh = parseFloat(vehicle.battery_kwh);
  const km  = parseFloat(vehicle.range_km);
  if (!kwh || !km || kwh <= 0 || km <= 0 || isNaN(kwh) || isNaN(km)) {
    console.warn(`[RouteEngine] Invalid vehicle profile for "${vehicle.id || 'unknown'}" — using GENERIC_SAFE_EV`);
    return GENERIC_SAFE_EV;
  }
  return vehicle;
}

function planChargingStops({ routeCoords, stationsOnRoute, vehicle, startingSoC, trueLegDistanceKm, legDurationSecs }) {
  
  const batteryKwh = parseFloat(vehicle.battery_kwh);
  const rangeKm    = parseFloat(vehicle.range_km);

  const BASE_RATE       = batteryKwh / rangeKm;
  
  // ── U-Curve Speed Heuristic ───────────────────────────────────────────────
  // Default speed fallback if duration is zero
  const legSpeedKmh = legDurationSecs ? trueLegDistanceKm / (legDurationSecs / 3600) : 60;
  
  let consumptionMultiplier = 1.0;
  if (legSpeedKmh > 90) {
    // Highway Speed Penalty (Aerodynamic Drag)
    // E.g., at 120 km/h: 1.0 + ((120 - 90)/40)^2 = 1.0 + (0.75)^2 = 1.56x
    consumptionMultiplier = 1.0 + Math.pow((legSpeedKmh - 90) / 40, 2);
  } else if (legSpeedKmh < 30) {
    // Traffic / City Penalty (HVAC & Electronics overhead dominates)
    // E.g., at 15 km/h, flat 1.15x overhead
    consumptionMultiplier = 1.15;
  } else {
    // Optimal Speed (40-70 km/h) — close to WLTP rating
    consumptionMultiplier = 1.0;
  }
  
  // Cap the multiplier between 0.8 and 2.5 for safety
  consumptionMultiplier = Math.max(0.8, Math.min(2.5, consumptionMultiplier));
  const consumptionRate = BASE_RATE * consumptionMultiplier;

  // ─── Scoring Window Constants ─────────────────────────────────────────────
  // EVALUATION_WINDOW_START: Begin proactively scouting for convenient stations
  //   when SoC drops below this level. Set deliberately high so the algorithm
  //   can find highway stations BEFORE the battery hits a critical floor.
  const EVALUATION_WINDOW_START = 55.0;  // Start looking at 55% SoC
  const MIN_ARRIVAL_SOC         = 20.0;  // Hard safety floor — never arrive below this
  const DEPARTURE_SOC           = 80.0;  // Never charge above 80% at intermediate stops

  // ─── Scoring Weights ──────────────────────────────────────────────────────
  // These weights determine what makes a "good" charging stop:
  //   CONVENIENCE (detour distance) is the #1 priority.
  //   A highway station at 500m deviation that stops you at 45% beats a mall
  //   station at 8km deviation that stops you at 22%.
  const W_CONVENIENCE = 0.60;  // Proximity to route polyline (lower detour = better)
  const W_POWER       = 0.20;  // Charger power (faster = better)
  const W_PROGRESS    = 0.20;  // How far we've driven since last stop (further = better)

  // ─── Route Node Preprocessing ─────────────────────────────────────────────
  const cumulativeDistance = [0];
  for (let i = 1; i < routeCoords.length; i++) {
    const d = haversineDistance(routeCoords[i-1], routeCoords[i]);
    cumulativeDistance.push(cumulativeDistance[i-1] + d);
  }
  const totalRouteKm = cumulativeDistance[cumulativeDistance.length - 1];

  // Calculate a scaling factor to stretch the straight-line Haversine distance 
  // to perfectly match the true OSRM road spline distance.
  const haversineScalingFactor = trueLegDistanceKm ? (trueLegDistanceKm / totalRouteKm) : 1.0;

  // Associate each station with its closest node index on the polyline
  const stationsWithIndex = stationsOnRoute.map(station => {
    let closestIndex = 0;
    let minDist = Infinity;
    for (let i = 0; i < routeCoords.length; i++) {
      const dist = haversineDistance(
        [station.coords[1], station.coords[0]], // [lon, lat]
        routeCoords[i]
      );
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }
    return { ...station, routeIndex: closestIndex };
  });

  stationsWithIndex.sort((a, b) => a.routeIndex - b.routeIndex);

  // ─── SoC Simulation ───────────────────────────────────────────────────────
  let currentSoC     = parseFloat(startingSoC);
  let lastStopKm     = 0;
  let lastStopIndex  = 0;
  const recommendedStops  = [];
  let totalChargeTimeMins = 0;
  let is_incomplete       = false;

  // Track whether we've already committed to a stop in the current window
  // to prevent re-triggering immediately after resuming from a station.
  let windowActive = false;

  for (let i = 1; i < routeCoords.length; i++) {
    const distStep   = cumulativeDistance[i] - cumulativeDistance[i - 1];
    // Scale the segment distance to account for winding road spline geometry
    const trueRoadDistStep = distStep * haversineScalingFactor;
    const energyUsed = trueRoadDistStep * consumptionRate;
    const socDrop    = (energyUsed / batteryKwh) * 100;

    currentSoC -= socDrop;

    // ── HARD CEILING GATE ────────────────────────────────────────────────────
    // If the battery is above the evaluation window, do absolutely nothing.
    // This is the PRIMARY guard against phantom charges after a fresh 80% top-up.
    if (currentSoC > EVALUATION_WINDOW_START) continue;

    // ── Proactive vs Critical ────────────────────────────────────────────────
    // isCritical: we MUST stop — no wiggle room at all.
    // inEvaluationWindow: we are in the scouting phase — may commit if a
    //   truly convenient station exists; otherwise keep driving.
    const isCritical = currentSoC < MIN_ARRIVAL_SOC;

    // Avoid re-triggering the full scoring on every node inside the window.
    // We only run once when the window first opens (windowActive=false),
    // and then again only if we consciously cleared the flag.
    if (windowActive && !isCritical) continue;
    windowActive = true;

    // ── Candidate Discovery ──────────────────────────────────────────────────
    const lookaheadNodes = isCritical
      ? routeCoords.length - 1            // emergency: look at entire remaining route
      : Math.min(routeCoords.length - 1, i + 300); // proactive: generous lookahead

    let candidates = stationsWithIndex.filter(
      s => s.routeIndex > lastStopIndex && s.routeIndex <= lookaheadNodes
    );

    if (candidates.length === 0) {
      if (isCritical) {
        console.warn(`[RouteEngine] No reachable station at km ${Math.round(cumulativeDistance[i])}. Marking route incomplete.`);
        is_incomplete = true;
        break;
      }
      // No candidates visible yet in the proactive window — keep driving
      windowActive = false;
      continue;
    }

    // ── Score Each Candidate ─────────────────────────────────────────────────
    const departureSoCAtLastStop = lastStopIndex === 0
      ? parseFloat(startingSoC)
      : DEPARTURE_SOC;

    const scoredCandidates = candidates.map(station => {
      const distToStation   = cumulativeDistance[station.routeIndex] - lastStopKm;
      const energyToStation = distToStation * consumptionRate;
      const arrivalSoC      = departureSoCAtLastStop - (energyToStation / batteryKwh * 100);

      // ── ANTI-PARANOIA GATE (applied per-candidate, before scoring) ─────────
      // STRICT RULE: Never stop if arrival SoC > 55%. This prevents "time-traveling"
      // backwards to pick a station we passed long before the evaluation window opened.
      if (arrivalSoC > 55) return null;

      // If we would arrive with more than 50% battery, this stop is generally wasteful.
      // Skip it UNLESS the battery will go critical without stopping.
      if (!isCritical && arrivalSoC > 50) return null;

      // Unreachable station (would arrive below safety floor)
      if (arrivalSoC < MIN_ARRIVAL_SOC - 5) return null;

      const detourKm = station.distanceToRoute || 0;

      // Convenience Score: 0.0 (15km off-road) → 1.0 (perfectly on route)
      const convenienceScore = Math.max(0, 1.0 - Math.pow(detourKm / 15.0, 0.8));

      // Power Score: 0.0 (11kW) → 1.0 (≥120kW)
      const powerScore = Math.min(1.0, (station.power || 50) / 120);

      // Progress Score: prefer stations further down the road
      const progressScore = (totalRouteKm - lastStopKm) === 0 ? 0 : distToStation / (totalRouteKm - lastStopKm);

      const totalScore = (W_CONVENIENCE * convenienceScore)
                       + (W_POWER       * powerScore)
                       + (W_PROGRESS    * progressScore);

      return { ...station, arrivalSoC, detourKm, totalScore };
    }).filter(Boolean);

    if (scoredCandidates.length === 0) {
      // All candidates were filtered by anti-paranoia or unreachability.
      // If not critical, keep driving — a better station may appear later.
      if (isCritical) {
        is_incomplete = true;
        break;
      }
      windowActive = false; // Re-open evaluation on the next SoC dip
      continue;
    }

    // ── Select the Best Stop ──────────────────────────────────────────────────
    scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
    const bestStop = scoredCandidates[0];
    
    // Convenience gate: in proactive mode, only commit to stations that are
    // genuinely close to the highway. If everything is too far, keep driving.
    if (!isCritical && bestStop.detourKm > 3.0) {
      windowActive = false; // Re-open for the next SoC level
      continue;
    }

    // ── Commit to this Stop ───────────────────────────────────────────────────
    const chargePower    = bestStop.power || 50;
    const energyNeeded   = ((DEPARTURE_SOC - Math.max(0, bestStop.arrivalSoC)) / 100) * batteryKwh;
    const chargeTimeHrs  = energyNeeded / chargePower;
    const chargeTimeMins = Math.round(chargeTimeHrs * 60) + 5;

    recommendedStops.push({
      name:                   bestStop.name,
      power:                  bestStop.power,
      chargerType:            bestStop.chargerType,
      coords:                 bestStop.coords,
      arrivalSoC:             Math.max(0, Math.round(bestStop.arrivalSoC)),
      departureSoC:           DEPARTURE_SOC,
      chargeTimeMins:         Math.max(5, chargeTimeMins),
      distanceFromPreviousKm: Math.round(cumulativeDistance[bestStop.routeIndex] - lastStopKm),
      absoluteDistanceKm:     cumulativeDistance[bestStop.routeIndex],
      detourKm:               Math.round(bestStop.detourKm * 10) / 10
    });

    totalChargeTimeMins += chargeTimeMins;

    // ── COMPLETE STATE WIPE after commit ─────────────────────────────────────
    // Every flag and counter must be reset explicitly here to prevent any
    // leakage into the next iteration of the loop.
    lastStopKm    = cumulativeDistance[bestStop.routeIndex];
    lastStopIndex = bestStop.routeIndex;
    currentSoC    = DEPARTURE_SOC;     // HARD reset to 80%
    i             = bestStop.routeIndex; // Rewind cursor to station position
    windowActive  = false;             // Re-arm the scouting window
    // The loop's i++ will move us to the node AFTER the station,
    // and the hard ceiling gate (currentSoC > EVALUATION_WINDOW_START)
    // will immediately skip all nodes until battery drops below 55% again.
  }

  const distanceToDestinationKm = Math.round(totalRouteKm - lastStopKm);

  const breakdown = ["จุดเริ่มต้น"];
  recommendedStops.forEach(stop => {
    breakdown.push(`${stop.name} (ชาร์จ ${stop.chargeTimeMins} น.)`);
  });
  breakdown.push(is_incomplete ? "⚠️ ไม่สามารถไปถึงจุดหมายได้" : "จุดหมายปลายทาง");

  return {
    chargingStops: recommendedStops,
    cumulativeDistance,
    totalChargeTimeMins,
    breakdown,
    distanceToDestinationKm,
    finalSoC: Math.round(currentSoC),
    is_incomplete
  };
}


// Ranks on-route stations for short trips where no mandatory charging stop is needed.
// Scoring is a weighted combination of:
//   - Power     (40%): Faster charger = higher score.
//   - Deviation (30%): Closer to the road = higher score.
//   - Progress  (30%): Stations in the second half of the trip score higher,
//                      since they serve as natural rest/top-up points on arrival.
// Returns the top 3 highest-scoring stations, without the internal score field.
function rankOptionalStops(stationsOnRoute, routeCoords, maxResults = 3) {
  const routeLength = routeCoords.length;

  const scored = stationsOnRoute.map(station => {
    // Find the index of the closest route coordinate to this station (for progress score)
    let closestIndex = 0;
    let minDist = Infinity;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = haversineDistance(
        [station.coords[1], station.coords[0]], // station is [lat, lng] → swap to [lon, lat] for haversine
        routeCoords[i]                          // routeCoords are [lon, lat]
      );
      if (d < minDist) { minDist = d; closestIndex = i; }
    }

    // Power score: normalised to [0, 1] with 300 kW as ceiling
    const powerScore = Math.min(1.0, (station.power_kw || 50) / 300);

    // Deviation score: linear falloff from 0 km (1.0) to 4 km (0.0)
    const deviationScore = Math.max(0, 1 - (station.distanceToRoute || 0) / 4.0);

    // Progress score: proportion of the route already covered at this station
    const progressScore = routeLength > 1 ? closestIndex / (routeLength - 1) : 0;

    const score = powerScore * 0.40 + deviationScore * 0.30 + progressScore * 0.30;

    return {
      name: station.name,
      power_kw: station.power_kw,
      chargerType: station.chargerType,
      coords: station.coords,   // [lat, lng] — already in correct format
      province: station.province,
      score
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // Strip internal score field before returning to the frontend
  return scored.slice(0, maxResults).map(({ score: _score, ...rest }) => rest);
}

function findStationsNearRoute(routeCoords, stations, maxDistanceKm = 4.0) {
  const matched = [];
  stations.forEach(station => {
    if (!station.coords || station.coords.length < 2) return;
    let minDistance = Infinity;
    const step = Math.min(10, Math.max(1, Math.floor(routeCoords.length / 120))); // FIX (Phase 1): Cap step at 10 to prevent skipping >1km of road on long routes
    for (let i = 0; i < routeCoords.length; i += step) {
      const dist = haversineDistance(
        [station.coords[1], station.coords[0]],
        routeCoords[i]
      );
      if (dist < minDistance) {
        minDistance = dist;
      }
      // NO break — always scan all sampled nodes to find the GLOBAL minimum distance.
      // The premature break was causing correctly on-route stations to be scored as
      // if they were 3–4 km off-road when their true minimum was at a later node.
    }
    if (minDistance < maxDistanceKm) {
      matched.push({
        ...station,
        distanceToRoute: minDistance
      });
    }
  });
  return matched;
}

function haversineDistance(coords1, coords2) {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ==========================================
// 4. Socket.io Real-time Events & Cronjob
// ==========================================
io.on("connection", (socket) => {
  console.log("User/Worker connected to Socket:", socket.id);

  // 1. รอรับสัญญาณจาก convert.mjs
  socket.on("trigger-update", () => {
    console.log("ได้รับสัญญาณ: ฐานข้อมูลเพิ่งอัปเดตใหม่ กำลังส่งต่อให้หน้าเว็บ...");
    io.emit("stations-updated"); // กระจายข่าวบอกหน้าเว็บทุกเครื่องให้รีเฟรชหมุด
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// 2. ตั้งเวลา (Cronjob) ให้รัน convert.mjs อัตโนมัติทุกๆ 1 ชั่วโมง
cron.schedule("0 * * * *", () => {
  console.log(" [Cronjob] เริ่มต้นกระบวนการอัปเดตข้อมูลสถานีอัตโนมัติ...");
  exec("node convert.mjs", (error, stdout, stderr) => {
    if (error) {
      console.error(` Cronjob Error: ${error.message}`);
      return;
    }
    console.log(`Cronjob ทำงานสำเร็จ:\n${stdout}`);
  });
});


const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});