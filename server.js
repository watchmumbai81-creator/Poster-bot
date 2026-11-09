require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { TwitterApi } = require('twitter-api-v2');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// File-based storage for reports
const DB_FILE = './reports.json';
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));

function getReports() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function saveReports(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// Initialize Twitter client using keys from environment variables
const twitterClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// Format statutory tweet text
function formatTweet(report) {
  return `🚨 Illegal poster reported at ${report.land}, Pincode ${report.pin} (Ward ${report.ward}).\n` +
         `Cc: @mybmc ${report.handle} please take action.\n` +
         `Report ID: ${report.id}\n` +
         `Track: https://mumbaiposterwatch.in/#${report.id} #CleanMumbai #MumbaiCivicWatch`;
}

// ENDPOINT 1: Receive report from frontend & tweet to X
app.post('/api/reports', async (req, res) => {
  try {
    const report = req.body;
    const reports = getReports();
    
    if (reports.some(r => r.id === report.id)) {
      return res.status(400).json({ success: false, message: 'Report ID already exists.' });
    }

    const tweetText = formatTweet(report);
    let mediaId = null;

    if (report.photo && report.photo.startsWith('data:image')) {
      const base64Data = report.photo.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      mediaId = await twitterClient.v2.uploadMedia(buffer, { mimeType: 'image/jpeg' });
    }

    const tweetPayload = { text: tweetText };
    if (mediaId) tweetPayload.media = { media_ids: [mediaId] };

    const tweet = await twitterClient.v2.tweet(tweetPayload);
    console.log(`[X Tweet Dispatched] ID: ${tweet.data.id} for Report ${report.id}`);

    report.logs = [{ t: Date.now(), text: tweetText, tweetId: tweet.data.id }];
    reports.unshift(report);
    saveReports(reports);

    res.status(200).json({ success: true, tweetId: tweet.data.id, report });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ENDPOINT 2: Get all reports
app.get('/api/reports', (req, res) => {
  res.json(getReports());
});

// ENDPOINT 3: Mark resolved
app.post('/api/reports/:id/resolve', (req, res) => {
  const { id } = req.params;
  const { remarks, proof } = req.body;
  const reports = getReports();

  const report = reports.find(r => r.id === id);
  if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

  report.resolved = {
    t: Date.now(),
    remarks: remarks || 'Cleared by municipal staff.',
    proof: proof || null
  };

  saveReports(reports);
  res.json({ success: true, report });
});

// 12-Hour Automated Reminder Cron
cron.schedule('0 */12 * * *', async () => {
  console.log('[Cron Job] Checking unresolved complaints...');
  const reports = getReports();
  const H12 = 12 * 3600 * 1000;
  let updated = false;

  for (let r of reports) {
    if (r.resolved) continue;

    const lastPing = r.logs[r.logs.length - 1]?.t || r.created;
    if (Date.now() - lastPing >= H12) {
      try {
        const text = `REMINDER: Unresolved poster at ${r.land}, ${r.pin} (Ward ${r.ward}). Pending for ${Math.round((Date.now() - r.created)/36e5)} hrs. @mybmc ${r.handle} #CleanMumbai`;
        const tweet = await twitterClient.v2.tweet({ text });
        r.logs.push({ t: Date.now(), text, tweetId: tweet.data.id });
        updated = true;
      } catch (e) {
        console.error(`[Ping Failed] ${r.id}:`, e.message);
      }
    }
  }

  if (updated) saveReports(reports);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Server running on port ${PORT}`));