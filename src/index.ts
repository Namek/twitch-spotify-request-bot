import fs from 'fs';
import path from 'path';

import env from 'env-smart';
// Make sure to load .env file before importing app services.
(() => {
  const curDir = process.cwd();
  const dirsToTry = [curDir, path.join(curDir, '..')];

  let selectedDir = null;
  for (const dir of dirsToTry) {
    const testDir = path.join(dir, '.env');
    console.log(`Checking dir for .env: ${testDir}`);
    if (fs.existsSync(testDir)) {
      selectedDir = dir;
      break;
    }
  }

  if (!selectedDir) {
    console.error("File '.env' was not found.");
    process.exit(1);
  }

  console.log(`Getting .env from: ${selectedDir}`);
  env.load({ directory: selectedDir });
})();

import SpotifyService from './spotify.service';
import TwitchService from './twitch.service';

const runApp = async () => {
  const spotifyService = new SpotifyService();
  await spotifyService.authorize(async () => {
    const twitchService = new TwitchService(spotifyService);
    await twitchService.connectToChat();
  });
};

runApp().then();