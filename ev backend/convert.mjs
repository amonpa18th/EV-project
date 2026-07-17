import fs from "fs";
import { XMLParser } from "fast-xml-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { io } from "socket.io-client";
import crypto from "crypto";

dotenv.config();

// ==========================================
// 1. เชื่อมต่อ MongoDB
// ==========================================
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/ev-database";
await mongoose.connect(mongoUri)
  .then(() => console.log("🌱 [convert.mjs] Connected to MongoDB..."))
  .catch(err => { console.error(err); process.exit(1); });

// ==========================================
// 2. Schema (ต้องตรงกับ server.mjs)
// ==========================================
const stationSchema = new mongoose.Schema({
  station_id: { type: String, unique: true, sparse: true },
  name: { type: String, required: true },
  stationType: {
    type: String,
    required: true,
    enum: ['HUB', 'CONNEXT', 'VOLTA'],
    default: 'VOLTA'
  },
  source: { type: String, required: true, enum: ['PEA_VOLTA'] },
  power_kw: { type: Number, required: true },
  chargerType: { type: String },
  is_available: { type: Boolean, default: true },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  province: { type: String },
  address: { type: String },
  openingHours: { type: String },
}, { collection: 'stations', timestamps: true, strict: "throw" });

stationSchema.index({ location: "2dsphere" });
stationSchema.index({ stationType: 1 });
const Station = mongoose.models.Station || mongoose.model("Station", stationSchema);

// ==========================================
// 3. ฟังก์ชัน Map folderName -> stationType
// ==========================================
function resolveStationType(folderName) {
  const upper = folderName.toUpperCase();
  if (upper.includes("HUB"))     return "HUB";
  if (upper.includes("CONNEXT")) return "CONNEXT";
  return "VOLTA";
}

// ==========================================
// 4. Fallback Power (kW) ตาม stationType
// หาก Folder ไม่มีตัวเลข kW ระบุไว้ชัดเจน
// ==========================================
const POWER_FALLBACK = {
  HUB:     120,
  CONNEXT: 50,
  VOLTA:   50,
};

// ==========================================
// 5. Parse KML ด้วย fast-xml-parser
// ==========================================
const xml = fs.readFileSync("./data/doc.kml", "utf8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => ["Folder", "Placemark"].includes(tagName), // บังคับให้เป็น Array เสมอ
});

const parsed = parser.parse(xml);
const folders = parsed?.kml?.Document?.Folder || [];

const stationsToInsert = [];
const rejectedStations  = [];

let rawCount = 0;

folders.forEach(folder => {
  const folderName = (typeof folder.name === "string" ? folder.name : folder.name?.toString() || "").trim();
  const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : folder.Placemark ? [folder.Placemark] : [];

  // — Map สถานี PEA —
  const stationType = resolveStationType(folderName);
  const chargerType = folderName.toUpperCase().includes("DC") ? "DC"
                    : folderName.toUpperCase().includes("AC") ? "AC"
                    : "DC"; // PEA VOLTA ทุก Folder เป็น DC เป็นหลัก

  // ดึง power จาก folderName ("120 kW", "50 kW (1)" ฯลฯ)
  const powerMatch  = folderName.match(/(\d+)\s*kW/i);
  const folderPower = powerMatch ? Number(powerMatch[1]) : null;

  placemarks.forEach(place => {
    rawCount++;

    const name        = typeof place.name === "string" ? place.name.trim() : String(place.name || "").trim();
    const description = typeof place.description === "string" ? place.description : "";
    const coordText   = place.Point?.coordinates?.toString().trim() || "";

    if (!coordText) {
      rejectedStations.push({ reason: "missing coordinates", name, folderName });
      return;
    }

    const [lngStr, latStr] = coordText.split(",");
    const lng = parseFloat(lngStr);
    const lat = parseFloat(latStr);

    if (isNaN(lng) || isNaN(lat) || lat === 0 || lng === 0) {
      rejectedStations.push({ reason: "invalid coordinates", name, coordText });
      return;
    }

    // — ดึง Metadata จาก description HTML —
    const provinceMatch    = description.match(/จังหวัด:\s*(.*?)<br>/);
    const addressMatch     = description.match(/ที่อยู่.*?:\s*(.*?)<br>/);
    const openMatch        = description.match(/เวลาทำการ:\s*(.*?)<br>/);

    const province     = provinceMatch?.[1]?.trim()  || "";
    const address      = addressMatch?.[1]?.trim()   || "";
    const openingHours = openMatch?.[1]?.trim()      || "";

    // — กำลังไฟ: ดึงจาก Folder ก่อน ถ้าไม่มีใช้ Fallback ตาม stationType —
    const power_kw = folderPower ?? POWER_FALLBACK[stationType];

    // — สร้าง station_id แบบ deterministic จาก name + coordinates —
    const station_id = crypto
      .createHash("sha1")
      .update(`${name}|${lng}|${lat}`)
      .digest("hex")
      .slice(0, 16);

    stationsToInsert.push({
      station_id,
      name,
      stationType,
      source: "PEA_VOLTA",
      power_kw,
      chargerType,
      is_available: true,
      location: { type: "Point", coordinates: [lng, lat] },
      province,
      address,
      openingHours,
    });
  });
});

// ==========================================
// 6. บันทึกลง MongoDB
// ==========================================
console.log(`📋 Raw placemarks: ${rawCount}`);
console.log(`✅ Valid stations: ${stationsToInsert.length}`);
console.log(`❌ Rejected:       ${rejectedStations.length}`);

try {
  // ลบเฉพาะ PEA_VOLTA records เพื่อไม่กระทบ collection อื่น
  await Station.deleteMany({ source: "PEA_VOLTA" });

  if (stationsToInsert.length > 0) {
    await Station.insertMany(stationsToInsert, { ordered: false });
  }

  // สรุปผลตาม stationType
  const typeCounts = stationsToInsert.reduce((acc, s) => {
    acc[s.stationType] = (acc[s.stationType] || 0) + 1;
    return acc;
  }, {});
  console.log("📊 Breakdown by stationType:", typeCounts);

  // เขียน JSON cache
  fs.writeFileSync("./data/stations.json", JSON.stringify(stationsToInsert, null, 2));

  // บันทึก rejected records สำหรับ audit
  if (rejectedStations.length > 0) {
    fs.writeFileSync("./data/rejected_stations.json", JSON.stringify(rejectedStations, null, 2));
    console.warn(`⚠️  [WARNING] Rejected ${rejectedStations.length} records. See data/rejected_stations.json`);
  }

  console.log(`🎉 Import complete: ${stationsToInsert.length} stations saved to MongoDB.`);

  // แจ้ง frontend ว่าข้อมูลอัปเดตแล้ว
  const socket = io("http://localhost:3000");
  socket.emit("trigger-update");
  setTimeout(() => {
    socket.disconnect();
    mongoose.connection.close();
    process.exit(0);
  }, 1000);

} catch (dbError) {
  if (dbError.name === 'MongoBulkWriteError' && dbError.code === 11000) {
    console.warn("⚠️ Database warning: Some duplicate keys were skipped, but valid stations were saved.");
  } else {
    console.error("❌ Database error:", dbError);
  }
  mongoose.connection.close();
  process.exit(1);
}