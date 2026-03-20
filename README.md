# 글로벌 매크로 대시보드

나스닥, S&P500, 코스피, 금/은, 비트코인/이더리움, 원달러, 원유, 10년물 국채금리, 공포탐욕지수와 미국/한국/일본/유럽/중국 경제뉴스를 한 화면에서 보는 웹앱입니다.

## 주요 기능

- 시장 지표 차트 시각화
- 실시간(분봉) / 일봉 모드 전환
- 공포탐욕지수 표시
- 미국/한국/일본/유럽/중국 경제뉴스 + 한글 번역 + 요약
- 자동 새로고침 (30/60/120/300초)
- 텔레그램/디스코드 알림 (BTC 급등락, 공포탐욕 극단값)

## 1) 실행 방법

```bash
npm install
copy .env.example .env
```

`.env`에서 최소 `NEWS_API_KEY`를 입력하세요.

```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속

## 2) 데이터 소스

- 시장 지표: Yahoo Finance Chart API
- 공포탐욕지수: alternative.me Fear & Greed
- 뉴스: NewsAPI (`country=us/kr/jp/cn/gb/de/fr`, `category=business`)
- 번역: LibreTranslate 호환 API (`TRANSLATE_API_URL`)

## 3) 주의사항

- 뉴스는 NewsAPI 키가 없으면 비어있는 목록으로 표시됩니다.
- 일부 지표는 Yahoo 제공 상태에 따라 간헐적으로 지연/실패할 수 있습니다.
- 번역 API 상태에 따라 원문 제목/본문으로 폴백됩니다.

## 4) 알림 설정

`.env`에 아래 값을 채우면 자동 알림이 작동합니다.

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- 또는 `DISCORD_WEBHOOK_URL`

알림 체크 주기/조건:

- `ALERT_INTERVAL_MINUTES` (기본 15분)
- `ALERT_BTC_CHANGE_THRESHOLD` (기본 3%)
- `ALERT_NASDAQ_CHANGE_THRESHOLD` (기본 2%)
- `ALERT_USDKRW_CHANGE_THRESHOLD` (기본 1%)
- `ALERT_REQUIRE_NASDAQ_AND_USDKRW` (기본 `true`)
- `ALERT_MESSAGE_MODE` (`compact` 또는 `detailed`, 기본 `detailed`)
- `ALERT_FG_EXTREME` (기본 20)

`ALERT_REQUIRE_NASDAQ_AND_USDKRW=true` 이면 나스닥/원달러가 동시에 기준치를 넘을 때만 시장 알림을 발송합니다.

테스트 발송:

```bash
curl -X POST http://localhost:3000/api/alerts/test
```

## 5) 배포

### Render

1. GitHub에 코드 푸시
2. Render에서 New Web Service 생성
3. Build command: `npm install`
4. Start command: `npm start`
5. 환경변수는 `.env.example` 기준으로 등록

### Vercel

**구식 `vercel.json` (builds/routes)는 제거했습니다.** 최신 Vercel은 루트의 `server.js` + `module.exports = app` 를 자동 인식합니다. `public/**` 파일은 CDN으로 따로 제공됩니다.

1. GitHub 연결 후 Import
2. **Root Directory**: 저장소 루트에 `package.json`, `server.js`, `public/` 이 있어야 함 (하위 폴더만 올렸다면 그 폴더로 지정)
3. Environment Variables에 `NEWS_API_KEY` 등 등록
4. Deploy

## 6) 배포 후 사이트 여는 법

- **Vercel**: 배포가 끝나면 `https://프로젝트이름.vercel.app` 주소가 생성됩니다. 대시보드 **Deployments**에서 링크를 누르면 됩니다.
- **Render**: 서비스 화면 상단의 **URL** (예: `https://xxx.onrender.com`)을 브라우저에 입력합니다.

### 환경 변수 (배포 사이트에 꼭 넣기)

GitHub에는 `.env`를 올리지 않으므로, Vercel/Render **Settings → Environment Variables**에 직접 추가해야 합니다.

- `NEWS_API_KEY` — 뉴스용 (없으면 뉴스 비어 있음)
- (선택) `TRANSLATE_API_URL`, 텔레그램/디스코드 알림 관련 변수

### 에러가 날 때

1. **빌드 로그**에서 `npm install` 실패 여부 확인
2. **런타임 로그**에서 500 에러 메시지 확인
3. Vercel에서 뉴스 요약 API가 깨지던 문제는 `localhost` 자기 호출 때문일 수 있어, 최신 `server.js`는 내부 함수로 뉴스를 가져오도록 수정되어 있습니다. **GitHub에 다시 push** 후 재배포하세요.
4. **Vercel 무료 플랜**에서는 백그라운드 `setInterval` 알림이 동작하지 않을 수 있습니다. 알림은 **Render** 같은 상시 서버에 두는 편이 맞습니다.
