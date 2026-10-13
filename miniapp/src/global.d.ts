/// <reference types="@tarojs/taro" />

declare namespace NodeJS {
  interface ProcessEnv {
    TARO_ENV: string;
    TARO_APP_API_ORIGIN: string;
    TARO_APP_ACTIVITY_ID: string;
  }
}
