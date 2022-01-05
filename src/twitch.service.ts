import tmi, { ChatUserstate } from 'tmi.js';
import { getTrackIdFromLink, SPOTIFY_LINK_START } from './messageUtils';
import SpotifyService, { toSongName } from './spotify.service';

const {
  TWITCH_CHANNEL,
  SUBSCRIBERS_ONLY,
  TWITCH_TOKEN,
  BOT_USERNAME,
  CHAT_FEEDBACK,
  COMMAND_QUEUE__PREFIX,
  COMMAND_GET_QUEUE__PREFIX,
  COMMAND_GET_QUEUE__REFRESH__COOLDOWN_MS,
  COMMAND_CURRENT_SONG__PREFIX,
  COMMAND_SKIP_TO_NEXT__PREFIX,
  COMMAND_SKIP_TO_NEXT__ALLOWED_USERS,
  COMMAND_SET_VOLUME__PREFIX,
  COMMAND_SET_VOLUME__ALLOWED_USERS,
} = process.env;

interface TwitchOptions {
  channels: string[];
  identity?: {
    username: string;
    password: string;
  };
}

interface SongRequest {
  whoRequested: string;
  songName: string;
}

export default class TwitchService {
  private twitchClient: tmi.Client | null = null;
  private queue: SongRequest[] = [];

  constructor(private spotifyService: SpotifyService) {
    const updateQueue = async () => {
      const currentSong = await this.spotifyService.getTrackName();
      const index = this.queue.findIndex(s => s.songName === currentSong);

      if (index === 0) {
        this.queue.splice(0, 1);
      }

      setTimeout(updateQueue, COMMAND_GET_QUEUE__REFRESH__COOLDOWN_MS);
    };

    setTimeout(updateQueue, COMMAND_GET_QUEUE__REFRESH__COOLDOWN_MS);
  }

  public async connectToChat() {
    let twitchOptions: TwitchOptions = {
      channels: [TWITCH_CHANNEL],
    };

    if (CHAT_FEEDBACK) {
      if (TWITCH_TOKEN && BOT_USERNAME) {
        twitchOptions = {
          ...twitchOptions,
          identity: {
            username: BOT_USERNAME,
            password: TWITCH_TOKEN,
          },
        };
      } else {
        console.error(
          'Error: Chat feedback enabled but there is no TWITCH_TOKEN or BOT_USERNAME in the config'
        );
        process.exit(-1);
      }
    }

    this.twitchClient = tmi.client(twitchOptions);

    this.twitchClient.on('connected', (_addr: string, _port: number) => {
      console.log(`Connected to ${TWITCH_CHANNEL}'s chat`);
    });

    this.twitchClient.on(
      'message',
      async (
        target: string,
        userState: ChatUserstate,
        msg: string,
        self: boolean
      ) => await this.handleMessage(target, userState, msg, self)
    );

    try {
      await this.twitchClient.connect();
    } catch (e) {
      console.error(`Error connecting to Twitch - ${e}`);
      process.exit(-1);
    }
  }

  private async canAddSong(songName: string): Promise<boolean> {
    const foundIndex = this.queue.findIndex(song => song.songName === songName);
    if (foundIndex >= 0) {
      return false;
    }

    const currentTrack = await this.spotifyService.getTrackName();
    if (currentTrack === songName) {
      return false;
    }

    return true;
  }

