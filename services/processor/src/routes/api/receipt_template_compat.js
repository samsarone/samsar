import express from 'express';

import imageApiRouter from './image.js';

const router = express.Router();

const toForwardedPath = (targetPath) => (req, res, next) => {
  const queryIndex = req.url.indexOf('?');
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
  req.url = `${targetPath}${query}`;
  return imageApiRouter(req, res, next);
};

router.post('/create-receipt-template', toForwardedPath('/receipt_templates/create'));
router.post('/verify-against-template', toForwardedPath('/receipt_templates/query'));
router.post('/receipt_templates/create', toForwardedPath('/receipt_templates/create'));
router.post('/receipt_templates/query', toForwardedPath('/receipt_templates/query'));
router.get('/template_json', toForwardedPath('/template_json'));
router.get('/receipt_templates/template_json', toForwardedPath('/receipt_templates/template_json'));
router.post('/images/create-receipt-template', toForwardedPath('/receipt_templates/create'));
router.post('/images/verify-against-template', toForwardedPath('/receipt_templates/query'));
router.post('/images/receipt_templates/create', toForwardedPath('/receipt_templates/create'));
router.post('/images/receipt_templates/query', toForwardedPath('/receipt_templates/query'));
router.get('/images/template_json', toForwardedPath('/template_json'));
router.get('/images/receipt_templates/template_json', toForwardedPath('/receipt_templates/template_json'));

export default router;
