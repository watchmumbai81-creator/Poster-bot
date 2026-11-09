const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'watchmumbai_admin_2026';
const MONGODB_URI = process.env.MONGODB_URI;

// Connect to MongoDB Atlas
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch(err => console.error('MongoDB connection error:', err));
} else {
  console.warn('Warning: MONGODB_URI environment variable is missing.');
}

// Database Schema definition
const reportSchema = new mongoose.Schema({
  reportId: { type: String, required: true, unique: true },
  token: { type: String, required: true }, // Unique tracking token for user privacy isolation
  pin: String,
  land: String,
  lat: Number,
  lng: Number,
  ward: String,
  handle: String,
  photo: String,
  status: { type: String, default: 'pending' }, // pending | approved | rejected | published
  resolved: { type: Boolean, default: false },
  tweetUrl: { type: String, default: '' },
  notifications: [{
    message: String,
    tweetUrl: String,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const Report = mongoose.model('Report', reportSchema);

// Middleware for Admin authentication
const authAdmin = (req, res, next) => {
  const token = req.headers['authorization'] || req.query.admin_token;
  if (token === ADMIN_TOKEN || token === `Bearer ${ADMIN_TOKEN}`) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Unauthorized admin access' });
};

// 1. Citizen submits a new report
app.post('/api/reports', async (req, res) => {
  try {
    const { id, pin, land, lat, lng, ward, handle, photo } = req.body;
    const reportId = id || 'MB-' + Math.floor(100000 + Math.random() * 900000);
    const userToken = uuidv4(); // Unique unguessable security token

    const newReport = new Report({
      reportId,
      token: userToken,
      pin,
      land,
      lat,
      lng,
      ward,
      handle,
      photo,
      status: 'pending',
      notifications: [{ message: 'Report received and queued for moderator review.' }]
    });

    await newReport.save();

    res.json({
      success: true,
      report: {
        id: reportId,
        token: userToken,
        status: newReport.status
      }
    });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ success: false, error: 'Failed to submit report to database.' });
  }
});

// 2. Public endpoint: Only returns approved & published reports for the map view
app.get('/api/reports/public', async (req, res) => {
  try {
    const publicReports = await Report.find({ status: { $in: ['approved', 'published'] } })
      .select('-photo -token') // Exclude heavy photos & user tokens for public performance
      .sort({ createdAt: -1 });

    res.json(publicReports.map(r => ({
      id: r.reportId,
      pin: r.pin,
      land: r.land,
      lat: r.lat,
      lng: r.lng,
      ward: r.ward,
      handle: r.handle,
      resolved: r.resolved,
      tweetUrl: r.tweetUrl
    })));
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch public map data.' });
  }
});

// 3. User Notification Polling (Isolated with Report ID & Security Token)
app.get('/api/reports/:id/notifications', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.query;

    const report = await Report.findOne({ reportId: id });
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    // Secure Data Isolation: Check token if provided
    if (token && report.token !== token) {
      return res.status(403).json({ success: false, error: 'Access denied: Token mismatch' });
    }

    res.json({
      success: true,
      status: report.status,
      tweetUrl: report.tweetUrl,
      notifications: report.notifications
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error fetching notifications' });
  }
});

// 4. Admin Endpoint: Get all pending reports for moderation
app.get('/api/admin/reports', authAdmin, async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch admin reports.' });
  }
});

// 5. Admin Endpoint: Approve & attach tweet link
app.post('/api/admin/reports/:id/approve', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tweetUrl } = req.body;

    const report = await Report.findOne({ reportId: id });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

    report.status = tweetUrl ? 'published' : 'approved';
    if (tweetUrl) report.tweetUrl = tweetUrl;

    report.notifications.push({
      message: tweetUrl
        ? 'Your report was approved and published on X (@mybmc)!'
        : 'Your report has been verified and approved by the moderator team.',
      tweetUrl: tweetUrl || ''
    });

    await report.save();
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update report status.' });
  }
});

// 6. Admin Endpoint: Mark as resolved/cleared by BMC
app.post('/api/admin/reports/:id/resolve', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const report = await Report.findOne({ reportId: id });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

    report.resolved = true;
    report.notifications.push({
      message: 'Great news! BMC has cleared and resolved this illegal hoarding.'
    });

    await report.save();
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to resolve report.' });
  }
});

app.listen(PORT, () => {
  console.log(`Watch Mumbai Server running on port ${PORT}`);
});
