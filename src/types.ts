// 番剧订阅数据结构
export interface BangumiSubscription {
  id: number
  bangumiId: string
  channelId: string
  bangumiTitle: string
  bangumiTitleCn: string
  weekday: number
  airTime: string
  subscribedAt: Date
}

// Bangumi 番剧条目类型（基于 bgmlist.com 的数据结构）
export interface BangumiItem {
  id: string
  title: string
  title_cn: string
  airTime?: {
    weekday: number
    time: string
    date: string
  }
  weekday: number
  platforms?: string[] // 添加配信平台字段
}

export interface MessageTemplates {
  weekNames: string[]
  today: {
    status: string
    fetchError: string
    noItems: string
    error: string
    title: string
  }
  week: {
    status: string
    fetchError: string
    error: string
    title: string
  }
  day: {
    invalidDay: string
    status: string
    fetchError: string
    noItems: string
    error: string
    title: string
  }
  subscribe: {
    invalidId: string
    status: string
    notFound: string
    already: string
    success: string
    error: string
  }
  list: {
    empty: string
    item: string
    header: string
    error: string
  }
  delete: {
    empty: string
    invalidIndex: string
    success: string
    error: string
  }
  clear: {
    success: string
    error: string
  }
  test: {
    empty: string
    start: string
    result: string
  }
  link: {
    status: string
    parseFail: string
    error: string
    screenshotLabel: string
  }
  detail: {
    digestNickname: string
    digestContent: string
    source: string
    title: string
    titleCn: string
    airTime: string
    airDate: string
    rating: string
    rank: string
    platform: string
    summary: string
    link: string
    unknown: string
    timeUnknown: string
  }
  push: {
    title: string
    testTitle: string
    message: string
  }
  render: {
    puppeteerMissing: string
    screenshotEmpty: string
    screenshotBufferEmpty: string
    error: string
  }
}

// 插件配置接口
export interface Config {
  debug: boolean
  detailsForToday: boolean
  subscriptionInterval: number
  enableWebpageScreenshot: boolean
  messages: MessageTemplates
}

// 声明数据库表
declare module 'koishi' {
  interface Tables {
    bangumi_sub: BangumiSubscription
  }
}
