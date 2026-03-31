# DB-Bot

Discord 서버 안에서 DB 학습을 진행할 수 있도록 돕는 봇이다.  
서버장이 `db_study_plan` 채널에서 학습 기간과 코스를 정하면, 봇이 일별 학습 계획과 학습 자료를 생성하고 Discord 채널에 게시한다.

## 주요 기능

- `db_study_plan`에서 학습 계획 생성
- 코스 미리보기와 상세 일정 생성 또는 템플릿 재사용
- `db_tutor`, `db_quiz`, `db_answer` 채널 자동 게시
- `user_answer` 제출 처리와 DM 피드백
- `user_ask` 질문 처리와 답변 재사용
- Prisma 기반 학습 기록 저장
- 후속 일차 자료 선생성 및 자동 게시

## 기본 구조

```text
db_study_plan
  -> 학습 기간/코스 선택
  -> 학습 시작

db_daily
  ├─ db_tutor
  ├─ db_quiz
  ├─ db_answer
  ├─ user_answer
  └─ user_ask
```

## 기술 스택

- NestJS
- Prisma
- PostgreSQL
- Discord.js
- OpenAI API

## 요구 사항

- Node.js 22
- pnpm
- PostgreSQL 16 이상 또는 Docker
- Discord Bot Token
- OpenAI API Key

## 환경 변수

`.env.example`를 기준으로 `.env`를 만든다.

필수 값:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DISCORD_BOT_TOKEN`
- `OPENAI_API_KEY`

선택 값:

- `DISCORD_CLIENT_ID`
- `DISCORD_REGISTER_COMMANDS_ON_BOOT`
- `OPENAI_MODEL`
- `TZ`

로컬 앱 실행 시에는 `DATABASE_URL`도 추가해야 한다.

```env
DATABASE_URL=postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>
```

Docker 배포에서는 `DATABASE_URL`을 직접 넣지 않아도 된다. 앱 컨테이너가 `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`로 자동 조합한다.

## 로컬 실행

1. 환경 변수 파일 생성

```bash
cp .env.example .env
```

2. `.env`에 실제 값을 채운다.

3. 로컬 Postgres 실행

```bash
docker compose up -d postgres
```

4. 의존성 설치

```bash
pnpm install
```

5. Prisma client 생성과 빌드

```bash
pnpm prisma generate
pnpm build
```

6. 개발 서버 실행

```bash
pnpm start:dev
```

필요하면 마이그레이션 적용:

```bash
pnpm prisma migrate deploy
```

## Docker 배포

한 대의 VM에 앱과 Postgres를 같이 올리는 기준이다.

1. 환경 변수 파일 생성

```bash
cp .env.example .env
```

2. `.env`에 실제 값을 채운다.

3. 컨테이너 실행

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

4. 상태 확인

```bash
docker compose -f docker-compose.deploy.yml ps
docker compose -f docker-compose.deploy.yml logs -f app
```

참고:

- 배포용 compose는 기본적으로 루트 `.env`를 읽는다.
- 앱 컨테이너는 시작 시 `pnpm exec prisma migrate deploy`를 먼저 수행한다.
- Postgres는 Docker 네트워크 안에서 `postgres` 서비스명으로 연결된다.
- DB 포트 `5432`는 현재 외부 노출 상태이므로 운영 환경에서는 방화벽 정책을 같이 잡는 편이 좋다.

## Discord 설정

이미지 가이드는 `docs/discord_settings`에 있다.

기본 순서:

1. Discord Developer Portal에서 새 애플리케이션 생성
2. Bot 생성 후 Token 발급
3. 필요한 권한으로 서버에 초대
4. `DISCORD_BOT_TOKEN`을 `.env`에 설정

`db_study_plan` 채널 입력은 실제 Discord 서버장만 허용된다.

## OpenAI 설정

1. OpenAI API Key 생성
2. `.env`에 `OPENAI_API_KEY` 설정
3. 필요하면 `OPENAI_MODEL` 지정

## 문서

- 사용자 사용 설명서: `README_SETTING.md`
- DB 구조 문서: `docs/README_DB.md`

## 운영 메모

- 학습 계획, 일차, 질문, 제출 기록은 모두 PostgreSQL에 저장된다.
- 일부 Discord 채널 누락 시 플랜 시작이 중단되고 `CANCELLED` 상태로 정리될 수 있다.
- 자동 게시 기준 시각은 기본 `Asia/Seoul` 오전 10시다.
