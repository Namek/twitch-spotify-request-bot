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
        this.spotifyApi.setAccessToken(this.spotifyAuth.accessToken);
        this.spotifyApi.setRefreshToken(this.spotifyAuth.refreshToken);
        await onAuth();
      }
    } catch (e) {
      console.error(`Error authorizing with Spotify ${e}`);
      process.exit(-1);
    }
  }

  public async getTrackName() {
    const state = await this.spotifyApi.getMyCurrentPlayingTrack();

    if (!state?.body?.item) {
      return null;
    }
    const trackDetails = await this.spotifyApi.getTrack(state.body!.item!.id);
    return getSongName(trackDetails.body);
  }

  public async tryAddTrackByString(
    msg: string,
    chatFeedback: (message: string) => void
  ) {
    const result = await this.spotifyApi.searchTracks(msg, { limit: 1 })
    const items = result.body.tracks?.items;

    if (items?.length) {
      await this.addTrack(items[0].id, chatFeedback);
    } else {
      console.log(`Command used but nothing found for query: '${msg}'`);
      await chatFeedback('Unable to find song :(');
    }
  }

  public async addTrack(
    trackId: string,
    chatFeedback: (message: string) => void
  ) {
    const addSong = async () => {
      console.log(`Attempting to add ${trackId}`);
      const track = await this.spotifyApi.getTrack(trackId);

      if (!track) {
        chatFeedback(`Fail: could not find the song.`);
      }

      const songName = getSongName(track.body);

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
    };

    try {
      if (this.hasTokenExpired()) {
        console.log('Spotify token expired, refreshing...');
        await this.refreshToken(addSong);
      } else {
        await addSong();
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
    const doNextTrack = async () => this.spotifyApi.skipToNext();

    try {
      if (this.hasTokenExpired()) {
        console.log('Spotify token expired, refreshing...');
        await this.refreshToken(doNextTrack);
      } else {
        await doNextTrack();
      }
    } catch (e) {
      console.error(`Error skipping track: ${e}`);
    }
  }

  public async setVolume(vol: number) {
    const doSetVolume = async () => this.spotifyApi.setVolume(Math.max(0, Math.min(100, vol)));

    try {
      if (this.hasTokenExpired()) {
        console.log('Spotify token expired, refreshing...');
        await this.refreshToken(doSetVolume);
      } else {
        await doSetVolume();
      }
    } catch (e) {
      console.error(`Error setting volume: ${e}`);
    }
  }

  private async addToQueue(trackId: string, songName: string) {
    await this.spotifyApi.addToQueue(this.createTrackURI(trackId));
    console.log(`Added ${songName} to queue`);
  }

  private async addToPlaylist(trackId: string, songName: string) {
    if (SPOTIFY_PLAYLIST_ID) {
      if (await this.doesPlaylistContainTrack(trackId)) {
        console.log(`${songName} is already in the playlist`);
        throw new Error('Duplicate Track');
      } else {
        await this.spotifyApi.addTracksToPlaylist(SPOTIFY_PLAYLIST_ID, [
          this.createTrackURI(trackId),
        ]);
        console.log(`Added ${songName} to playlist`);
      }
    } else {
      console.error(
        'Error: Cannot add to playlist - Please provide a playlist ID in the config file'
      );
    }
  }

  private createTrackURI = (trackId: string): string =>
    `spotify:track:${trackId}`;

  private async doesPlaylistContainTrack(trackId: string) {
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
    return new Date().getTime() / 1000 >= this.spotifyAuth.expireTime;
  }
}

function getSongName(info: SpotifyApi.SingleTrackResponse): string {
  const artists = info.artists.map(a => a.name).join(', ');
  return `${artists} - ${info.name}`;
}
