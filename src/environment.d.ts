declare global {
  namespace NodeJS {
    declare interface ProcessEnv {
      TWITCH_CHANNEL: string;
      SPOTIFY_CLIENT_ID: string;
      SPOTIFY_CLIENT_SECRET: string;
      SPOTIFY_PLAYLIST_ID?: string;
      TWITCH_TOKEN: string;
      BOT_USERNAME: string;
      CHAT_FEEDBACK: boolean;
      ADD_TO_QUEUE: boolean;
      ADD_TO_PLAYLIST: boolean;
      SUBSCRIBERS_ONLY: boolean;
      COMMAND_QUEUE__PREFIX: string;
      COMMAND_GET_QUEUE__PREFIX: string;
      COMMAND_GET_QUEUE__PREFER_WHISPER: boolean;
      COMMAND_GET_QUEUE__REFRESH__COOLDOWN_MS: number;
      COMMAND_CURRENT_SONG__PREFIX: string;
      COMMAND_SKIP_TO_NEXT__PREFIX: string;
      COMMAND_SKIP_TO_NEXT__ALLOWED_USERS
      COMMAND_SET_VOLUME__PREFIX: string;
      COMMAND_SET_VOLUME__ALLOWED_USERS: string;
      AUTH_SERVER_PORT: number;
      HOST: string;
    }
  }
}
export {};