  private async handleMessage(
    target: string,
    userState: ChatUserstate,
    originalMsg: string,
    self: boolean
  ) {
    if (self) {
      // Don't analyze messages for ourselves, we might get into infinite loop.
      return;
    }

    if (SUBSCRIBERS_ONLY) {
      if (!userState.subscriber) {
        this.chatFeedback(target, "Sorry, only for subscribers.");
        return;
      }
    }

    let msg = originalMsg.trim();
    if (msg === COMMAND_QUEUE__PREFIX) {
      this.chatFeedback(target, `Add a song to the queue by author title or with Spotify Track URL, e.g. "${COMMAND_QUEUE__PREFIX} Rick Astley - Never Gonna Give You Up" or "${COMMAND_QUEUE__PREFIX} https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=34c1e97f523c44b1 "`);
    } else if (msg.startsWith(COMMAND_CURRENT_SONG__PREFIX)) {
      const name = await this.spotifyService.getTrackName();
      if (name) {
        this.chatFeedback(target, `Playing: ${name}`);
      } else {
        this.chatFeedback(target, "Not sure what is playing... is it even?");
      }
    } else if (msg === COMMAND_GET_QUEUE__PREFIX) {
      if (this.queue.length > 0) {
        const msg = this.queue.map((song, index) => `${index + 1}. ${song.songName} [${song.whoRequested}]`).join('\n');
        await this.respond(userState.username!, target, msg);
      } else {
        await this.respond(userState.username!, target, "No songs added to the queue by the chat.");
      }
    } else if (msg.startsWith(COMMAND_QUEUE__PREFIX)) {
      console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
      const args = getCommandArgs(COMMAND_QUEUE__PREFIX, msg);

      if (args.startsWith(SPOTIFY_LINK_START)) {
        await this.handleSpotifyLink(args, target, userState);
      } else {
        const foundTracks = await this.spotifyService.findTracks(args);
        if (foundTracks.length) {
          const track = foundTracks[0];
          const songName = toSongName(track.info);
          if (await this.canAddSong(songName)) {
            this.queue.push({
              whoRequested: userState.username!,
              songName,
            });
            await this.spotifyService.addTrack(track.id, (msg) => this.chatFeedback(target, msg));
          } else {
            this.chatFeedback(target, "The requested track is already in the queue.");
          }
        } else {
          this.chatFeedback(target, "Unable to find song :(");
        }
      }
      console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
    } else if (msg === COMMAND_SKIP_TO_NEXT__PREFIX) {
      if (isUserPrivileged(userState, COMMAND_SKIP_TO_NEXT__ALLOWED_USERS)) {
        await this.spotifyService.skipToNextTrack();
      } else {
        console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
        console.log(`Blocked a call of skip from ${userState.username}`);
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
      }
    } else if (msg.startsWith(COMMAND_SET_VOLUME__PREFIX)) {
      if (isUserPrivileged(userState, COMMAND_SET_VOLUME__ALLOWED_USERS)) {
        const args = getCommandArgs(COMMAND_SET_VOLUME__PREFIX, msg);
        const num = Number.parseInt(args, 10);

        if (!Number.isNaN(num)) {
          await this.spotifyService.setVolume(num);
        } else {
          const volume = await this.spotifyService.getVolume();
          this.chatFeedback(target, `The volume is ${volume}%`);
        }
      } else {
        console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
        console.log(`Blocked a call of skip from ${userState.username}`);
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
      }
    }
  }

  private async handleSpotifyLink(message: string, target: string, userState: ChatUserstate) {
    const trackId = getTrackIdFromLink(message);
    if (!trackId) {
      console.error('Unable to parse track ID from message');
      this.chatFeedback(
        target,
        'Error: unable to parse track ID'
      );
      return;
    }

    const songName = await this.spotifyService.getSongNameByTrackId(trackId);

    if (!(await this.canAddSong(songName))) {
      this.chatFeedback(target, "The requested track is already in the queue.");
      return;
    }

    this.queue.push({
      whoRequested: userState.username!,
      songName,
    });
    await this.spotifyService.addTrack(trackId, (chatMessage) => {
      this.chatFeedback(target, chatMessage);
    });
  }

  private chatFeedback(channelName: string, message: string) {
    if (CHAT_FEEDBACK) {
      this.twitchClient?.say(channelName, message);
    }
  }

  private async chatWhisper(username: string, message: string) {
    try {
      await this.twitchClient?.whisper(username, message);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Preferably whisper. If you can't then respond publicly.
   */
  private async respond(username: string, orChannelName: string, message: string) {
    const canWhisper = BOT_USERNAME.toLocaleLowerCase() !== username;

    try {
      if (canWhisper) {
        await this.twitchClient?.whisper(username, message);
      } else {
        this.twitchClient?.say(orChannelName, message);
      }
    } catch (err) {
      console.error(err);
    }
  }
}

function getCommandArgs(commandPrefix: string, msg: string) {
  return msg.substring(`${commandPrefix} `.length);
}

function isUserPrivileged(userState: ChatUserstate, privilegedList?: string | undefined) {
  let allow = true;

  if (!!privilegedList?.trim().length && userState.username) {
    const allowedUsernames = privilegedList?.split(',').map(name => name.toLocaleLowerCase());
    allow = allowedUsernames.includes(userState.username.toLocaleLowerCase());
  }

  return allow;
}
