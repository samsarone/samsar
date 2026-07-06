
import express from 'express';
import { getProductsList, getProductMeta } from '../models/Product.js';

const router = express.Router();

router.get('/list', async function(req, res) {
  const productsList = await getProductsList();
  res.json(productsList);
});

router.get('/get_meta', async function(req, res) {
  const productId = req.query.id;
  const productMeta = await getProductMeta(productId);
  res.json(productMeta);
});

export default router;
