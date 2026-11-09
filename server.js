const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-Memory Database (Store reports and notifications)
let reports = [];
let userNotifications = {};

// Admin secret token loaded from Render environment
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "watchmumbai_admin_2026";

// Middleware to verify moderator access
const authorizeAdmin = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ success: false, message: "Unauthorized: Moderator access required" });
  }
  next();
};

// ==========================================
// 1. PUBLIC / CITIZEN ENDPOINTS
// ==========================================

// Lodge a new report
app.post('/api/reports', (req, res) => {
  try {
    const { id, pin, land, lat, lng, ward, handle, photo } = req.body;
    
    const reportId = id || "MB-" + Math.floor(100000 + Math.random() * 900000);
    const safeWard = (ward && typeof ward === 'string') ? ward : "Mumbai City";
    const safeHandle = (handle && typeof handle === 'string') ? handle : "@mybmc";
    const safeLand = land || "Mumbai Location";

    const newReport = {
      id: reportId,
      pin: pin || "400001",
      land: safeLand,
      lat: lat || 19.0760,
      lng: lng || 72.8777,
      ward: safeWard,
      handle: safeHandle,
      photo: photo || "",
      created: Date.now(),
      status: "pending", // pending | approved | published | rejected
      tweetUrl: null,
      logs: ["Report lodged in database. Awaiting moderator review."]
    };

    reports.unshift(newReport);

    // Initial Notification for Citizen
    userNotifications[reportId] = [
      {
        timestamp: Date.now(),
        message: "Your request has been successfully submitted and is pending review by Team WatchMumbai.",
        type: "info"
      }
    ];

    res.json({ success: true, report: newReport });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch notifications for a citizen's report
app.get('/api/reports/:id/notifications', (req, res) => {
  const { id } = req.params;
  const notifications = userNotifications[id] || [];
  const report = reports.find(r => r.id === id);
  
  res.json({ 
    success: true, 
    status: report ? report.status : "unknown",
    tweetUrl: report ? report.tweetUrl : null,
    notifications 
  });
});

// Fetch all approved/published reports for map display
app.get('/api/reports/public', (req, res) => {
  const publicReports = reports.filter(r => r.status === "approved" || r.status === "published");
  res.json(publicReports);
});

// ==========================================
// 2. MODERATOR ENDPOINTS
// ==========================================

// Fetch all pending reports
app.get('/api/admin/pending', authorizeAdmin, (req, res) => {
  const pending = reports.filter(r => r.status === "pending");
  res.json({ success: true, count: pending.length, reports: pending });
});

// STEP 1: Approve Report & Notify Citizen
app.post('/api/admin/approve/:id', authorizeAdmin, (req, res) => {
  const { id } = req.params;
  const report = reports.find(r => r.id === id);

  if (!report) {
    return res.status(404).json({ success: false, message: "Report not found" });
  }

  report.status = "approved";
  report.logs.push("Approved by Moderator.");

  // Pre-generate pre-filled tweet link for the moderator
  const tweetText = `🚨 Unlawful Hoarding Reported!\n\n📍 Landmark: ${report.land}\n📌 Pincode: ${report.pin}\n🏛️ Ward: ${report.ward}\n\nPlease take immediate action. ${report.handle} @mybmc`;
  const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  // Citizen Notification 1
  const notifyMessage = "Your request has been approved by Team WatchMumbai and will be communicated soon to BMC via X.";
  
  if (!userNotifications[id]) userNotifications[id] = [];
  userNotifications[id].push({
    timestamp: Date.now(),
    message: notifyMessage,
    type: "approved"
  });

  res.json({ 
    success: true, 
    report, 
    tweetIntentUrl, 
    notificationSent: notifyMessage 
  });
});

// STEP 2: Publish Tweet URL & Send Final Notification
app.post('/api/admin/publish-tweet/:id', authorizeAdmin, (req, res) => {
  const { id } = req.params;
  const { tweetUrl } = req.body;

  if (!tweetUrl) {
    return res.status(400).json({ success: false, message: "tweetUrl is required" });
  }

  const report = reports.find(r => r.id === id);
  if (!report) {
    return res.status(404).json({ success: false, message: "Report not found" });
  }

  report.status = "published";
  report.tweetUrl = tweetUrl;
  report.logs.push(`Published to X: ${tweetUrl}`);

  // Citizen Notification 2
  const notifyMessage = `Your report has been communicated to BMC! View the live tweet here: ${tweetUrl}`;
  
  if (!userNotifications[id]) userNotifications[id] = [];
  userNotifications[id].push({
    timestamp: Date.now(),
    message: notifyMessage,
    tweetUrl: tweetUrl,
    type: "published"
  });

  res.json({ 
    success: true, 
    report, 
    notificationSent: notifyMessage 
  });
});

// Reject Report
app.post('/api/admin/reject/:id', authorizeAdmin, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const report = reports.find(r => r.id === id);

  if (!report) return res.status(404).json({ success: false, message: "Report not found" });

  report.status = "rejected";
  report.logs.push(`Rejected: ${reason || "Verification failed"}`);

  userNotifications[id].push({
    timestamp: Date.now(),
    message: `Your report could not be approved. Reason: ${reason || "Invalid details or clear photo missing."}`,
    type: "rejected"
  });

  res.json({ success: true, report });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
