




import('dotenv/config');
import express from 'express';



const CLIENT_APP = process.env.CLIENT_APP;
const API_SERVER = process.env.API_SERVER;
import { loginUserByEmail, registerUserByEmail } from '../../models/auth/User.js';


const router = express.Router();



router.post('/login', async (req, res) => {
  const payload = req.body;
  try {
    const session = await loginUserByEmail(payload);
    res.send(session);
  } catch (e) {
    console.error(e);
    res.status(400).send({ error: e });
  }
});

router.post('/register', async (req, res) => {
  try {
    const payload = req.body;
    const session = await registerUserByEmail(payload);
    res.send(session);
  } catch (e) {
    console.error(e);
    res.status(400).send({ error: e });
  }
});

router.post('/upgrade_plan', async function (req, res) {


  const payload = req.body;


  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const session = await upgradePlan(userId, payload);
  res.send(session);
});

router.post('/create_preference', async function(req, res) {

  const payload = req.body;

  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  const session = await createPreference(userId, payload);
  res.send(session);
});




// You can add more session-related routes here

export default router;
