import SpotifyWebApi from 'spotify-web-api-node';
import { waitForCode } from './auth-server';
import SpotifyAuth from './spotify-auth';
import fs from 'fs';

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  AUTH_SERVER_PORT,
  ADD_TO_QUEUE,
  ADD_TO_PLAYLIST,
  SPOTIFY_PLAYLIST_ID,
  HOST,
} = process.env;

export interface FoundTrack {
  name: string;
  id: string;
  info: SpotifyApi.TrackObjectFull;
}

export default class SpotifyService {
  private spotifyApi: SpotifyWebApi;
  private spotifyAuth: SpotifyAuth;

  constructor() {
    let redirectUri;
    if (process.env.PORT) {
      redirectUri = `${HOST}/spotifyAuth`;
    } else {
      redirectUri = `${HOST}:${AUTH_SERVER_PORT}/spotifyAuth`
    }
    this.spotifyApi = new SpotifyWebApi({
      clientId: SPOTIFY_CLIENT_ID,
      clientSecret: SPOTIFY_CLIENT_SECRET,
      redirectUri: `${redirectUri}`,
    });

    if (!fs.existsSync('./spotify-auth-store.json')) {
      fs.writeFileSync(
        './spotify-auth-store.json',
        JSON.stringify(new SpotifyAuth('', '', new Date().getTime() / 1000))
      );
    }
    this.spotifyAuth = JSON.parse(
      fs.readFileSync('./spotify-auth-store.json', 'utf8')
    );
  }

  public async authorize(onAuth: Function) {
    console.log('Authorizing with Spotify');
    try {
      if (!this.spotifyAuth.refreshToken) {
        console.log('No credentials found, performing new authorization');
        await this.performNewAuthorization(onAuth);
      } else {
        console.log('Spotify credentials found');
        await this.checkTokenAndProceed();
        this.spotifyApi.setAccessToken(this.spotifyAuth.accessToken);
        this.spotifyApi.setRefreshToken(this.spotifyAuth.refreshToken);
        await onAuth();
      }
    } catch (e) {
      console.error(`Error authorizing with Spotify ${e}`);
      process.exit(-1);
    }
  }

