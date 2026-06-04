import fs from "fs";
import xml2js from "xml2js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// 1. เชื่อมต่อ MongoDB
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/ev-database";
await mongoose.connect(mongoUri)
  .then(() => console.log("🌱 Connected to MongoDB for data conversion..."))
  .catch(err => { console.error(err); process.exit(1); });

// 2. นิยาม Schema ให้รองรับ GeoJSON [lng, lat] ตามมาตรฐานและโครงสร้างระบบของคุณ
const stationSchema = new mongoose.Schema({
  name: String,
  province: String,
  address: String,
  openingHours: String,
  chargerType: String,
  power: Number,
  source: { type: String, default: "PEA_VOLTA" },
  is_available: { type: Boolean, default: true },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number] // [longitude, latitude]
  }
}, { collection: 'stations' });

const Station = mongoose.models.Station || mongoose.model("Station", stationSchema);

// 3. อ่านไฟล์ KML และเริ่ม Parse ข้อมูล
const xml = fs.readFileSync("./data/doc.kml", "utf8");

xml2js.parseString(xml, async (err, result) => {
  if (err) {
    console.error("❌ Parse XML Error:", err);
    process.exit(1);
  }

  const folders = result.kml.Document[0].Folder || [];
  const stationsToInsert = [];

  folders.forEach(folder => {
    const folderName = folder.name?.[0] || "";
    const placemarks = folder.Placemark || [];

    placemarks.forEach(place => {
      const name = place.name?.[0] || "Unknown";
      const description = place.description?.[0] || "";
      const coordText = place.Point?.[0]?.coordinates?.[0] || "";

      // ป้องกัน Error กรณีไม่มีพิกัดระบุมาในจุดนั้นๆ
      if (!coordText) return; 

      const [lng, lat] = coordText.split(",").map(Number);

      // ใช้ Regex ตัวเดิมของคุณในการดึงข้อมูลจาก description
      const provinceMatch = description.match(/จังหวัด:\s*(.*?)<br>/);
      const addressMatch = description.match(/ที่อยู่.*?:\s*(.*?)<br>/);
      const openMatch = description.match(/เวลาทำการ:\s*(.*?)<br>/);

      // แยกประเภท Charger
      let chargerType = "Unknown";
      if (folderName.includes("DC")) {
        chargerType = "DC";
      } else if (folderName.includes("AC")) {
        chargerType = "AC";
      }

      // ดึงกำลังไฟ (kW)
      const powerMatch = folderName.match(/(\d+)\s*kW/i);
      const power = powerMatch ? Number(powerMatch[1]) : null;

      // ตรวจสอบความถูกต้องของพิกัดก่อนจัดเก็บ
      if (!isNaN(lng) && !isNaN(lat) && lat !== 0 && lng !== 0) {
        stationsToInsert.push({
          name,
          province: provinceMatch?.[1]?.trim() || "",
          address: addressMatch?.[1]?.trim() || "",
          openingHours: openMatch?.[1]?.trim() || "",
          chargerType,
          power,
          source: "PEA_VOLTA",
          is_available: true,
          location: {
            type: "Point",
            coordinates: [lng, lat] // [lng, lat] เก็บรูปแบบ GeoJSON 
          }
        });
      }
    });
  });

  try {
    // ล้างข้อมูลสถานีที่เป็นของ PEA_VOLTA เดิมออกก่อนเพื่อไม่ให้เกิดข้อมูลซ้ำซ้อนเวลาสั่งรันซ้ำ
    await Station.deleteMany({ source: "PEA_VOLTA" });

    // ทำการ Insert ข้อมูลทั้งหมดลง MongoDB ทีเดียว (Bulk Insert เพื่อความเร็ว)
    if (stationsToInsert.length > 0) {
      await Station.insertMany(stationsToInsert);
    }

    // เขียนลงไฟล์ stations.json สำรองไว้ให้ด้วยตามกระบวนการเดิมของคุณ
    fs.writeFileSync("./data/stations.json", JSON.stringify(stationsToInsert, null, 2));

    console.log(`🚀 ข้อมูลเสร็จสมบูรณ์! แปลงและบันทึกเข้า MongoDB สำเร็จทั้งหมด ${stationsToInsert.length} สถานี`);
  } catch (dbError) {
    console.error("❌ เกิดข้อผิดพลาดในการบันทึกลง Database:", dbError);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
});