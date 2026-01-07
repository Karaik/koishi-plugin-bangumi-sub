import { Context, h, Logger } from 'koishi'
import type { BangumiItem, Config } from '../types'
import { formatTemplate } from '../utils/template'

interface BangumiDetails {
  title: string
  title_cn: string
  coverUrl?: string
  airDate?: string
  rating?: number
  rank?: number
  summary?: string
  url: string
}

export interface BangumiService {
  fetchCalendarData: () => Promise<BangumiItem[]>
  parseBangumiLink: (url: string) => Promise<{ info: any, screenshot?: Buffer } | null>
  getBangumiDetails: (bangumiId: string) => Promise<BangumiDetails | null>
  sendDetailedBangumiInfo: (items: BangumiItem[], title: string) => Promise<h.Fragment>
  renderHtmlTable: (items: BangumiItem[], title: string, isWeeklyView?: boolean) => Promise<h.Fragment>
}

// 缓存变量
let calendarCache: BangumiItem[] = []
let lastFetchTime = 0

// 解析播放时间字符串
function parseAirTime(broadcast: string): { weekday: number, time: string, date: string } | undefined {
  if (!broadcast) return undefined
  
  // 尝试解析不同的时间格式
  // 例如: "R/2024-07-07T15:30:00/P7D"
  const isoMatch = broadcast.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/)
  if (isoMatch) {
    const date = new Date(isoMatch[0])
    return {
      weekday: date.getDay() === 0 ? 7 : date.getDay(), // 转换为周一=1的格式
      time: isoMatch[2].substring(0, 5), // 只取小时:分钟
      date: isoMatch[1]
    }
  }
  
  // 简单的时间格式，例如: "周六 23:30"
  const simpleMatch = broadcast.match(/(周[一二三四五六日])\s*(\d{1,2}:\d{2})/)
  if (simpleMatch) {
    const weekdayMap: { [key: string]: number } = {
      '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 7
    }
    return {
      weekday: weekdayMap[simpleMatch[1]] || 0,
      time: simpleMatch[2],
      date: ''
    }
  }
  
  return undefined
}

// 判断是否为本季新番（根据首播日期）
function isCurrentSeasonAnime(airDate: string): boolean {
  if (!airDate) return false
  
  const currentDate = new Date()
  const currentYear = currentDate.getFullYear()
  const currentMonth = currentDate.getMonth() + 1 // 1-12
  
  // 计算当前季度的开始月份
  const currentQuarter = Math.ceil(currentMonth / 3)
  const seasonStartMonth = (currentQuarter - 1) * 3 + 1
  
  // 解析番剧的首播日期
  const airDateObj = new Date(airDate)
  const airYear = airDateObj.getFullYear()
  const airMonth = airDateObj.getMonth() + 1
  
  // 判断是否为本季新番：同年且在当前季度开始月份之后
  return airYear === currentYear && airMonth >= seasonStartMonth
}

