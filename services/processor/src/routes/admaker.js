import 'dotenv/config';

import express from 'express';
import axios from 'axios';

import { verifyUserAuth, } from '../models/Auth.js';

import { createAdMakerSession } from '../models/movie_session/ad_creator/AdMaker.js';
import { createNewBlankQuickSession } from '../models/QuickSession.js';


const router = express.Router();

const YOUTUBE_API_KEY = process.env.YOUTUBE_DATA_API_KEY;

const SAMSAR_ONE_CHANNEL_ID = 'UCeg3i6vVjayIHLmMx6m5sMg';



router.post('/create', async function (req, res) {
  const headers = req.headers;
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  createAdMakerSession(userId, payload);
  res.status(200).send({ message: "VidGPT session created" });
});


router.post('/create_blank', async function (req, res) {

  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const sessionId = await createNewBlankQuickSession(userId);

  res.status(200).send({ sessionId: sessionId });
});


// --- NEW: Fetch the 8 latest videos from Samsar One channel ---
router.get('/latest_videos', async function (req, res) {
  // Optionally, require auth:


  // try {
  //   // If you want the user’s region or more query params, you can add them.
  //   // Example request to get the latest 8 videos from the channel:
  //   const url = `https://www.googleapis.com/youtube/v3/search`
  //     + `?channelId=${SAMSAR_ONE_CHANNEL_ID}`
  //     + `&part=snippet`
  //     + `&maxResults=8`
  //     + `&order=date`
  //     + `&type=video`
  //     + `&key=${YOUTUBE_API_KEY}`;

  //   const { data } = await axios.get(url);

  //   // data.items is an array of search results
  //   // You can filter or map as needed before returning
  //   return res.status(200).json({ items: data.items });
  // } catch (err) {
  //   console.error("Failed to fetch latest YouTube videos:", err);
  //   return res.status(500).send({ error: 'Failed to fetch videos' });
  // }
});



export default router;
