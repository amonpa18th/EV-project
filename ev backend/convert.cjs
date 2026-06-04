const fs = require("fs");
const xml2js = require("xml2js");

const kml = fs.readFileSync("../data/doc.kml", "utf8");

xml2js.parseString(kml, (err, result) => {
  if (err) {
    console.error(err);
    return;
  }

  fs.writeFileSync(
    "../data/stations.json",
    JSON.stringify(result, null, 2)
  );

  console.log("แปลงเป็น JSON สำเร็จ");
});