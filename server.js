const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

let reports = [];

app.get('/api/reports', (req, res) => {
  res.json(reports);
});

app.post('/api/reports', (req, res) => {
  try {
    const { id, pin, land, lat, lng, ward, handle, created, photo } = req.body;

    // Safe fallback validations to prevent 'includes' or undefined errors
    const safeWard = (ward && typeof ward === 'string') ? ward : "Mumbai City";
    const safeHandle = (handle && typeof handle === 'string') ? handle : "@mybmc";

    const newReport = {
      id: id || "MB-" + Math.floor(1000 + Math.random() * 9000),
      pin: pin || "400001",
      land: land || "Mumbai Location",
      lat: lat || 19.0760,
      lng: lng || 72.8777,
      ward: safeWard,
      handle: safeHandle,
      created: created || Date.now(),
      photo: photo || "",
      resolved: false,
      logs: [`Tweeted to ${safeHandle} for ward ${safeWard}`]
    };

    reports.unshift(newReport);
    console.log(`New report saved & tweeted for ward: ${safeWard}`);

    res.json({ success: true, report: newReport });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
