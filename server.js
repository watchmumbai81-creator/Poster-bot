const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'watchmumbai_admin_2026';
const MONGODB_URI = process.env.MONGODB_URI;

// Configure Web Push with VAPID keys from environment variables
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY;
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY;

if (PUBLIC_VAPID_KEY && PRIVATE_VAPID_KEY) {
  webpush.setVapidDetails(
    'mailto:support@watchmumbai.org',
    PUBLIC_VAPID_KEY,
    PRIVATE_VAPID_KEY
  );
}

// Connect to MongoDB Atlas
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch(err => console.error('MongoDB connection error:', err));
}

// Database Schema definition with Push Subscription support
const reportSchema = new mongoose.Schema({
  reportId: { type: String, required: true, unique: true },
  token: { type: String, required: true },
  pin: String,
  land: String,
  lat: Number,
  lng: Number,
  ward: String,
  handle: String,
  photo: String,
  status: { type: String, default: 'pending' }, // pending | approved | published
  resolved: { type: Boolean, default: false },
  tweetUrl: { type: String, default: '' },
  pushSubscription: { type: Object, default: null }, // Stores browser push endpoint
  notifications: [{
    message: String,
    tweetUrl: String,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const Report = mongoose.model('Report', reportSchema);

// Helper function to send push notification safely
async function sendPushNotification(subscription, title, body, url) {
  if (!subscription || !PUBLIC_VAPID_KEY) return;
  const payload = JSON.stringify({ title, body, url });
  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    console.error('Error sending push notification:', err);
  }
}

const authAdmin = (req, res, next) => {
  const token = req.headers['authorization'] || req.query.admin_token;
  if (token === ADMIN_TOKEN || token === `Bearer ${ADMIN_TOKEN}`) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized admin access' });
};

// 1. Citizen submits report & saves push subscription
app.post('/api/reports', async (req, res) => {
  try {
    const { id, pin, land, lat, lng, ward, handle, photo, pushSubscription } = req.body;
    const reportId = id || 'MB-' + Math.floor(100000 + Math.random() * 900000);
    const userToken = uuidv4();

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
      pushSubscription,
      status: 'pending',
      notifications: [{ message: 'Report received and queued for moderator review.' }]
    });

    await newReport.save();
    res.json({ success: true, report: { id: reportId, token: userToken, status: newReport.status } });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ success: false, error: 'Failed to submit report.' });
  }
});

// 2. Public Map View
app.get('/api/reports/public', async (req, res) => {
  try {
    const publicReports = await Report.find({ status: { $in: ['approved', 'published'] } })
      .select('-photo -token -pushSubscription')
      .sort({ createdAt: -1 });

    res.json(publicReports.map(r => ({
      id: r.reportId, pin: r.pin, land: r.land, lat: r.lat, lng: r.lng, ward: r.ward, handle: r.handle, resolved: r.resolved, tweetUrl: r.tweetUrl
    })));
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch public map data.' });
  }
});

// 3. User Notification Polling & Status
app.get('/api/reports/:id/notifications', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.query;
    const report = await Report.findOne({ reportId: id });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    if (token && report.token !== token) return res.status(403).json({ success: false, error: 'Access denied' });

    res.json({ success: true, status: report.status, tweetUrl: report.tweetUrl, notifications: report.notifications });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error fetching notifications' });
  }
});

// 4. Admin: Get all reports
app.get('/api/admin/reports', authAdmin, async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch admin reports.' });
  }
});

// 5. STAGE 1 & 2: Approve Submission or Attach Tweet URL
app.post('/api/admin/reports/:id/approve', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tweetUrl } = req.body;
    const report = await Report.findOne({ reportId: id });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

    const isPublished = Boolean(tweetUrl);
    report.status = isPublished ? 'published' : 'approved';
    if (tweetUrl) report.tweetUrl = tweetUrl;

    let msg = '';
    let title = '';

    if (isPublished) {
      // Stage 2: Tweet published
      title = 'Tweet Published! 🚀';
      msg = 'Your report was approved and published on X (@mybmc)!';
    } else {
      // Stage 1: Moderator approved
      title = 'Submission Approved! ✅';
      msg = 'Your report has been verified and approved by the moderator team.';
    }

    report.notifications.push({ message: msg, tweetUrl: tweetUrl || '' });
    await report.save();

    // Trigger Mobile Push Notification
    await sendPushNotification(report.pushSubscription, title, msg, tweetUrl || '');

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update report status.' });
  }
});

// 6. STAGE 3: Mark as Resolved & Close Ticket
app.post('/api/admin/reports/:id/resolve', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const report = await Report.findOne({ reportId: id });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

    report.resolved = true;
    const title = 'Hoarding Cleared! 🎉';
    const msg = 'Great news! BMC has cleared and resolved this illegal hoarding.';

    report.notifications.push({ message: msg });
    await report.save();

    // Trigger Stage 3 Push Notification
    await sendPushNotification(report.pushSubscription, title, msg, '');

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to resolve report.' });
  }
});

app.listen(PORT, () => {
  console.log(`Watch Mumbai Server running on port ${PORT}`);
});
