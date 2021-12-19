import tmi, { ChatUserstate } from 'tmi.js';
import { getTrackIdFromLink, SPOTIFY_LINK_START } from './messageUtils';
import SpotifyService from './spotify.service';

const {
  TWITCH_CHANNEL,
  COMMAND_PREFIX,
  SUBSCRIBERS_ONLY,
  TWITCH_TOKEN,
  BOT_USERNAME,
  CHAT_FEEDBACK,
} = process.env;

interface TwitchOptions {
  channels: string[];
  identity?: {
    username: string;
    password: string;
  };
}

export default class TwitchService {
  private twitchClient: tmi.Client | null = null;

  constructor(private spotifyService: SpotifyService) {}

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

  private async handleMessage(
    target: string,
    userState: ChatUserstate,
    originalMsg: string,
    self: boolean
  ) {
    if (self || !COMMAND_PREFIX) {
      return;
    }

      if (SUBSCRIBERS_ONLY) {
        if (!userState.subscriber) {
        this.chatFeedback(target, "Sorry, song requests are only for subscribers.");
          return;
        }
      }

    let msg = originalMsg.trim();
    if (msg === COMMAND_PREFIX) {
      this.chatFeedback(target, `Add a song by author title or with Spotify Track URL, e.g. "${COMMAND_PREFIX} Rick Astley - Never Gonna Give You Up" or "${COMMAND_PREFIX} https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=34c1e97f523c44b1 "`);
      return;
    }

    if (msg.startsWith(COMMAND_PREFIX)) {
      console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
      msg = msg.substring(`${COMMAND_PREFIX} `.length);
      if (msg.startsWith(SPOTIFY_LINK_START)) {
        await this.handleSpotifyLink(msg, target);
      } else {
        this.spotifyService.tryAddTrackByString(msg, (chatMessage) => {
          this.chatFeedback(target, chatMessage);
        });
      }
      console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
    }
  }

  private async handleSpotifyLink(message: string, target: string) {
    const trackId = getTrackIdFromLink(message);
    if (trackId) {
      await this.spotifyService.addTrack(trackId, (chatMessage) => {
        this.chatFeedback(target, chatMessage);
      });
    } else {
      console.error('Unable to parse track ID from message');
      this.chatFeedback(
        target,
        'Fail (invalid message): Unable to parse track ID from message'
      );
    }
  }

  private chatFeedback(target: string, message: string) {
    if (CHAT_FEEDBACK) {
      this.twitchClient?.say(target, message);
    }
  }
}
