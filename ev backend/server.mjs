import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();

app.use(cors());

const stations = JSON.parse(
  fs.readFileSync("./data/stations.json", "utf8")
);

app.get("/", (req, res) => {
  res.send("EV Backend Running");
});

app.get("/stations", (req, res) => {
  res.json(stations);
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});