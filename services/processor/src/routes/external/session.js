




import('dotenv/config');
import express from 'express';



const CLIENT_APP = process.env.CLIENT_APP;
const API_SERVER = process.env.API_SERVER;
import { loginUserByEmail, registerUserByEmail } from '../../models/auth/User.js';


const router = express.Router();



router.post('/completion', async (req, res) => {
  const payload = req.body;

  try {
    const session = await loginUserByEmail(payload);

    
    res.send(session);
  } catch (e) {
    console.error(e);
    res.status(400).send({ error: e });
  }
  res.send({ success: true });
});


router.post('/video_gen_completion', async (req, res) => {

  const payload = req.body;



  res.send({});
  
});


// You can add more session-related routes here

export default router;
