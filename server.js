const express = require('express');
const cors = require('cors');
let { TwitterApi } = require('twitter-api-v2');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

let rwClient = null;
try {
  if (process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET) {
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });
    rwClient = twitterClient.readWrite;
    console.log("Twitter API initialized successfully.");
  } else {
    console.log("Twitter API keys missing. Running in local fallback mode.");
  }
} catch (e) {
  console.error("Failed to initialize Twitter client:", e);
}

let reports = [];

app.get('/api/reports', (req, res) => {
  res.json(reports);
});

app.post('/api/reports', async (req, res) => {
  try {
    const { id, pin, land, lat, lng, ward, handle, created, photo } = req.body;

    const safeWard = (ward && typeof ward === 'string') ? ward : "Mumbai City";
    const safeHandle = (handle && typeof handle === 'string') ? handle : "@mybmc";
    const safeLand = land || "Mumbai Location";

    // Standardized Tweet Text
    const tweetText = `🚨 Unlawful Hoarding Reported!\n\n📍 Landmark: ${safeLand}\n📌 Pincode: ${pin}\n🏛️ Ward: ${safeWard}\n\nPlease take action. ${safeHandle} @mybmc`;

    let tweetId = null;
    let tweetError = null;

    if (rwClient) {
      try {
        console.log("Attempting to post tweet to X...");
        const tweetResponse = await rwClient.v2.tweet(tweetText);
        tweetId = tweetResponse.data.id;
        console.log(`✅ Tweet posted successfully! Tweet ID: ${tweetId}`);
      } catch (twitterErr) {
        console.error("❌ Twitter API Detailed Error:", JSON.stringify(twitterErr, null, 2));
        tweetError = twitterErr.message || "Failed to post to Twitter";
      }
    } else {
      console.log("Simulated Tweet (Keys missing):", tweetText);
    }

    const newReport = {
      id: id || "MB-" + Math.floor(1000 + Math.random() * 9000),
      pin: pin || "400001",
      land: safeLand,
      lat: lat || 19.0760,
      lng: lng || 72.8777,
      ward: safeWard,
      handle: safeHandle,
      created: created || Date.now(),
      photo: photo || "",
      resolved: false,
      tweetId: tweetId,
      logs: [`Tweeted/Logged to ${safeHandle} for ward ${safeWard}`]
    };

    reports.unshift(newReport);

    // Return the specific Twitter error if posting failed so you can see it on the website
    res.json({ 
      success: true, 
      report: newReport, 
      tweetId: tweetId, 
      twitterError: tweetError 
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
