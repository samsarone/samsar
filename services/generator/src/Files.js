import 'dotenv/config';
import * as fs from 'fs';
import path from "path";
import { mkdir, writeFile } from "fs/promises";


export async function saveGeneratedFile(imageData) {
  const imageBuffer = Buffer.from(imageData, 'base64');
  const randStr = Math.random().toString(36).substring(7);
  const imageName = `generation_${Date.now()}_${randStr}.png`
  const pwd = process.cwd();
  let savePath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations', imageName);
  
  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    savePath = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations', imageName);
  }
  // Ensure the directory exists
  await mkdir(path.dirname(savePath), { recursive: true });
  // Write the file to the filesystem
  await writeFile(savePath, imageBuffer);
  return imageName;
}