  public async checkTokenAndProceed() {
    return new Promise(async (resolve, reject) => {
      if (this.hasTokenExpired()) {
        console.log('Spotify token expired, refreshing...');
        try {
          await this.refreshToken(resolve);
          console.log('Spotify token refreshed successfully!');
        } catch (err) {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  }

  public async getTrackName(): Promise<string | null> {
    try {
      await this.checkTokenAndProceed();

      const state = await this.spotifyApi.getMyCurrentPlayingTrack();

      if (!state?.body?.item) {
        return null;
      }

      return this.getSongNameByTrackId(state.body!.item!.id);
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  public async findTracks(query: string, limit: number = 1): Promise<FoundTrack[]> {
    await this.checkTokenAndProceed();

    const result = await this.spotifyApi.searchTracks(query, {limit})
    const items = result.body.tracks?.items;

    return items?.map(it => ({
      name: toSongName(it),
      id: it.id,
      info: it,
    })) ?? [];
  }

  public async tryAddTrackByString(
    msg: string,
    chatFeedback: (message: string) => void
  ): Promise<string | undefined> {
    try {
      await this.checkTokenAndProceed();

      const result = await this.spotifyApi.searchTracks(msg, {limit: 1})
      const items = result.body.tracks?.items;

      if (items?.length) {
        const item = items[0];
        await this.addTrack(item.id, chatFeedback);
        return toSongName(item);
      } else {
        console.log(`Command used but nothing found for query: '${msg}'`);
        await chatFeedback('Unable to find song :(');
      }
    } catch (err) {
      await chatFeedback('Unable to find song :(');
      console.error(err);
    }
  }

  public async addTrack(
    trackId: string,
    chatFeedback: (message: string) => void
  ) {
    try {
      await this.checkTokenAndProceed();

      console.log(`Attempting to add ${trackId}`);
      const track = await this.spotifyApi.getTrack(trackId);

      if (!track) {
        chatFeedback(`Fail: could not find the song.`);
      }

      const songName = toSongName(track.body);

      if (ADD_TO_QUEUE) {
        try {
          await this.addToQueue(trackId, songName);
          chatFeedback(`Success: "${songName}" added to queue`);
        } catch (e) {
          if (e.message === 'Not Found') {
            console.error(
              'Unable to add song to queue - Song may not exist or you may not have the Spotify client open and active'
            );
          } else {
            console.error(`Error: Unable to add song to queue - ${e.message}`);
          }
          chatFeedback(`Fail: ${songName} not added to queue`);
        }
      }

      if (ADD_TO_PLAYLIST) {
        try {
          await this.addToPlaylist(trackId, songName);
          chatFeedback(`Success: "${songName}" added to playlist`);
        } catch (e) {
          if (e.message === 'Duplicate Track') {
            chatFeedback(
              `Fail (duplicate): ${songName} already in the playlist`
            );
          } else {
            chatFeedback(`Fail: ${songName} not added to playlist`);
          }
        }
      }
    } catch (e) {
      console.error(`Error adding track ${e}`);
      if (e.body?.error?.message === 'invalid id') {
        chatFeedback('Fail (invalid ID): Link contains an invalid ID');
      } else {
        chatFeedback('Fail: Error occurred adding track');
      }
    }
  }

  public async skipToNextTrack() {
    try {
      await this.checkTokenAndProceed();
      await this.spotifyApi.skipToNext();
    } catch (err) {
      console.error(`Error skipping track: ${err}`);
    }
  }

  public async setVolume(vol: number) {
    try {
      await this.checkTokenAndProceed();
      await this.spotifyApi.setVolume(Math.max(0, Math.min(100, vol)));
    } catch (err) {
      console.error(`Error setting volume: ${err}`);
    }
  }

  public async getVolume() {
    try {
      await this.checkTokenAndProceed();
      const devices = (await this.spotifyApi.getMyDevices()).body.devices.filter(d => d.is_active);
      return devices?.length ? devices[0].volume_percent : 0;
    } catch (err) {
      console.error(`Error getting volume: ${err}`);
    }
  }

  public async getSongNameByTrackId(trackId: string): Promise<string> {
    const trackDetails = await this.spotifyApi.getTrack(trackId);
    return toSongName(trackDetails.body);
  }

  private async addToQueue(trackId: string, songName: string) {
    try {
      await this.checkTokenAndProceed();
      await this.spotifyApi.addToQueue(createTrackURI(trackId));
      console.log(`Added ${songName} to queue`);
    } catch (err) {
      console.error(`Error getting volume: ${err}`);
    }
  }

  private async addToPlaylist(trackId: string, songName: string) {
    if (!SPOTIFY_PLAYLIST_ID) {
      console.error(
        'Error: Cannot add to playlist - Please provide a playlist ID in the config file'
      );
      return;
    }

    await this.checkTokenAndProceed();

    if (await this.doesPlaylistContainTrack(trackId)) {
      console.log(`${songName} is already in the playlist`);
    } else {
      await this.spotifyApi.addTracksToPlaylist(SPOTIFY_PLAYLIST_ID, [
        createTrackURI(trackId),
      ]);
      console.log(`Added ${songName} to playlist`);
    }
  }

  private async doesPlaylistContainTrack(trackId: string) {
    await this.checkTokenAndProceed();

    const playlistInfo = await this.spotifyApi.getPlaylist(
      SPOTIFY_PLAYLIST_ID!
    );

    let i;
    for (i = 0; i < playlistInfo.body.tracks.items.length; i++) {
      if (playlistInfo.body.tracks.items[i].track.id === trackId) {
        return true;
      }
    }
    return false;
  }

  public getAuthorizationUrl() {
    const scopes = [
      'user-read-currently-playing',
      'user-read-playback-state',
      'user-modify-playback-state',
      'playlist-read-private',
      'playlist-modify-public',
      'playlist-modify-private',
    ];

    return this.spotifyApi.createAuthorizeURL(scopes, '');
  }

  private async performNewAuthorization(onAuth: Function) {
    const authUrl = this.getAuthorizationUrl();
    console.log(
      'Click or go to the following link and give this app permissions'
    );
    console.log(`\n${authUrl}\n`);
    waitForCode((code: string) => {
      this.spotifyApi.authorizationCodeGrant(code, async (error, data) => {
        if (error) {
          console.error(error);
          process.exit(-1);
        }
        const accessToken = data.body['access_token'];
        const refreshToken = data.body['refresh_token'];
        const expireTime = this.calculateExpireTime(data.body['expires_in']);
        this.writeNewSpotifyAuth(accessToken, refreshToken, expireTime);
        this.spotifyApi.setAccessToken(accessToken);
        this.spotifyApi.setRefreshToken(refreshToken);
        await onAuth();
      });
    });
  }

  private async refreshToken(onAuth: Function) {
    try {
      this.spotifyApi.setRefreshToken(this.spotifyAuth.refreshToken);
      this.spotifyApi.refreshAccessToken(async (err, data) => {
        if (err) {
          console.error(err);
          process.exit(-1);
        }
        const accessToken = data.body['access_token'];
        this.spotifyApi.setAccessToken(accessToken);
        const expireTime = this.calculateExpireTime(data.body['expires_in']);
        this.writeNewSpotifyAuth(
          accessToken,
          this.spotifyAuth.refreshToken,
          expireTime
        );
        await onAuth();
      });
    } catch (e) {
      console.error(`Error refreshing access token ${e}`);
      process.exit(-1);
    }
  }

  private calculateExpireTime = (expiresIn: number): number =>
    new Date().getTime() / 1000 + expiresIn;

  private writeNewSpotifyAuth(
    accessToken: string,
    refreshToken: string,
    expireTime: number
  ) {
    const newSpotifyAuth = new SpotifyAuth(
      accessToken,
      refreshToken,
      expireTime
    );
    this.spotifyAuth = newSpotifyAuth;
    fs.writeFile(
      './spotify-auth-store.json',
      JSON.stringify(newSpotifyAuth),
      (err) => {
        if (err) console.error(err);
      }
    );
  }

  private hasTokenExpired(): boolean {
    return new Date().getTime() / 1000 >= (this.spotifyAuth?.expireTime ?? 0);
  }
}

export function toSongName(info: SpotifyApi.SingleTrackResponse): string {
  const artists = info.artists.map(a => a.name).join(', ');
  return `${artists} - ${info.name}`;
}

function createTrackURI(trackId: string): string {
  return `spotify:track:${trackId}`;
}
