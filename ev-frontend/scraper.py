import requests
from bs4 import BeautifulSoup
import json
import os
import time

# 1. ตั้งค่าโฟลเดอร์สำหรับเก็บรูปและไฟล์
IMAGE_DIR = 'public/assets/cars'
if not os.path.exists(IMAGE_DIR):
    os.makedirs(IMAGE_DIR)

# 2. URL เป้าหมาย
URL = "https://ev-database.org/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

print("🚀 กำลังส่งบอทเข้าไปที่ EV-Database...")
response = requests.get(URL, headers=HEADERS)
soup = BeautifulSoup(response.text, 'html.parser')

car_cards = soup.find_all('div', class_='list-item')
ev_database = []
print(f"👀 พบข้อมูลทั้งหมด {len(car_cards)} ชิ้น! กำลังคัดกรองเฉพาะรถยนต์...")

for car in car_cards: 
    try:
        # --- ระบบ Safety Check (จุดที่เพิ่มเข้ามา) ---
        brand_elem = car.find('span', class_='brand')
        model_elem = car.find('span', class_='model')
        
        # ถ้ากล่องนี้ไม่ใช่รถ (ไม่มีชื่อแบรนด์) ให้ข้ามไปเลย ไม่ต้องแจ้ง Error
        if not brand_elem or not model_elem:
            continue
        # ----------------------------------------

        brand = brand_elem.text.strip()
        model_name = model_elem.text.strip()
        full_name = f"{brand}_{model_name}".replace(" ", "_").replace("/", "")

        specs = car.find_all('span', class_='bg-light-grey')
        battery_kwh = specs[0].text.replace("kWh", "").strip() if len(specs) > 0 else "0"
        range_km = specs[2].text.replace("km", "").strip() if len(specs) > 2 else "0"

        img_tag = car.find('img')
        img_url = "https://ev-database.org" + img_tag['src'] if img_tag else None

        local_image_path = ""
        if img_url:
            img_filename = f"{full_name}.jpg"
            img_data = requests.get(img_url).content
            with open(os.path.join(IMAGE_DIR, img_filename), 'wb') as handler:
                handler.write(img_data)
            local_image_path = f"/assets/cars/{img_filename}"
            print(f"✅ โหลดรูปสำเร็จ: {brand} {model_name}")

        ev_database.append({
            "brand": brand,
            "name": model_name,
            "battery": int(float(battery_kwh)) if battery_kwh.replace('.','',1).isdigit() else 50,
            "range": int(range_km) if range_km.isdigit() else 300,
            "image": local_image_path
        })
        time.sleep(0.5) # พักหายใจ 0.5 วินาที
        
        # ตั้งเป้าหมาย: โหลดแค่ 10 คันแรกพอ จะได้เสร็จไวๆ (แก้ไขเพิ่มลดตัวเลขตรงนี้ได้)
        if len(ev_database) >= 10:
            break

    except Exception as e:
        pass # ถ้ามี Error อื่นๆ ให้แอบข้ามไปเงียบๆ

with open('public/cars_db.json', 'w', encoding='utf-8') as f:
    json.dump(ev_database, f, ensure_ascii=False, indent=4)

print("🎉 เสร็จสิ้น! ข้อมูลทั้งหมดถูกเซฟไว้ที่ public/cars_db.json")