export function createBangumiService(ctx: Context, config: Config, logger: Logger): BangumiService {
  const { messages } = config
  const detailMessages = messages.detail
  /**
   * 获取并缓存 bgmlist.com 的番剧数据
   * @returns {Promise<BangumiItem[]>} 番剧数据
   */
  async function fetchCalendarData(): Promise<BangumiItem[]> {
    const CACHE_DURATION = 3600 * 1000 // 缓存1小时
    if (Date.now() - lastFetchTime < CACHE_DURATION && calendarCache.length > 0) {
      if (config.debug) logger.info('Using cached calendar data.')
      return calendarCache
    }

    try {
      if (config.debug) logger.info('Fetching fresh data from bgmlist.com...')
      
      let response
      let dataSource = 'onair'
      
      // 首先尝试 onair API
      try {
        response = await ctx.http.get('https://bgmlist.com/api/v1/bangumi/onair', {
          headers: {
            'User-Agent': `Koishi-Plugin-Bangumi-Calendar/1.0.0 (https://koishi.chat)`,
          },
          timeout: 10000,
        })
      } catch (onairError) {
        if (config.debug) {
          logger.info(`Onair API failed: ${onairError.message}, trying current season...`)
        }
        
        // 如果 onair 失败，尝试当前季度
        const currentDate = new Date()
        const year = currentDate.getFullYear()
        const month = currentDate.getMonth() + 1
        const quarter = Math.ceil(month / 3)
        const seasonKey = `${year}q${quarter}`
        
        dataSource = `archive-${seasonKey}`
        response = await ctx.http.get(`https://bgmlist.com/api/v1/bangumi/archive/${seasonKey}`, {
          headers: {
            'User-Agent': `Koishi-Plugin-Bangumi-Calendar/1.0.0 (https://koishi.chat)`,
          },
          timeout: 10000,
        })
      }

      if (config.debug) {
        logger.info(`Using data source: ${dataSource}`)
        logger.info(`Response type: ${typeof response}`)
        logger.info(`Response is array: ${Array.isArray(response)}`)
        if (response) {
          if (Array.isArray(response)) {
            logger.info(`bgmlist.com returned ${response.length} items`)
            if (response.length > 0) {
              logger.info(`First item: ${JSON.stringify(response[0], null, 2)}`)
            }
          } else {
            logger.info(`Response is object with keys: ${Object.keys(response).join(', ')}`)
            logger.info(`Response content: ${JSON.stringify(response, null, 2)}`)
          }
        } else {
          logger.info('Response is null/undefined')
        }
      }

      // 从响应中提取番剧数组
      let bangumiArray: any[] = []
      
      if (Array.isArray(response)) {
        bangumiArray = response
        logger.info(`Processing ${bangumiArray.length} items from array response`)
      } else if (response && typeof response === 'object' && response.items && Array.isArray(response.items)) {
        bangumiArray = response.items
        logger.info(`Processing ${bangumiArray.length} items from response.items`)
      } else {
        logger.error('Unexpected response format:', response)
        return []
      }

      // 第一步：处理所有新番信息，创建基本的 BangumiItem 对象（不包含图片）
      const processedItems: BangumiItem[] = []

      for (const item of bangumiArray) {
        if (config.debug && processedItems.length < 3) {
          logger.info(`Processing bangumi ${processedItems.length}: ${item.title || 'no title'}`)
        }
        
        // 查找 bangumi.tv 的条目以获取 ID
        const bangumiSite = item.sites?.find(site => site.site === 'bangumi')
        if (bangumiSite) {
          let bangumiId = ''
          
          // 从 URL 中提取 Bangumi ID
          if (bangumiSite.url) {
            const urlMatch = bangumiSite.url.match(/subject\/(\d+)/)
            if (urlMatch) {
              bangumiId = urlMatch[1]
            }
          } else if (bangumiSite.id) {
            // 直接使用 ID 字段
            bangumiId = bangumiSite.id
          }
          
          if (bangumiId) {
            try {
              // 解析播放时间信息
              const airTime = parseAirTime(item.broadcast || '')
              
              // 检查是否为本季新番
              if (!airTime?.date || !isCurrentSeasonAnime(airTime.date)) {
                if (config.debug && processedItems.length < 3) {
                  logger.info(`Skipping ${item.title}: not current season anime (date: ${airTime?.date || 'unknown'})`)
                }
              } else {
                // 提取配信平台信息
                const platforms = item.sites?.filter(site => site.site !== 'bangumi')
                  .map(site => site.site || '未知平台') || []
              
                const bangumiItem: BangumiItem = {
                  id: bangumiId,
                  title: item.title || '',
                  title_cn: item.titleTranslate?.['zh-Hans']?.[0] || 
                           item.titleTranslate?.['zh-Hant']?.[0] || 
                           item.title || '',
                  airTime: airTime,
                  weekday: airTime?.weekday || 0,
                  platforms: platforms
                }
                
                processedItems.push(bangumiItem)
                
                if (config.debug && processedItems.length <= 5) {
                  logger.info(`Added bangumi: ${bangumiItem.title} (${bangumiItem.title_cn}) on weekday ${bangumiItem.weekday} at ${airTime?.time || 'unknown time'}`)
                }
              }
              
            } catch (error) {
              logger.error(`Error processing bangumi ${item.title}:`, error)
            }
          }
        }
      }

      calendarCache = processedItems
      lastFetchTime = Date.now()
      
      if (config.debug) {
        logger.info(`✓ Processed and cached ${processedItems.length} items from bgmlist.com`)
        // 按星期分组显示统计
        const weeklyCount = [0, 0, 0, 0, 0, 0, 0, 0] // 索引0不用，1-7对应周一到周日
        processedItems.forEach(item => {
          if (item.weekday >= 1 && item.weekday <= 7) {
            weeklyCount[item.weekday]++
          }
        })
        const weekNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
        const weeklyStats = weeklyCount.slice(1).map((count, index) => `${weekNames[index + 1]}:${count}`).join(' ')
        logger.info(`Weekly distribution: ${weeklyStats}`)
      }
      
      return processedItems
    } catch (error) {
      logger.error('Failed to fetch data from bgmlist.com:', error)
      return []
    }
  }

  /**
   * 截取网页特定区域
   * @param url 网页URL
   * @returns 截图Buffer
   */
  async function captureWebpageRegions(url: string): Promise<Buffer | null> {
    if (!ctx.puppeteer) {
      logger.error('Puppeteer 服务未找到或未启用')
      return null
    }

    let page = null
    try {
      if (config.debug) {
        logger.info(`开始截取网页: ${url}`)
      }

      page = await ctx.puppeteer.page()
      await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 })

      // 访问页面
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      })

      // 等待页面加载
      await new Promise(resolve => setTimeout(resolve, 3000))

      // 查找目标元素
      const headerHeroSelector = '.headerHero.clearit'
      const mainWrapperSelector = '.mainWrapper.mainXL'

      // 检查元素是否存在
      const headerExists = await page.$(headerHeroSelector)
      const mainExists = await page.$(mainWrapperSelector)

      if (!headerExists && !mainExists) {
        if (config.debug) {
          logger.warn('未找到指定的页面元素')
        }
        return null
      }

      // 使用更精确的CSS来只显示目标元素
      await page.addStyleTag({
        content: `
          /* 隐藏所有元素 */
          body * { visibility: hidden !important; }

          /* 只显示目标元素及其子元素 */
          .headerHero.clearit,
          .headerHero.clearit *,
          .mainWrapper.mainXL,
          .mainWrapper.mainXL * {
            visibility: visible !important;
          }

          /* 确保容器可见 */
          body { visibility: visible !important; }

          /* 调整布局 */
          .headerHero.clearit { margin-bottom: 20px !important; }
        `
      })

      // 截图
      const imageBuffer = await page.screenshot({
        type: 'png',
        fullPage: true
      })

      if (config.debug) {
        logger.info('网页截图完成')
      }

      return imageBuffer as Buffer

    } catch (error) {
      logger.error('网页截图失败:', error)
      return null
    } finally {
      if (page) {
        try {
          await page.close()
        } catch (e) {
          logger.warn('关闭网页截图页面时出错:', e)
        }
      }
    }
  }

  /**
   * 解析bangumi链接并返回番剧信息
   * @param url bangumi链接
   * @returns 番剧信息和可选的截图
   */
  async function parseBangumiLink(url: string): Promise<{ info: any, screenshot?: Buffer } | null> {
    // 提取bangumi ID
    const match = url.match(/(?:bangumi\.tv|bgm\.tv)\/subject\/(\d+)/)
    if (!match) {
      return null
    }

    const bangumiId = match[1]

    try {
      // 获取番剧详细信息
      const details = await getBangumiDetails(bangumiId)
      if (!details) {
        return null
      }

      let screenshot: Buffer | undefined

      // 如果启用了截图功能，则截取网页
      if (config.enableWebpageScreenshot) {
        const screenshotBuffer = await captureWebpageRegions(url)
        if (screenshotBuffer) {
          screenshot = screenshotBuffer
        }
      }

      return {
        info: details,
        screenshot
      }

    } catch (error) {
      logger.error(`解析bangumi链接失败 (${url}):`, error)
      return null
    }
  }
  async function getBangumiDetails(bangumiId: string): Promise<{
    title: string
    title_cn: string
    coverUrl?: string
    airDate?: string
    rating?: number
    rank?: number
    summary?: string
    url: string
  } | null> {
    try {
      const response = await ctx.http.get(`https://api.bgm.tv/v0/subjects/${bangumiId}`, {
        headers: {
          'User-Agent': `Koishi-Plugin-Bangumi-Calendar/1.0.0 (https://koishi.chat)`,
        },
        timeout: 10000,
      })
      
      return {
        title: response.name || '',
        title_cn: response.name_cn || response.name || '',
        coverUrl: response.images?.large,
        airDate: response.date,
        rating: response.rating?.score,
        rank: response.rank,
        summary: response.summary,
        url: `https://bgm.tv/subject/${bangumiId}`
      }
    } catch (error) {
      if (config.debug) {
        logger.error(`获取番剧详情失败 (ID: ${bangumiId}):`, error)
      }
      return null
    }
  }

  /**
   * 发送详细番剧信息（使用合并转发）
   * @param items 番剧条目列表
   * @param title 标题
   * @returns Koishi 消息元素
   */
  async function sendDetailedBangumiInfo(items: BangumiItem[], title: string): Promise<h.Fragment> {
    const messageNodes: h[] = [
      h(
        'message',
        { nickname: detailMessages.digestNickname },
        formatTemplate(detailMessages.digestContent, {
          title,
          source: detailMessages.source,
        })
      )
    ]

    for (const item of items) {
      try {
        // 获取详细信息
        const details = await getBangumiDetails(item.id)
        if (details) {
          const content: h[] = []
          
          // 添加封面图（如果有）
          if (details.coverUrl) {
            content.push(h.image(details.coverUrl))
          }
          
          // 构建详细信息文本
          const detailLines: string[] = []
          if (details.title) {
            detailLines.push(formatTemplate(detailMessages.title, { title: details.title }))
          }
          if (details.title_cn && details.title_cn !== details.title) {
            detailLines.push(formatTemplate(detailMessages.titleCn, { title: details.title_cn }))
          }
          if (item.airTime?.time) {
            detailLines.push(formatTemplate(detailMessages.airTime, { time: item.airTime.time }))
          }
          if (details.airDate) {
            detailLines.push(formatTemplate(detailMessages.airDate, { date: details.airDate }))
          }
          if (details.rating) {
            detailLines.push(formatTemplate(detailMessages.rating, { rating: details.rating.toFixed(1) }))
          }
          if (details.rank) {
            detailLines.push(formatTemplate(detailMessages.rank, { rank: details.rank }))
          }
          if (item.platforms && item.platforms.length > 0) {
            detailLines.push(formatTemplate(detailMessages.platform, { platforms: item.platforms.join(', ') }))
          }
          if (details.summary) {
            const shortSummary = details.summary.length > 100 
              ? details.summary.substring(0, 100) + '...' 
              : details.summary
            detailLines.push(formatTemplate(detailMessages.summary, { summary: shortSummary }))
          }
          detailLines.push(formatTemplate(detailMessages.link, { url: details.url }))
          
          content.push(h.text(detailLines.join('\n')))
          
          messageNodes.push(h('message', { 
            nickname: details.title_cn || details.title 
          }, content))
        } else {
          // 如果获取详情失败，使用基本信息
          const chineseTitle = item.title_cn || item.title
          const basicInfo = [
            formatTemplate(detailMessages.title, { title: chineseTitle }),
            formatTemplate(detailMessages.airTime, {
              time: item.airTime?.time || detailMessages.timeUnknown,
            }),
            formatTemplate(detailMessages.link, {
              url: `https://bgm.tv/subject/${item.id}`,
            })
          ].join('\n')
          
          messageNodes.push(h('message', { 
            nickname: chineseTitle 
          }, h.text(basicInfo)))
        }
        
        // 添加延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500))
        
      } catch (error) {
        logger.error(`处理番剧详情时出错 (ID: ${item.id}):`, error)
      }
    }

    return h('figure', messageNodes)
  }

  /**
   * 使用 Puppeteer 将番剧数据渲染成 HTML 表格图片
   * @param items {BangumiItem[]} 要渲染的番剧数据
   * @param title {string} 图片的标题
   * @param isWeeklyView {boolean} 是否为周视图
   * @returns {Promise<h.Fragment>} Koishi 的图片消息元素
   */
  async function renderHtmlTable(items: BangumiItem[], title: string, isWeeklyView: boolean = false): Promise<h.Fragment> {
    // 检查 puppeteer 服务是否可用
    if (!ctx.puppeteer) {
      logger.error('Puppeteer 服务未找到或未启用')
      return formatTemplate(messages.render.puppeteerMissing, {})
    }
    
    // 根据视图类型生成不同的表格内容
    let tableHeader = ''
    let tableBody = ''
    let tableWidth = ''
    
    if (isWeeklyView) {
      // 周视图：按星期分列
      const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
      const weeklyItems: BangumiItem[][] = [[], [], [], [], [], [], []] // 7个数组对应周一到周日
      
      // 按星期分组
      items.forEach(item => {
        if (item.weekday >= 1 && item.weekday <= 7) {
          weeklyItems[item.weekday - 1].push(item)
        }
      })
      
      // 对每天的新番按时间排序
      weeklyItems.forEach(dayItems => {
        dayItems.sort((a, b) => {
          const timeA = a.airTime?.time || '99:99'
          const timeB = b.airTime?.time || '99:99'
          return timeA.localeCompare(timeB)
        })
      })
      
      // 生成周视图HTML内容
      const weeklyColumnsHtml = weekdays.map((day, index) => {
        const dayItems = weeklyItems[index]
        const itemsHtml = dayItems.length > 0 ? dayItems.map(item => {
          const chineseTitle = item.title_cn || item.title
          const japaneseTitle = item.title
          const timeDisplay = item.airTime?.time || '时间未知'
          const airDate = item.airTime?.date || ''
          return `
            <div class="anime-card">
              <div class="anime-time">${timeDisplay}</div>
              <div class="anime-title">
                <a href="https://bgm.tv/subject/${item.id}" target="_blank">${h.escape(chineseTitle)}</a>
              </div>
              <div class="anime-japanese">${h.escape(japaneseTitle)}</div>
              <div class="anime-id">ID: ${item.id}</div>
              ${airDate ? `<div class="anime-airdate">开播：${airDate}</div>` : ''}
            </div>
          `
        }).join('') : '<div style="text-align: center; color: #64748b; margin-top: 40px; font-size: 14px;">暂无放送</div>'
        
        return `
          <div class="day-column">
            <div class="day-header">${day}</div>
            <div class="anime-list">
              ${itemsHtml}
            </div>
          </div>
        `
      }).join('')
      
      tableHeader = ''
      tableBody = `<div class="weekly-grid">${weeklyColumnsHtml}</div>`
      tableWidth = ''
      
    } else {
      // 普通视图：原来的纵向表格
      const renderItems = items.map(item => {
        // 构建详细的时间显示
        let timeDisplay = '时间未知'
        let timeSource = 'unknown'
        
        if (item.airTime?.time) {
          timeDisplay = item.airTime.time
          timeSource = 'bgmlist-broadcast'
        } else {
          // 如果没有具体时间，显示日期信息
          timeDisplay = item.airTime?.date || '日期未知'
          timeSource = 'date-fallback'
        }
        
        // 获取中文和日文标题
        const chineseTitle = item.title_cn || item.title
        const japaneseTitle = item.title
        
        return `
          <tr>
            <td>
              <div class="time-info">
                <div class="broadcast-time ${item.airTime?.time ? 'has-time' : 'no-time'}">
                  ${timeDisplay}
                </div>
                <div class="time-source">${timeSource}</div>
              </div>
            </td>
            <td>
              <div class="title-info">
                <div class="chinese-title">
                  <a href="https://bgm.tv/subject/${item.id}" target="_blank">${h.escape(chineseTitle)}</a>
                </div>
                <div class="subject-id">ID: ${item.id}</div>
              </div>
            </td>
            <td>
              <div class="japanese-title">${h.escape(japaneseTitle)}</div>
              <div class="air-date">放送日期: ${item.airTime?.date || '未知'}</div>
              <div class="platforms">配信: ${item.platforms && item.platforms.length > 0 ? item.platforms.join(', ') : '未知'}</div>
            </td>
          </tr>
        `
      }).join('')
      
      tableHeader = `
        <thead>
          <tr>
            <th style="width: 120px;">播出时间</th>
            <th style="width: 280px;">中文名称</th>
            <th style="width: 200px;">日文名称</th>
          </tr>
        </thead>
      `
      
      tableBody = `<tbody>${renderItems}</tbody>`
      tableWidth = ''
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Inter', 'Noto Sans SC', sans-serif;
              background: linear-gradient(to bottom, #e0f2fe, #f9fafb);
              margin: 0;
              padding: 20px;
              min-height: auto;
              position: relative;
              overflow-x: hidden;
            }

            /* 动态光影背景 */
            .aurora-container {
              position: fixed;
              top: 0;
              left: 0;
              width: 100vw;
              height: 100vh;
              z-index: -1;
              pointer-events: none;
            }
            .aurora-shape-1, .aurora-shape-2 {
              position: absolute;
              border-radius: 50%;
              filter: blur(120px);
              opacity: 0.6;
            }
            .aurora-shape-1 {
              width: 600px;
              height: 600px;
              background: rgba(59, 130, 246, 0.3);
              animation: move-aurora-1 25s infinite alternate linear;
            }
            .aurora-shape-2 {
              width: 700px;
              height: 700px;
              background: rgba(168, 85, 247, 0.2);
              animation: move-aurora-2 30s infinite alternate linear;
            }
            @keyframes move-aurora-1 {
              from { transform: translate(-200px, -200px) rotate(0deg); }
              to { transform: translate(800px, 400px) rotate(360deg); }
            }
            @keyframes move-aurora-2 {
              from { transform: translate(1000px, 100px) rotate(0deg); }
              to { transform: translate(200px, 600px) rotate(360deg); }
            }

            .main-container {
              max-width: ${isWeeklyView ? '1600px' : '800px'};
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.9);
              backdrop-filter: blur(20px);
              border-radius: 24px;
              box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
              border: 1px solid rgba(255, 255, 255, 0.3);
              overflow: hidden;
              position: relative;
              z-index: 1;
            }

            .header {
              text-align: center;
              padding: 30px 20px;
              background: linear-gradient(135deg, rgba(14, 165, 233, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
              border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            }

            h1 {
              font-size: ${isWeeklyView ? '42px' : '32px'};
              font-weight: 700;
              background: linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              margin: 0 0 10px 0;
              letter-spacing: -0.5px;
            }

            .subtitle {
              color: #64748b;
              font-size: ${isWeeklyView ? '16px' : '18px'};
              font-weight: 500;
            }

            /* 周视图样式 */
            .weekly-grid {
              display: grid;
              grid-template-columns: repeat(7, 1fr);
              min-height: auto;
              padding: 20px;
            }

            .day-column {
              border-right: 1px solid rgba(255, 255, 255, 0.3);
              padding: 20px 16px;
              position: relative;
            }

            .day-column:last-child {
              border-right: none;
            }

            .day-header {
              text-align: center;
              font-size: 20px;
              font-weight: 600;
              color: #0ea5e9;
              margin-bottom: 20px;
              padding-bottom: 12px;
              border-bottom: 2px solid rgba(14, 165, 233, 0.2);
            }

            .anime-list {
              max-height: none;
              overflow-y: visible;
              padding-right: 8px;
            }

            /* 自定义滚动条 */
            .anime-list::-webkit-scrollbar {
              width: 6px;
            }
            .anime-list::-webkit-scrollbar-track {
              background: rgba(255, 255, 255, 0.2);
              border-radius: 3px;
            }
            .anime-list::-webkit-scrollbar-thumb {
              background: rgba(59, 130, 246, 0.4);
              border-radius: 3px;
            }
            .anime-list::-webkit-scrollbar-thumb:hover {
              background: rgba(59, 130, 246, 0.6);
            }

            .anime-card {
              background: rgba(255, 255, 255, 0.95);
              border: 1px solid rgba(14, 165, 233, 0.2);
              border-radius: 12px;
              padding: 16px;
              margin-bottom: 16px;
              transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
              backdrop-filter: blur(10px);
              position: relative;
              overflow: hidden;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }

            .anime-card:hover {
              transform: translateY(-4px) scale(1.02);
              box-shadow: 0 15px 35px rgba(14, 165, 233, 0.2);
              background: rgba(255, 255, 255, 0.95);
            }

            .anime-card::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              height: 3px;
              background: linear-gradient(90deg, #0ea5e9, #3b82f6);
              opacity: 0;
              transition: opacity 0.3s ease;
            }

            .anime-card:hover::before {
              opacity: 1;
            }

            .anime-time {
              font-size: 16px;
              font-weight: 700;
              color: #059669;
              margin-bottom: 8px;
              display: inline-block;
              background: rgba(16, 185, 129, 0.1);
              padding: 4px 8px;
              border-radius: 6px;
            }

            .anime-title {
              font-size: 15px;
              font-weight: 600;
              color: #1e293b;
              margin-bottom: 6px;
              line-height: 1.4;
            }

            .anime-title a {
              color: inherit;
              text-decoration: none;
              transition: color 0.3s ease;
            }

            .anime-title a:hover {
              color: #0ea5e9;
            }

            .anime-japanese {
              font-size: 12px;
              color: #64748b;
              font-style: italic;
              margin-bottom: 6px;
              line-height: 1.3;
            }

            .anime-id {
              font-size: 11px;
              color: #3b82f6;
              font-family: 'Courier New', monospace;
              font-weight: 600;
              margin-bottom: 6px;
              background: rgba(59, 130, 246, 0.1);
              padding: 2px 6px;
              border-radius: 4px;
              display: inline-block;
            }

            .anime-airdate {
              font-size: 11px;
              color: #dc2626;
              font-weight: 500;
              background: rgba(220, 38, 38, 0.1);
              padding: 2px 6px;
              border-radius: 4px;
              display: inline-block;
            }

            /* 普通视图样式 */
            .normal-table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }

            .normal-table th,
            .normal-table td {
              padding: 16px 20px;
              text-align: left;
              border-bottom: 1px solid rgba(255, 255, 255, 0.2);
              vertical-align: top;
            }

            .normal-table th {
              background: rgba(59, 130, 246, 0.1);
              font-weight: 600;
              color: #1e293b;
              font-size: 14px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              text-align: center;
            }

            .normal-table tr:nth-child(even) {
              background: rgba(255, 255, 255, 0.05);
            }

            .normal-table tr:hover {
              background: rgba(59, 130, 246, 0.05);
              transition: background-color 0.2s ease;
            }

            .time-info {
              display: flex;
              flex-direction: column;
              gap: 4px;
            }
            .broadcast-time {
              font-weight: 700;
              font-size: ${isWeeklyView ? '18px' : '22px'};
            }
            .broadcast-time.has-time {
              color: #059669;
            }
            .broadcast-time.no-time {
              color: #dc2626;
            }
            .weekday {
              font-size: 11px;
              color: #64748b;
              background: rgba(100, 116, 139, 0.1);
              padding: 2px 6px;
              border-radius: 3px;
              display: inline-block;
            }
            .time-source {
              font-size: 9px;
              color: #64748b;
              font-style: italic;
            }
            
            .title-info {
              display: flex;
              flex-direction: column;
              gap: 4px;
            }
            .chinese-title {
              font-weight: 600;
              font-size: ${isWeeklyView ? '15px' : '20px'};
            }
            .chinese-title a {
              color: #3b82f6;
              text-decoration: none;
            }
            .chinese-title a:hover {
              text-decoration: underline;
            }
            .subject-id {
              font-size: ${isWeeklyView ? '10px' : '14px'};
              color: #64748b;
              font-family: 'Courier New', monospace;
              font-weight: 600;
            }
            
            .japanese-title {
              font-size: ${isWeeklyView ? '14px' : '16px'};
              color: #1e293b;
              margin-bottom: 4px;
            }
            .air-date {
              font-size: 10px;
              color: #64748b;
              font-family: 'Courier New', monospace;
            }
            .platforms {
              font-size: 11px;
              color: #3b82f6;
              margin-top: 2px;
            }

            /* 响应式设计 */
            @media (max-width: 768px) {
              .weekly-grid {
                grid-template-columns: 1fr;
              }
              .day-column {
                border-right: none;
                border-bottom: 1px solid rgba(255, 255, 255, 0.3);
              }
              h1 {
                font-size: 28px;
              }
              .main-container {
                margin: 10px;
              }
            }
          </style>
        </head>
        <body>
          <!-- 动态光影容器 -->
          <div class="aurora-container">
            <div class="aurora-shape-1"></div>
            <div class="aurora-shape-2"></div>
          </div>

          <div class="main-container">
            <div class="header">
              <h1>${title}</h1>
              <div class="subtitle">${new Date().getFullYear()}年 第${Math.ceil((new Date().getMonth() + 1) / 3)}季度</div>
            </div>
            
            ${isWeeklyView ? tableBody : `<table class="normal-table">${tableHeader}${tableBody}</table>`}
          </div>
        </body>
      </html>
    `
    // 使用 Puppeteer 页面截图方式渲染 HTML
    let page = null
    try {
      if (config.debug) {
        logger.info('开始使用 Puppeteer 页面截图渲染 HTML...')
        logger.info(`HTML 内容长度: ${htmlContent.length} 字符`)
      }
      
      page = await ctx.puppeteer.page()
      
      // 根据视图类型设置不同的视口大小
      const viewportWidth = isWeeklyView ? 1650 : 850
      // 根据内容数量动态计算高度，避免底部空白
      const estimatedHeight = Math.max(600, Math.min(1200, 300 + items.length * 80))
      await page.setViewport({ width: viewportWidth, height: estimatedHeight, deviceScaleFactor: 2 })
      
      // 设置页面内容，不等待网络请求完成
      await page.setContent(htmlContent, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      })
      
      // 等待一下让图片尝试加载 (使用兼容的方法)
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // 截图
      const imageBuffer = await page.screenshot({ 
        type: 'png',
        fullPage: true
      })
      
      if (config.debug) {
        logger.info('Puppeteer 截图执行完成')
        logger.info(`返回数据类型: ${typeof imageBuffer}`)
        logger.info(`是否为 Buffer: ${Buffer.isBuffer(imageBuffer)}`)
      }
      
      // 确保我们有有效的图片数据
      if (!imageBuffer) {
        logger.error('Puppeteer screenshot returned null/undefined')
        return formatTemplate(messages.render.screenshotEmpty, {})
      }
      
      const bufferSize = Buffer.isBuffer(imageBuffer) ? imageBuffer.length : 0
      
      if (config.debug) {
        logger.info(`生成的图片大小: ${(bufferSize / 1024).toFixed(2)} KB`)
      }
      
      // 检查 Buffer 是否有效
      if (bufferSize === 0) {
        logger.error('生成的图片 Buffer 大小为 0')
        return formatTemplate(messages.render.screenshotBufferEmpty, {})
      }
      
      // 返回图片
      return h.image(imageBuffer, 'image/png')
      
    } catch (error) {
      logger.error('Puppeteer 渲染过程中发生错误:', error)
      return formatTemplate(messages.render.error, { error: error.message })
    } finally {
      // 关闭页面
      if (page) {
        try {
          await page.close()
        } catch (e) {
          logger.warn('关闭 Puppeteer 页面时出错:', e)
        }
      }
    }
  }

  return {
    fetchCalendarData,
    parseBangumiLink,
    getBangumiDetails,
    sendDetailedBangumiInfo,
    renderHtmlTable,
  }
}
