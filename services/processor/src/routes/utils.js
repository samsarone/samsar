
import express from 'express';

import { getModelPricesList } from '../models/Utility.js';



const router = express.Router();




router.get('/model_prices', async function(req, res) {
  const modelPrices =  getModelPricesList();
  res.json(modelPrices);
});

// You can add more session-related routes here

export default router;
