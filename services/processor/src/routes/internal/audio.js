
import express from 'express';

import 'dotenv/config';
import { getPendingAudiocraftGenerations , updateAudiocraftGenerationStatus} from '../../models/audio/Audio.js';
import { requestHasValidRuntimeSecret } from '../../utils/RuntimeSecretRequestAuth.js';



const router = express.Router();




router.get('/pending_audiocraft_generations', async function(req, res) {
  if (!requestHasValidRuntimeSecret(req)) {
    res.status(401).send('Unauthorized');
    return;
  } else {
    const pendingAudiocraftGenerations = await getPendingAudiocraftGenerations();
    res.json(pendingAudiocraftGenerations);
  }
});



router.post('/update_audiocraft_generation_status', async function(req, res) {
  const payload = req.body;


  
  if (!requestHasValidRuntimeSecret(req)) {
    res.status(401).send('Unauthorized');
    return;
  } else {
    // Update the status of the audiocraft generation



    const updatedAudiocraftGeneration = await updateAudiocraftGenerationStatus(payload);


    res.send({
      'message': 'success'
    });
  }


});


export default router;
