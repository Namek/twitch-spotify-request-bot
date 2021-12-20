import tmi, { ChatUserstate } from 'tmi.js';
import { getTrackIdFromLink, SPOTIFY_LINK_START } from './messageUtils';
import SpotifyService from './spotify.service';

const {
  TWITCH_CHANNEL,
  SUBSCRIBERS_ONLY,
  TWITCH_TOKEN,
  BOT_USERNAME,
  CHAT_FEEDBACK,
  COMMAND_QUEUE__PREFIX,
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

export default class TwitchService {
  private twitchClient: tmi.Client | null = null;

  constructor(private spotifyService: SpotifyService) { }

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
    } else if (msg === COMMAND_CURRENT_SONG__PREFIX) {
      const name = await this.spotifyService.getTrackName();
      if (name) {
        this.chatFeedback(target, `Playing: ${name}`);
      } else {
        this.chatFeedback(target, "Not sure what is playing... is it?");
      }
    } else if (msg.startsWith(COMMAND_QUEUE__PREFIX)) {
      console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
      const args = getCommandArgs(COMMAND_QUEUE__PREFIX, msg);

      if (args.startsWith(SPOTIFY_LINK_START)) {
        await this.handleSpotifyLink(args, target);
      } else {
        this.spotifyService.tryAddTrackByString(args, (chatMessage) => {
          this.chatFeedback(target, chatMessage);
        });
      }
      console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
    } else if (msg === COMMAND_SKIP_TO_NEXT__PREFIX) {
      if (isUserPrivileged(userState, COMMAND_SKIP_TO_NEXT__ALLOWED_USERS)) {
        this.spotifyService.skipToNextTrack();
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
        }
      } else {
        console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
        console.log(`Blocked a call of skip from ${userState.username}`);
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
      }
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
        'Błąd: Nie mogę odczytać identyfikatora utworu'
      );
    }
  }

  private chatFeedback(target: string, message: string) {
    if (CHAT_FEEDBACK) {
      this.twitchClient?.say(target, message);
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
